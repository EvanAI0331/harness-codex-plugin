import type { BuildHarnessRequest, CapabilityNode, Harness, HarnessBlueprint, HarnessEvent, SpecArtifact } from "shared/types";
import { broadcastHarnessEvent } from "@/lib/harness-event-bus";
import { getHarnessById, saveHarness, saveHarnessEvent } from "@/lib/harness-repository";
import { PlannerService } from "@/lib/planner/service";
import { ComposerService } from "@/lib/composer/service";
import { AssemblerService } from "@/lib/assembler/service";
import { SpecxService, makeDefaultSpecxService } from "@/lib/specx/service";
import { validateAgentThreeLayerSpecs } from "@/lib/specx/controlled-checks";
import { SpecxRepairAgent } from "@/lib/specx/repair-agent";
import { ScriptxService, makeDefaultScriptxService } from "@/lib/scriptx/service";
import type { CapabilityResolverService } from "@/lib/capabilities/resolver";
import { makeId } from "@/lib/id";
import { nowIso } from "@/lib/time";
import { applyHarnessIntake, markHarnessBuilding, markHarnessFailed, markHarnessReady } from "@/lib/harness-machine";

export interface BuildOrchestratorOutcome {
  harness: Harness;
  events: HarnessEvent[];
}

export class BuildOrchestratorService {
  private capabilityResolverService: CapabilityResolverService | undefined;

  constructor(
    private readonly plannerService = new PlannerService(),
    private readonly composerService = new ComposerService(),
    private readonly specxService: SpecxService = makeDefaultSpecxService(),
    private readonly scriptxService: ScriptxService = makeDefaultScriptxService(),
    private readonly assemblerService = new AssemblerService(),
  ) {}

  async runBuild(harnessId: string, request: BuildHarnessRequest = {}): Promise<BuildOrchestratorOutcome | null> {
    const existing = getHarnessById(harnessId);
    if (!existing) {
      return null;
    }

    const events: HarnessEvent[] = [];
    const prepared = applyHarnessIntake(existing, {
      goal: request.goal?.trim() || existing.intake.goal,
      mainModel: request.mainModel ?? existing.intake.mainModel,
      auxiliaryModel: request.auxiliaryModel ?? existing.intake.auxiliaryModel,
      codingAgentModel: request.codingAgentModel ?? existing.intake.codingAgentModel,
      capabilityPolicy: request.capabilityPolicy ?? existing.intake.capabilityPolicy,
    });
    let harness = saveHarness(
      markHarnessBuilding({
        ...prepared,
        blueprint: null,
        specArtifacts: existing.specArtifacts.filter((artifact) => artifact.ownerType === "run"),
        agentNodes: [],
        capabilityNodes: [],
        edges: [],
      }),
    );

    persistAndBroadcast(
      buildEvent(harness.id, "build.started", "Build pipeline started.", {
        harnessStatus: harness.status,
        hasBlueprint: Boolean(harness.blueprint),
      }),
      events,
    );

    try {
      persistAndBroadcast(
        buildEvent(harness.id, "build.stage.started", "Dispatcher stage started.", {
          stage: "planner",
        }),
        events,
      );
      const planResult = await this.plannerService.generateBlueprint(harness.id, harness.intake);
      const generatedBlueprint = remapBlueprintIds(planResult.blueprint, harness.id, harness.name);
      harness = saveHarness({
        ...attachArtifacts(harness, planResult.artifacts),
        status: harness.status,
        blueprint: generatedBlueprint,
        updatedAt: nowIso(),
      });
      persistAndBroadcast(
        buildEvent(harness.id, "build.stage.completed", "Dispatcher stage completed.", {
          stage: "planner",
          artifactCount: planResult.artifacts.length,
        }),
        events,
      );
      persistGraphUpdate(harness, "planning", {
        artifactCount: planResult.artifacts.length,
      }, events);

      const blueprint = harness.blueprint;
      if (!blueprint) {
        throw new Error("Build requires a blueprint before composition.");
      }

      persistAndBroadcast(
        buildEvent(harness.id, "build.stage.started", "Composer stage started.", {
          stage: "composer",
        }),
        events,
      );
      const composed = this.composerService.compose(harness, blueprint);
      harness = saveHarness(composed.harness);
      persistAndBroadcast(
        buildEvent(harness.id, "build.stage.completed", "Composer stage completed.", {
          stage: "composer",
          agentCount: harness.agentNodes.length,
        }),
        events,
      );
      persistGraphUpdate(harness, "compose", {
        agentCount: harness.agentNodes.length,
        runtimeEdges: harness.edges.filter((edge) => edge.relation === "delegates_to" || edge.relation === "depends_on").length,
      }, events);

      const specOutcome = await runSpecCompilationStage(harness, this.specxService, (snapshot, payload) => {
        harness = saveHarness(snapshot);
        persistGraphUpdate(snapshot, "spec-compile", payload, events);
      });
      harness = specOutcome.harness;
      if (specOutcome.failed) {
        return finalizeFailure(harness, events, "spec-compile", specOutcome.failureMessage ?? "Spec compilation failed.");
      }

      const capabilityBlueprint = harness.blueprint;
      if (!capabilityBlueprint) {
        throw new Error("Build requires a blueprint before capability resolution.");
      }

      const capabilityResolverService = await this.getCapabilityResolverService();
      const capabilityOutcome = await capabilityResolverService.resolve({
        harness,
        blueprint: capabilityBlueprint,
        onStep: async (snapshot, step) => {
          harness = saveHarness(applyCapabilityStep(harness, step.capability, step.artifacts));
          step.events.forEach((event) => persistAndBroadcast(event, events));
          persistGraphUpdate(snapshotToHarness(harness, snapshot), "resolve", {
            capabilityId: step.capability.id,
            source: step.capability.source,
            status: step.capability.status,
          }, events);
        },
      });
      harness = saveHarness(applyCapabilityOutcome(harness, capabilityOutcome.blueprint.capabilities, capabilityOutcome.artifacts));

      persistAndBroadcast(
        buildEvent(harness.id, "build.stage.completed", "Capability stage completed.", {
          stage: "capability",
          capabilityCount: capabilityOutcome.blueprint.capabilities.length,
        }),
        events,
      );
      persistGraphUpdate(harness, "resolve", {
        capabilityCount: capabilityOutcome.blueprint.capabilities.length,
        unresolvedCapabilities: capabilityOutcome.blueprint.capabilities.filter((capability) => capability.source === "unresolved").length,
      }, events);

      const scriptOutcome = await runScriptAuthoringStage(harness, this.scriptxService, (snapshot, payload) => {
        harness = saveHarness(snapshot);
        persistGraphUpdate(snapshot, "script-authoring", payload, events);
      });
      harness = scriptOutcome.harness;
      if (scriptOutcome.failed) {
        return finalizeFailure(harness, events, "script-authoring", scriptOutcome.failureMessage ?? "Script authoring failed.");
      }

      if (!hasVerifiedAuthoringArtifacts(harness.specArtifacts, harness.agentNodes.map((agent) => agent.id))) {
        return finalizeFailure(harness, events, "script-authoring", "Framework is missing required skill/script artifacts.");
      }

      persistAndBroadcast(
        buildEvent(harness.id, "build.stage.started", "Assembler stage started.", {
          stage: "assembler",
        }),
        events,
      );
      const assembled = this.assemblerService.finalize(harness);
      harness = saveHarness(assembled.harness);
      persistAndBroadcast(
        buildEvent(harness.id, "build.stage.completed", "Assembler stage completed.", {
          stage: "assembler",
          status: harness.status,
        }),
        events,
      );
      persistGraphUpdate(harness, "assemble", {
        status: harness.status,
      }, events);

      const finalHarness = saveHarness(markHarnessReady(harness));
      persistAndBroadcast(
        buildEvent(finalHarness.id, "build.completed", "Build pipeline completed.", {
          status: finalHarness.status,
        }),
        events,
      );
      persistGraphUpdate(finalHarness, "assemble", {
        status: finalHarness.status,
      }, events);
      persistAndBroadcast(
        buildEvent(finalHarness.id, "graph.finalized", "Graph finalized.", {
          status: finalHarness.status,
        }),
        events,
      );

      return {
        harness: getHarnessById(finalHarness.id) ?? finalHarness,
        events,
      };
    } catch (error) {
      const errorArtifacts = collectArtifactsFromError(error);
      if (errorArtifacts.length > 0) {
        harness = saveHarness(attachArtifacts(harness, errorArtifacts));
      }
      const failedHarness = saveHarness(markHarnessFailed(harness));
      const message = error instanceof Error ? error.message : String(error);
      persistAndBroadcast(
        buildEvent(failedHarness.id, "build.failed", "Build pipeline failed.", {
          error: message,
          artifactCount: errorArtifacts.length,
        }),
        events,
      );
      return {
        harness: getHarnessById(failedHarness.id) ?? failedHarness,
        events,
      };
    }
  }

  private async getCapabilityResolverService(): Promise<CapabilityResolverService> {
    if (!this.capabilityResolverService) {
      const modulePath = "@/lib/capabilities/" + "resolver";
      const { makeDefaultCapabilityResolver } = await import(modulePath);
      this.capabilityResolverService = makeDefaultCapabilityResolver();
    }

    return this.capabilityResolverService!;
  }
}

function collectArtifactsFromError(error: unknown): SpecArtifact[] {
  if (error && typeof error === "object" && "artifacts" in error) {
    const artifacts = (error as { artifacts?: SpecArtifact[] }).artifacts;
    return artifacts ?? [];
  }
  return [];
}

function runSpecCompilationStage(
  harness: Harness,
  specxService: SpecxService,
  onSnapshot: (snapshot: Harness, payload: Record<string, unknown>) => void,
): Promise<{ harness: Harness; events: HarnessEvent[]; failed: boolean; failureMessage?: string }> {
  return (async () => {
    const events: HarnessEvent[] = [];
    let current = harness;

    persistAndBroadcast(
      buildEvent(current.id, "build.stage.started", "Spec stage started.", {
        stage: "specx",
      }),
      events,
    );

    for (const agent of current.agentNodes) {
      const outcome = await specxService.generateAndCompileForAgent(agent, current);
      outcome.events.forEach((event) => persistAndBroadcast(event, events));
      current = saveHarness(mergeArtifactsAndNodes(current, outcome.artifacts));
      onSnapshot(current, {
        agentId: agent.id,
        executor: "controlled-specx-compile-chain",
        sourceArtifactCount: outcome.artifacts.filter((artifact) => artifact.specType === "spec.contract.source").length,
        compiledArtifactCount: outcome.artifacts.filter((artifact) => artifact.specType === "spec.contract.compiled").length,
        backtestArtifactCount: outcome.artifacts.filter((artifact) => artifact.specType === "spec.contract.backtest").length,
        roleSpecCount: outcome.artifacts.filter((artifact) => artifact.specType === "role").length,
        executionSpecCount: outcome.artifacts.filter((artifact) => artifact.specType === "execution").length,
        outputSpecCount: outcome.artifacts.filter((artifact) => artifact.specType === "output").length,
      });

      const specIssues = collectSpecGenerationIssues(current, agent, outcome.artifacts);
      if (specIssues.length > 0) {
        persistAndBroadcast(
          buildEvent(current.id, "spec.repair.queued", "SpecX repair agent queued.", {
            agentId: agent.id,
            issues: specIssues,
          }),
          events,
        );
        const repair = await new SpecxRepairAgent(specxService, mergeArtifactsAndNodes).repairAgentSpecs({
          harness: current,
          agent,
          issues: specIssues,
          maxAttempts: 2,
        });
        repair.events.forEach((event) => persistAndBroadcast(event, events));
        current = saveHarness(repair.harness);
        onSnapshot(current, {
          agentId: agent.id,
          executor: "specx-repair-agent",
          repaired: repair.repaired,
          repairArtifactCount: repair.artifacts.length,
        });
        if (repair.failed) {
          persistAndBroadcast(
            buildEvent(current.id, "node.failed", "SpecX repair agent failed to produce valid three-layer specs.", {
              agentId: agent.id,
              issues: validateAgentThreeLayerSpecs(current, agent),
            }),
            events,
          );
          return {
            harness: current,
            events,
            failed: true,
            failureMessage: repair.failureMessage ?? `${agent.label} three-layer specs invalid after repair.`,
          };
        }
      }
    }

    persistAndBroadcast(
      buildEvent(current.id, "build.stage.completed", "Spec stage completed.", {
        stage: "specx",
        artifactCount: current.specArtifacts.length,
      }),
      events,
    );

    return {
      harness: current,
      events,
      failed: false,
    };
  })();
}

function runScriptAuthoringStage(
  harness: Harness,
  scriptxService: ScriptxService,
  onSnapshot: (snapshot: Harness, payload: Record<string, unknown>) => void,
): Promise<{ harness: Harness; events: HarnessEvent[]; failed: boolean; failureMessage?: string }> {
  return (async () => {
    const events: HarnessEvent[] = [];
    let current = harness;

    persistAndBroadcast(
      buildEvent(current.id, "build.stage.started", "Script authoring stage started.", {
        stage: "script-authoring",
      }),
      events,
    );

    for (const agent of current.agentNodes) {
      const alreadyAuthoring = hasVerifiedAuthoringArtifacts(current.specArtifacts, agent.id);
      if (alreadyAuthoring) {
        continue;
      }

      const outcome = await scriptxService.generateAndCompileForAgent(agent, current);
      outcome.events.forEach((event) => persistAndBroadcast(event, events));
      current = saveHarness(mergeScriptArtifactsAndNodes(current, outcome.artifacts));
      onSnapshot(current, {
        agentId: agent.id,
        skillArtifactCount: outcome.artifacts.filter((artifact) => artifact.specType === "skill.source" || artifact.specType === "skill.compiled").length,
        scriptArtifactCount: outcome.artifacts.filter((artifact) => artifact.specType === "script.source" || artifact.specType === "script.compiled").length,
      });

      const failedArtifact = outcome.artifacts.find(
        (artifact) =>
          artifact.ownerId === agent.id &&
          ((artifact.specType === "skill.compiled" && artifact.compileStatus === "failure") ||
            (artifact.specType === "script.compiled" && artifact.compileStatus === "failure")),
      );
      if (failedArtifact) {
        persistAndBroadcast(
          buildEvent(current.id, "script.retry.queued", "Script authoring retry queued after failed compile.", {
            agentId: agent.id,
            artifactId: failedArtifact.id,
            stderr: failedArtifact.stderr,
          }),
          events,
        );
        const retryOutcome = await scriptxService.generateAndCompileForAgent(agent, current);
        retryOutcome.events.forEach((event) => persistAndBroadcast(event, events));
        current = saveHarness(mergeScriptArtifactsAndNodes(current, retryOutcome.artifacts));
        onSnapshot(current, {
          agentId: agent.id,
          executor: "scriptx-retry",
          skillArtifactCount: retryOutcome.artifacts.filter((artifact) => artifact.specType === "skill.source" || artifact.specType === "skill.compiled").length,
          scriptArtifactCount: retryOutcome.artifacts.filter((artifact) => artifact.specType === "script.source" || artifact.specType === "script.compiled").length,
        });
        const retryFailedArtifact = retryOutcome.artifacts.find(
          (artifact) =>
            artifact.ownerId === agent.id &&
            ((artifact.specType === "skill.compiled" && artifact.compileStatus === "failure") ||
              (artifact.specType === "script.compiled" && artifact.compileStatus === "failure")),
        );
        if (!retryFailedArtifact) {
          persistAndBroadcast(
            buildEvent(current.id, "script.retry.completed", "Script authoring retry completed.", {
              agentId: agent.id,
              artifactIds: retryOutcome.artifacts.map((artifact) => artifact.id),
            }),
            events,
          );
          continue;
        }
        persistAndBroadcast(
          buildEvent(current.id, "node.failed", "Script authoring failed.", {
            agentId: agent.id,
            artifactId: retryFailedArtifact.id,
            stderr: retryFailedArtifact.stderr,
          }),
          events,
        );
        return {
          harness: current,
          events,
          failed: true,
          failureMessage: retryFailedArtifact.stderr ?? `Script authoring failed for ${agent.label}.`,
        };
      }
    }

    persistAndBroadcast(
      buildEvent(current.id, "build.stage.completed", "Script authoring stage completed.", {
        stage: "script-authoring",
        artifactCount: current.specArtifacts.length,
      }),
      events,
    );

    return {
      harness: current,
      events,
      failed: false,
    };
  })();
}

function collectSpecGenerationIssues(harness: Harness, agent: Harness["agentNodes"][number], artifacts: SpecArtifact[]): string[] {
  const issues = validateAgentThreeLayerSpecs(harness, agent);
  for (const artifact of artifacts) {
    if (artifact.ownerId !== agent.id) {
      continue;
    }
    if (artifact.specType === "spec.contract.compiled" && artifact.compileStatus === "failure") {
      issues.push(artifact.stderr || "SpecX contract compilation failed");
    }
    if (artifact.specType === "spec.contract.backtest" && artifact.backtestStatus === "failure") {
      issues.push(artifact.backtestStderr || artifact.stderr || "SpecX contract backtest failed");
    }
  }
  return Array.from(new Set(issues.filter(Boolean)));
}

function attachArtifacts(harness: Harness, artifacts: SpecArtifact[]): Harness {
  const byId = new Map(harness.specArtifacts.map((artifact) => [artifact.id, artifact] as const));
  for (const artifact of artifacts) {
    byId.set(artifact.id, artifact);
  }
  return {
    ...harness,
    specArtifacts: Array.from(byId.values()),
    updatedAt: nowIso(),
  };
}

function mergeArtifactsAndNodes(harness: Harness, artifacts: SpecArtifact[]): Harness {
  const merged = attachArtifacts(harness, artifacts);
  const artifactByOwner = new Map<string, SpecArtifact[]>();
  for (const artifact of merged.specArtifacts) {
    if (!artifact.ownerId) {
      continue;
    }
    const list = artifactByOwner.get(artifact.ownerId) ?? [];
    list.push(artifact);
    artifactByOwner.set(artifact.ownerId, list);
  }

  return {
    ...merged,
    agentNodes: merged.agentNodes.map((agent) => {
      const nodeArtifacts = artifactByOwner.get(agent.id) ?? [];
      const compiled = findLatestContractArtifact(nodeArtifacts, "spec.contract.compiled");
      const backtest = findLatestContractArtifact(nodeArtifacts, "spec.contract.backtest");
      const skillCompiled = findLatestContractArtifact(nodeArtifacts, "skill.compiled");
      const scriptCompiled = findLatestContractArtifact(nodeArtifacts, "script.compiled");
      return {
        ...agent,
        specArtifactIds: Array.from(new Set([...(agent.specArtifactIds ?? []), ...nodeArtifacts.map((artifact) => artifact.id)])),
        skillArtifactIds: Array.from(new Set([...(agent.skillArtifactIds ?? []), ...nodeArtifacts.filter((artifact) => artifact.specType.startsWith("skill.")).map((artifact) => artifact.id)])),
        scriptArtifactIds: Array.from(new Set([...(agent.scriptArtifactIds ?? []), ...nodeArtifacts.filter((artifact) => artifact.specType.startsWith("script.")).map((artifact) => artifact.id)])),
        status:
          compiled?.compileStatus === "failure" ||
          backtest?.backtestStatus === "failure" ||
          skillCompiled?.compileStatus === "failure" ||
          scriptCompiled?.compileStatus === "failure"
            ? "failed"
            : backtest?.backtestStatus === "success" ||
                compiled?.compileStatus === "success" ||
                skillCompiled?.compileStatus === "success" ||
                scriptCompiled?.compileStatus === "success"
              ? "completed"
              : agent.status,
        updatedAt: nowIso(),
      };
    }),
    blueprint: merged.blueprint
      ? {
          ...merged.blueprint,
          agents: merged.blueprint.agents.map((agent) => {
            const nodeArtifacts = artifactByOwner.get(agent.id) ?? [];
            const compiled = findLatestContractArtifact(nodeArtifacts, "spec.contract.compiled");
            const backtest = findLatestContractArtifact(nodeArtifacts, "spec.contract.backtest");
            const skillCompiled = findLatestContractArtifact(nodeArtifacts, "skill.compiled");
            const scriptCompiled = findLatestContractArtifact(nodeArtifacts, "script.compiled");
            return {
              ...agent,
              specArtifactIds: Array.from(new Set([...(agent.specArtifactIds ?? []), ...nodeArtifacts.map((artifact) => artifact.id)])),
              skillArtifactIds: Array.from(new Set([...(agent.skillArtifactIds ?? []), ...nodeArtifacts.filter((artifact) => artifact.specType.startsWith("skill.")).map((artifact) => artifact.id)])),
              scriptArtifactIds: Array.from(new Set([...(agent.scriptArtifactIds ?? []), ...nodeArtifacts.filter((artifact) => artifact.specType.startsWith("script.")).map((artifact) => artifact.id)])),
              status:
                compiled?.compileStatus === "failure" ||
                backtest?.backtestStatus === "failure" ||
                skillCompiled?.compileStatus === "failure" ||
                scriptCompiled?.compileStatus === "failure"
                  ? "failed"
                  : backtest?.backtestStatus === "success" ||
                      compiled?.compileStatus === "success" ||
                      skillCompiled?.compileStatus === "success" ||
                      scriptCompiled?.compileStatus === "success"
                    ? "completed"
                    : agent.status,
              updatedAt: nowIso(),
            };
          }),
          specs: merged.blueprint.specs.map((spec) => {
            const nodeArtifacts = artifactByOwner.get(spec.agentId) ?? [];
            const source = findLatestContractArtifact(nodeArtifacts, "spec.contract.source");
            const compiled = findLatestContractArtifact(nodeArtifacts, "spec.contract.compiled");
            const backtest = findLatestContractArtifact(nodeArtifacts, "spec.contract.backtest");
            return {
              ...spec,
              artifactId: compiled?.id ?? source?.id ?? spec.artifactId,
              specArtifactIds: Array.from(new Set([...(spec.specArtifactIds ?? []), ...nodeArtifacts.map((artifact) => artifact.id)])),
              compileStatus:
                compiled?.compileStatus === "failure" || backtest?.backtestStatus === "failure"
                  ? "failure"
                  : backtest?.backtestStatus === "success" || compiled?.compileStatus === "success"
                    ? "success"
                    : spec.compileStatus ?? "pending",
              compiledPath: compiled?.compiledPath ?? spec.compiledPath,
              stdout: compiled?.stdout ?? spec.stdout,
              stderr: compiled?.stderr ?? backtest?.backtestStderr ?? spec.stderr,
            };
          }),
        }
      : merged.blueprint,
  };
}

function mergeScriptArtifactsAndNodes(harness: Harness, artifacts: SpecArtifact[]): Harness {
  return mergeArtifactsAndNodes(harness, artifacts);
}

function applyCapabilityStep(
  harness: Harness,
  capability: CapabilityNode,
  artifacts: SpecArtifact[],
): Harness {
  const merged = attachArtifacts(harness, artifacts);
  const artifactIds = artifacts.filter((artifact) => artifact.ownerId === capability.id).map((artifact) => artifact.id);

  return {
    ...merged,
    capabilityNodes: merged.capabilityNodes.map((node) =>
      node.id === capability.id
        ? {
            ...capability,
            specArtifactIds: Array.from(new Set([...(capability.specArtifactIds ?? []), ...artifactIds])),
            updatedAt: nowIso(),
          }
        : node,
    ),
    blueprint: merged.blueprint
      ? {
          ...merged.blueprint,
          capabilities: merged.blueprint.capabilities.map((node) =>
            node.id === capability.id
              ? {
                  ...capability,
                  specArtifactIds: Array.from(new Set([...(capability.specArtifactIds ?? []), ...artifactIds])),
                  updatedAt: nowIso(),
                }
              : node,
          ),
        }
      : merged.blueprint,
  };
}

function applyCapabilityOutcome(harness: Harness, capabilities: CapabilityNode[], artifacts: SpecArtifact[]): Harness {
  const artifactByOwner = new Map<string, SpecArtifact[]>();
  for (const artifact of artifacts) {
    if (!artifact.ownerId) {
      continue;
    }
    const list = artifactByOwner.get(artifact.ownerId) ?? [];
    list.push(artifact);
    artifactByOwner.set(artifact.ownerId, list);
  }

  const merged = attachArtifacts(harness, artifacts);
  return {
    ...merged,
    capabilityNodes: capabilities.map((capability) => {
      const ownedArtifacts = artifactByOwner.get(capability.id) ?? [];
      return {
        ...capability,
        specArtifactIds: Array.from(new Set([...(capability.specArtifactIds ?? []), ...ownedArtifacts.map((artifact) => artifact.id)])),
        updatedAt: nowIso(),
      };
    }),
    blueprint: merged.blueprint
      ? {
          ...merged.blueprint,
          capabilities: capabilities.map((capability) => {
            const ownedArtifacts = artifactByOwner.get(capability.id) ?? [];
            return {
              ...capability,
              specArtifactIds: Array.from(new Set([...(capability.specArtifactIds ?? []), ...ownedArtifacts.map((artifact) => artifact.id)])),
              updatedAt: nowIso(),
            };
          }),
        }
      : merged.blueprint,
  };
}

function persistGraphUpdate(
  harness: Harness,
  phase: HarnessEvent["phase"],
  payload: Record<string, unknown>,
  events: HarnessEvent[],
): void {
  persistAndBroadcast(
    buildEvent(harness.id, "graph.updated", "Graph updated.", {
      phase,
      ...payload,
    }),
    events,
  );
}

function snapshotToHarness(harness: Harness, blueprintSnapshot: HarnessBlueprint): Harness {
  return {
    ...harness,
    blueprint: blueprintSnapshot,
    agentNodes: blueprintSnapshot.agents,
    capabilityNodes: blueprintSnapshot.capabilities,
    edges: blueprintSnapshot.edges,
    updatedAt: nowIso(),
  };
}

function buildEvent(
  harnessId: string,
  kind: string,
  message: string,
  payload: Record<string, unknown>,
): HarnessEvent {
  return {
    id: makeId("event"),
    harnessId,
    channel: "build",
    phase: phaseFromKind(kind),
    kind,
    message,
    payload,
    createdAt: nowIso(),
  };
}

function phaseFromKind(kind: string): HarnessEvent["phase"] {
  if (kind.includes("skill") || kind.includes("script")) {
    return "script-authoring";
  }
  if (kind.includes("compose")) {
    return "compose";
  }
  if (kind.includes("spec")) {
    return "spec-compile";
  }
  if (kind.includes("resolve")) {
    return "resolve";
  }
  if (kind.includes("assemble")) {
    return "assemble";
  }
  if (kind.includes("runtime")) {
    return "runtime";
  }
  if (kind.includes("build")) {
    return "build";
  }
  return "build";
}

function persistAndBroadcast(event: HarnessEvent, events: HarnessEvent[]): void {
  saveHarnessEvent(event);
  broadcastHarnessEvent(event);
  events.push(event);
}

function remapBlueprintIds(blueprint: HarnessBlueprint, harnessId: string, harnessName: string): HarnessBlueprint {
  const root = blueprint.harness.id;
  return {
    ...blueprint,
    harness: {
      ...blueprint.harness,
      id: harnessId,
      label: harnessName,
    },
    edges: blueprint.edges.map((edge) =>
      edge.source === root
        ? { ...edge, source: harnessId }
        : edge.target === root
          ? { ...edge, target: harnessId }
          : edge,
    ),
  };
}

function hasVerifiedAuthoringArtifacts(artifacts: SpecArtifact[], agentIds: string[] | string): boolean {
  const ids = Array.isArray(agentIds) ? agentIds : [agentIds];
  return ids.every((agentId) => {
    const nodeArtifacts = artifacts.filter((artifact) => artifact.ownerId === agentId);
    const hasSkill = nodeArtifacts.some((artifact) => artifact.specType === "skill.compiled" && artifact.compileStatus === "success");
    const hasScript = nodeArtifacts.some((artifact) => artifact.specType === "script.compiled" && artifact.compileStatus === "success");
    return hasSkill && hasScript;
  });
}

function findLatestContractArtifact(artifacts: SpecArtifact[], specType: SpecArtifact["specType"]): SpecArtifact | undefined {
  return [...artifacts].reverse().find((artifact) => artifact.specType === specType);
}

function finalizeFailure(harness: Harness, events: HarnessEvent[], phase: HarnessEvent["phase"], message: string): BuildOrchestratorOutcome {
  const failed = saveHarness(markHarnessFailed(harness));
  const failureEvent = buildEvent(failed.id, "build.failed", message, {
    phase,
    message,
  });
  persistAndBroadcast(failureEvent, events);
  return {
    harness: failed,
    events,
  };
}
