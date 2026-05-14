import type { AgentNode, Harness, HarnessEvent, SpecArtifact } from "shared/types";
import { makeId } from "@/lib/id";
import { nowIso } from "@/lib/time";
import { hash16 } from "@/lib/specs/spec-hash";
import type { SpecBacktestAdapter, SpecCompilerAdapter, SpecCompileResult } from "@/lib/specx/types";
import { LocalSpecBacktestAdapter } from "@/lib/specx/local-backtest-adapter";
import { createSpecCompilerAdapter } from "@/lib/demo-mode";
import {
  backtestCompiledContract,
  buildAgentContractSource,
  buildFinalizedRuntimeBinding,
  canonicalizeSpecxContractPayload,
  type SpecxContractSourcePayload,
} from "@/lib/specx/contract";

export interface SpecxGenerationOutcome {
  artifacts: SpecArtifact[];
  events: HarnessEvent[];
}

export class SpecxService {
  constructor(
    private readonly compiler: SpecCompilerAdapter,
    private readonly backtester: SpecBacktestAdapter,
  ) {}

  async generateSpecSourceForAgent(agent: AgentNode, harness: Harness): Promise<SpecArtifact> {
    const blueprint = harness.blueprint;
    if (!blueprint) {
      throw new Error("SpecX contract source requires a blueprint.");
    }

    const ids = makeContractArtifactIds();
    const runtimeOrder = resolveRuntimeOrder(blueprint.agents, agent.id);
    const source = buildAgentContractSource(harness, blueprint, agent, runtimeOrder, ids);
    return makeArtifact(
      ids.sourceArtifactId,
      "spec.contract.source",
      "SpecX Contract Source",
      "contract",
      "contract",
      source.sourceText,
      hash16(source.sourceText),
      "specx.contract.source.v1",
      [harness.id, agent.id],
      agent.id,
      source.sourceText,
      {
        ...source.payload.runtimeBinding,
        sourceHash: source.sourceHash,
      },
      source.payload.runtimeBinding.contractVersion,
      "pending",
      "pending",
    );
  }

  async compileSpec(source: string): Promise<SpecCompileResult> {
    return this.compiler.compile(source);
  }

  async generateAndCompileForAgent(agent: AgentNode, harness: Harness): Promise<SpecxGenerationOutcome> {
    const sourceArtifact = await this.generateSpecSourceForAgent(agent, harness);
    const events: HarnessEvent[] = [];
    const artifacts: SpecArtifact[] = [sourceArtifact];

    pushEvent(events, harness.id, "spec-compile", "spec.generated", `${agent.label} contract source generated.`, {
      agentId: agent.id,
      artifactId: sourceArtifact.id,
      contractArtifactId: sourceArtifact.runtimeBinding?.contractArtifactId,
    });
    pushEvent(events, harness.id, "spec-compile", "spec.contract.generated", `${agent.label} contract source generated.`, {
      agentId: agent.id,
      artifactId: sourceArtifact.id,
      contractArtifactId: sourceArtifact.runtimeBinding?.contractArtifactId,
    });

    const compileResult = await this.compileSpec(sourceArtifact.content);
    if (!compileResult.success) {
      const failedCompiledArtifact = buildCompiledArtifact(
        sourceArtifact,
        agent,
        harness,
        compileResult,
        false,
        sourceArtifact.runtimeBinding ?? null,
      );
      const failedBacktestArtifact = buildBacktestArtifact(
        sourceArtifact,
        agent,
        harness,
        false,
        {
          payload: JSON.stringify(
            {
              contractId: sourceArtifact.runtimeBinding?.contractArtifactId,
              agentId: agent.id,
              harnessId: harness.id,
              skipped: true,
              reason: "compile_failed",
            },
            null,
            2,
          ),
          stdout: "",
          stderr: compileResult.stderr || "compile failed; backtest skipped",
        },
      );
      failedCompiledArtifact.runtimeBinding = buildFinalizedRuntimeBinding(
        sourceArtifact.runtimeBinding!,
        {
          compiledHash: hash16(compileResult.compiledPayload ?? sourceArtifact.content),
        },
        failedBacktestArtifact.id,
        "failure",
      );
      failedCompiledArtifact.backtestStatus = "failure";
      failedCompiledArtifact.backtestStderr = failedBacktestArtifact.stderr;
      failedCompiledArtifact.backtestPayload = failedBacktestArtifact.backtestPayload;
      artifacts.push(failedCompiledArtifact, failedBacktestArtifact);
      pushEvent(events, harness.id, "spec-compile", "spec.failed", `${agent.label} contract compilation failed.`, {
        agentId: agent.id,
        sourceArtifactId: sourceArtifact.id,
        artifactId: failedCompiledArtifact.id,
        stdout: compileResult.stdout,
        stderr: compileResult.stderr,
      });
      pushEvent(events, harness.id, "spec-compile", "spec.contract.compiled", `${agent.label} contract compilation failed.`, {
        agentId: agent.id,
        sourceArtifactId: sourceArtifact.id,
        artifactId: failedCompiledArtifact.id,
        stdout: compileResult.stdout,
        stderr: compileResult.stderr,
      });
      pushEvent(events, harness.id, "spec-compile", "spec.contract.backtest.failed", `${agent.label} contract backtest skipped after compile failure.`, {
        agentId: agent.id,
        sourceArtifactId: sourceArtifact.id,
        compiledArtifactId: failedCompiledArtifact.id,
        backtestArtifactId: failedBacktestArtifact.id,
        stderr: failedBacktestArtifact.stderr,
      });
      return { artifacts, events };
    }

    const compiledArtifact = buildCompiledArtifact(
      sourceArtifact,
      agent,
      harness,
      compileResult,
      true,
      sourceArtifact.runtimeBinding ?? null,
    );
    artifacts.push(compiledArtifact);
    pushEvent(events, harness.id, "spec-compile", "spec.compiled", `${agent.label} contract compiled successfully.`, {
      agentId: agent.id,
      sourceArtifactId: sourceArtifact.id,
      artifactId: compiledArtifact.id,
      compiledPath: compileResult.compiledPath,
    });
    pushEvent(events, harness.id, "spec-compile", "spec.contract.compiled", `${agent.label} contract compiled successfully.`, {
      agentId: agent.id,
      sourceArtifactId: sourceArtifact.id,
      artifactId: compiledArtifact.id,
      compiledPath: compileResult.compiledPath,
    });

    const backtestResult = await this.backtester.backtest({
      source: sourceArtifact.content,
      compiled: compileResult.compiledPayload ?? "",
      harness,
      agent,
    });
    const backtestArtifact = buildBacktestArtifact(sourceArtifact, agent, harness, backtestResult.success, backtestResult);
    artifacts.push(backtestArtifact);
    const runtimeBinding = compiledArtifact.runtimeBinding
      ? buildFinalizedRuntimeBinding(
          compiledArtifact.runtimeBinding,
          {
            compiledHash: hash16(compileResult.compiledPayload ?? sourceArtifact.content),
          },
          backtestArtifact.id,
          backtestResult.success ? "success" : "failure",
        )
      : undefined;

    if (runtimeBinding) {
      compiledArtifact.runtimeBinding = runtimeBinding;
    }
    compiledArtifact.backtestStatus = backtestResult.success ? "success" : "failure";
    compiledArtifact.backtestPayload = backtestResult.payload;
    compiledArtifact.backtestStdout = backtestResult.stdout;
    compiledArtifact.backtestStderr = backtestResult.stderr;
    compiledArtifact.content = compileResult.compiledPayload ?? sourceArtifact.content;
    compiledArtifact.contentHash = hash16(compiledArtifact.content);
    compiledArtifact.compiledPayload = compileResult.compiledPayload;
    compiledArtifact.compiledPath = compileResult.compiledPath;
    compiledArtifact.stdout = compileResult.stdout;
    compiledArtifact.stderr = compileResult.stderr;
    compiledArtifact.updatedAt = nowIso();

    const backtestKind = backtestResult.success ? "spec.contract.backtest.passed" : "spec.contract.backtest.failed";
    pushEvent(events, harness.id, "spec-compile", backtestKind, `${agent.label} contract backtest ${backtestResult.success ? "passed" : "failed"}.`, {
      agentId: agent.id,
      sourceArtifactId: sourceArtifact.id,
      compiledArtifactId: compiledArtifact.id,
      backtestArtifactId: backtestArtifact.id,
      stdout: backtestResult.stdout,
      stderr: backtestResult.stderr,
    });
    if (backtestResult.success) {
      const layerArtifacts = buildThreeLayerSpecArtifacts(sourceArtifact, compiledArtifact, backtestArtifact, agent, harness);
      artifacts.push(...layerArtifacts);
      for (const artifact of layerArtifacts) {
        pushEvent(events, harness.id, "spec-compile", `spec.${artifact.specType}.compiled`, `${agent.label} ${artifact.specType} spec compiled.`, {
          agentId: agent.id,
          artifactId: artifact.id,
          compiledFrom: artifact.compiledFrom,
        });
      }
    }
    if (!backtestResult.success) {
      pushEvent(events, harness.id, "spec-compile", "spec.failed", `${agent.label} contract backtest failed.`, {
        agentId: agent.id,
        sourceArtifactId: sourceArtifact.id,
        compiledArtifactId: compiledArtifact.id,
        backtestArtifactId: backtestArtifact.id,
        stderr: backtestResult.stderr,
      });
    }

    return { artifacts, events };
  }

  async validateAndBacktest(contractPayload: string, harness: Harness, agent: AgentNode): Promise<SpecCompileResult> {
    const parsed = JSON.parse(contractPayload);
    const canonical = canonicalizeSpecxContractPayload(parsed);
    const backtest = backtestCompiledContract(JSON.stringify(canonical), canonical as Parameters<typeof backtestCompiledContract>[1], harness, agent);
    return {
      success: backtest.success,
      compiledPayload: JSON.stringify(canonical, null, 2),
      stdout: backtest.stdout,
      stderr: backtest.stderr,
    };
  }

  completeThreeLayerSpecsForAgent(agent: AgentNode, harness: Harness): SpecxGenerationOutcome {
    const sourceArtifact = findLatestArtifact(harness.specArtifacts, agent.id, "spec.contract.source");
    const compiledArtifact = findLatestArtifact(harness.specArtifacts, agent.id, "spec.contract.compiled");
    const backtestArtifact = findLatestArtifact(harness.specArtifacts, agent.id, "spec.contract.backtest");
    const events: HarnessEvent[] = [];

    if (!sourceArtifact || !compiledArtifact || !backtestArtifact) {
      throw new Error(`${agent.label} cannot complete three-layer specs without source, compiled, and backtest contract artifacts.`);
    }
    if (compiledArtifact.compileStatus !== "success" || backtestArtifact.backtestStatus !== "success") {
      throw new Error(`${agent.label} cannot complete three-layer specs without a backtest-success compiled contract.`);
    }

    const artifacts = buildThreeLayerSpecArtifacts(sourceArtifact, compiledArtifact, backtestArtifact, agent, harness);
    for (const artifact of artifacts) {
      pushEvent(events, harness.id, "spec-compile", `spec.${artifact.specType}.completed`, `${agent.label} ${artifact.specType} spec completed from verified SpecX contract.`, {
        agentId: agent.id,
        artifactId: artifact.id,
        compiledFrom: artifact.compiledFrom,
        completionSource: "verified-specx-contract",
      });
    }

    return { artifacts, events };
  }
}

function makeArtifact(
  id: string,
  specType: SpecArtifact["specType"],
  title: string,
  kind: SpecArtifact["kind"],
  artifactType: SpecArtifact["artifactType"],
  content: string,
  contentHash: string,
  sourceTemplateId: string,
  compiledFrom: string[],
  ownerId: string,
  sourceText: string,
  runtimeBinding: SpecArtifact["runtimeBinding"],
  contractVersion: string | undefined,
  compileStatus: SpecArtifact["compileStatus"],
  backtestStatus: SpecArtifact["backtestStatus"],
): SpecArtifact {
  const createdAt = nowIso();
  return {
    id,
    specType,
    title,
    kind,
    artifactType,
    content,
    contentHash,
    sourceTemplateId,
    compiledFrom,
    ownerType: "agent",
    ownerId,
    sourceText,
    runtimeBinding,
    contractVersion,
    compileStatus,
    backtestStatus,
    createdAt,
    updatedAt: createdAt,
  };
}

function buildThreeLayerSpecArtifacts(
  sourceArtifact: SpecArtifact,
  compiledArtifact: SpecArtifact,
  backtestArtifact: SpecArtifact,
  agent: AgentNode,
  harness: Harness,
): SpecArtifact[] {
  const contract = parseCompiledContract(compiledArtifact.content);
  const compiledFrom = [harness.id, agent.id, sourceArtifact.id, compiledArtifact.id, backtestArtifact.id];
  const roleSpec = {
    id: `${contract.contractId}.role`,
    specFamily: "agent-role",
    specVersion: "v1",
    harnessId: harness.id,
    agentId: agent.id,
    label: agent.label,
    role: contract.outputContract.role,
    mission: contract.outputContract.roleResponsibilities,
    capabilityBoundary: {
      requiredCapabilities: contract.runtimeBinding.requiredCapabilities,
      githubSearchPolicy: "GitHub search may only resolve skills, tools, libraries, or repositories; it is forbidden for information or content research.",
    },
    outputObligation: {
      artifactType: contract.outputContract.artifactType,
      outputType: contract.outputContract.outputType,
      requiredFields: contract.outputContract.requiredFields,
    },
  };
  const executionSpec = {
    id: `${contract.contractId}.execution`,
    specFamily: "agent-execution",
    specVersion: "v1",
    harnessId: harness.id,
    agentId: agent.id,
    entry: contract.runtimeBinding.entry,
    runtimeOrder: contract.runtimeBinding.runtimeOrder,
    dependencyIds: contract.runtimeBinding.dependencyIds,
    requiredArtifacts: contract.runtimeBinding.requiredArtifacts,
    stages: [
      "read_task_instance",
      "read_upstream_artifacts",
      "llm_reasoning_decision",
      "capability_selection",
      "skill_or_script_execution_when_selected",
      "persist_agent_output_artifact",
      "handoff_to_downstream_agent",
    ],
    gates: contract.validation.requiredChecks,
    runtimeGate: contract.validation.runtimeGate,
    contractGate: contract.validation.contractGate,
  };
  const outputSpec = {
    id: `${contract.contractId}.output`,
    specFamily: "agent-output",
    specVersion: "v1",
    harnessId: harness.id,
    agentId: agent.id,
    artifactType: contract.outputContract.artifactType,
    outputType: contract.outputContract.outputType,
    requiredFields: contract.outputContract.requiredFields,
    contentFields: contract.outputContract.contentFields,
    qualityGates: contract.outputContract.qualityGates,
    persistence: {
      store: "artifact-store",
      runArtifactType: "agent.output",
      downstreamReference: "artifact id",
    },
  };

  return [
    makeCompiledLayerArtifact("role", `${agent.label} Role Spec`, roleSpec, sourceArtifact, compiledArtifact, backtestArtifact, compiledFrom, agent.id),
    makeCompiledLayerArtifact("execution", `${agent.label} Execution Spec`, executionSpec, sourceArtifact, compiledArtifact, backtestArtifact, compiledFrom, agent.id),
    makeCompiledLayerArtifact("output", `${agent.label} Output Spec`, outputSpec, sourceArtifact, compiledArtifact, backtestArtifact, compiledFrom, agent.id),
  ];
}

function parseCompiledContract(content: string): SpecxContractSourcePayload {
  const parsed = JSON.parse(content) as SpecxContractSourcePayload;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    parsed.specFamily !== "specx" ||
    parsed.scope !== "harness-agent" ||
    !parsed.runtimeBinding ||
    !parsed.outputContract
  ) {
    throw new Error("Compiled SpecX contract is missing runtimeBinding or outputContract.");
  }
  return parsed;
}

function makeCompiledLayerArtifact(
  specType: "role" | "execution" | "output",
  title: string,
  payload: Record<string, unknown>,
  sourceArtifact: SpecArtifact,
  compiledArtifact: SpecArtifact,
  backtestArtifact: SpecArtifact,
  compiledFrom: string[],
  ownerId: string,
): SpecArtifact {
  const content = JSON.stringify(payload, null, 2);
  const createdAt = nowIso();
  return {
    id: makeId("artifact"),
    specType,
    title,
    kind: specType,
    artifactType: "compiled",
    content,
    contentHash: hash16(content),
    sourceTemplateId: `controlled-specx.${specType}.compiled.v1`,
    compiledFrom,
    ownerType: "agent",
    ownerId,
    sourceText: sourceArtifact.content,
    compileStatus: "success",
    backtestStatus: backtestArtifact.backtestStatus,
    compiledPayload: content,
    stdout: `specx-${specType}-compiled:${compiledArtifact.id}`,
    stderr: "",
    schemaName: `specx-${specType}`,
    compilerName: "controlled-specx-three-layer-compiler",
    contractVersion: compiledArtifact.contractVersion,
    runtimeBinding: compiledArtifact.runtimeBinding,
    createdAt,
    updatedAt: createdAt,
  };
}

function buildCompiledArtifact(
  sourceArtifact: SpecArtifact,
  agent: AgentNode,
  harness: Harness,
  result: SpecCompileResult,
  success: boolean,
  runtimeBinding: SpecArtifact["runtimeBinding"] | null,
): SpecArtifact {
  const createdAt = nowIso();
  const content = success ? result.compiledPayload ?? sourceArtifact.content : "";
  const hashInput = content || `${harness.id}:${agent.id}:${success}`;
  return {
    id: sourceArtifact.runtimeBinding?.compiledArtifactId ?? makeId("artifact"),
    specType: "spec.contract.compiled",
    title: `${agent.label} Contract Compilation`,
    kind: "contract",
    artifactType: "compiled",
    content,
    contentHash: hash16(hashInput),
    sourceTemplateId: "specx.contract.compiler.v1",
    compiledFrom: [harness.id, agent.id, sourceArtifact.id],
    ownerType: "agent",
    ownerId: agent.id,
    sourceText: sourceArtifact.content,
    compileStatus: success ? "success" : "failure",
    backtestStatus: "pending",
    compiledPath: result.compiledPath,
    compiledPayload: result.compiledPayload,
    stdout: result.stdout,
    stderr: result.stderr,
    schemaName: "specx-contract",
    compilerName: "local-specx-contract-compiler",
    contractVersion: sourceArtifact.runtimeBinding?.contractVersion,
    runtimeBinding: runtimeBinding
      ? {
          ...runtimeBinding,
          compiledHash: hash16(result.compiledPayload ?? content),
        }
      : undefined,
    createdAt,
    updatedAt: createdAt,
  };
}

function buildBacktestArtifact(
  sourceArtifact: SpecArtifact,
  agent: AgentNode,
  harness: Harness,
  success: boolean,
  result: { payload: unknown; stdout: string; stderr: string },
): SpecArtifact {
  const createdAt = nowIso();
  const content = String(result.payload);
  return {
    id: sourceArtifact.runtimeBinding?.backtestArtifactId ?? makeId("artifact"),
    specType: "spec.contract.backtest",
    title: `${agent.label} Contract Backtest`,
    kind: "contract",
    artifactType: "backtest",
    content,
    contentHash: hash16(content || `${harness.id}:${agent.id}:${success}`),
    sourceTemplateId: "specx.contract.backtest.v1",
    compiledFrom: [harness.id, agent.id, sourceArtifact.id],
    ownerType: "agent",
    ownerId: agent.id,
    sourceText: sourceArtifact.content,
    compileStatus: "not-applicable",
    backtestStatus: success ? "success" : "failure",
    backtestPayload: content,
    backtestStdout: result.stdout,
    backtestStderr: result.stderr,
    schemaName: "specx-contract",
    compilerName: "local-specx-contract-backtester",
    contractVersion: sourceArtifact.runtimeBinding?.contractVersion,
    runtimeBinding: sourceArtifact.runtimeBinding
      ? {
          ...sourceArtifact.runtimeBinding,
          backtestArtifactId: sourceArtifact.runtimeBinding.backtestArtifactId,
          backtestStatus: success ? "success" : "failure",
        }
      : undefined,
    createdAt,
    updatedAt: createdAt,
  };
}

function makeContractArtifactIds(): { sourceArtifactId: string; compiledArtifactId: string; backtestArtifactId: string } {
  return {
    sourceArtifactId: makeId("artifact"),
    compiledArtifactId: makeId("artifact"),
    backtestArtifactId: makeId("artifact"),
  };
}

function resolveRuntimeOrder(agents: AgentNode[], agentId: string): number {
  const index = agents.findIndex((agent) => agent.id === agentId);
  return index >= 0 ? index : 0;
}

function findLatestArtifact(artifacts: SpecArtifact[], ownerId: string, specType: SpecArtifact["specType"]): SpecArtifact | undefined {
  return [...artifacts].reverse().find((artifact) => artifact.ownerId === ownerId && artifact.specType === specType);
}

function pushEvent(
  events: HarnessEvent[],
  harnessId: string,
  phase: HarnessEvent["phase"],
  kind: string,
  message: string,
  payload: Record<string, unknown>,
): void {
  events.push({
    id: makeId("event"),
    harnessId,
    channel: "system",
    phase,
    kind,
    message,
    payload,
    createdAt: nowIso(),
  });
}

export function makeDefaultSpecxService(): SpecxService {
  return new SpecxService(createSpecCompilerAdapter(), new LocalSpecBacktestAdapter());
}
