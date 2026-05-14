import type {
  BuildHarnessRequest,
  CapabilityNode,
  CreateHarnessRequest,
  Harness,
  HarnessBlueprint,
  HarnessEvent,
  SpecArtifact,
} from "shared/types";
import { broadcastHarnessEvent, subscribeHarnessEvents } from "@/lib/harness-event-bus";
import { getHarnessById, listHarnessEvents, saveHarness, saveHarnessEvent } from "@/lib/harness-repository";
import { BuildOrchestratorService } from "@/lib/build-orchestrator";
import { PlannerGenerationError } from "@/lib/planner/errors";
import { PlannerService } from "@/lib/planner/service";
import { CapabilityResolverService, makeDefaultCapabilityResolver } from "@/lib/capabilities/resolver";
import { SpecxService, makeDefaultSpecxService } from "@/lib/specx/service";
import { makeId } from "@/lib/id";
import { nowIso } from "@/lib/time";
import { createHarnessDraft as makeHarnessDraft } from "@/lib/harness-machine";

const plannerService = new PlannerService();
const capabilityResolverService = makeDefaultCapabilityResolver();
const specxService = makeDefaultSpecxService();

function createEvent(
  harnessId: string,
  channel: HarnessEvent["channel"],
  phase: HarnessEvent["phase"],
  kind: string,
  message: string,
  payload: Record<string, unknown> = {},
): HarnessEvent {
  return {
    id: makeId("event"),
    harnessId,
    channel,
    phase,
    kind,
    message,
    payload,
    createdAt: nowIso(),
  };
}

function persistAndBroadcast(event: HarnessEvent): HarnessEvent {
  saveHarnessEvent(event);
  broadcastHarnessEvent(event);
  return event;
}

function seedDraft(input: Partial<CreateHarnessRequest> = {}): Harness {
  const draft = makeHarnessDraft(input.name?.trim() || "Harness Draft");
  return {
    ...draft,
    id: makeId("harness"),
    name: input.name?.trim() || draft.name,
  };
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

function mergeArtifacts(existing: SpecArtifact[], incoming: SpecArtifact[]): SpecArtifact[] {
  const byId = new Map(existing.map((artifact) => [artifact.id, artifact] as const));
  for (const artifact of incoming) {
    byId.set(artifact.id, artifact);
  }
  return Array.from(byId.values());
}

function attachArtifactsToHarness(harness: Harness, artifacts: SpecArtifact[]): Harness {
  return {
    ...harness,
    specArtifacts: mergeArtifacts(harness.specArtifacts, artifacts),
    updatedAt: nowIso(),
  };
}

function toCompileStatus(
  spec: HarnessBlueprint["specs"][number],
  compiledArtifact: SpecArtifact | undefined,
  backtestArtifact: SpecArtifact | undefined,
): "pending" | "success" | "failure" {
  if (compiledArtifact?.compileStatus === "success" && backtestArtifact?.backtestStatus === "success") {
    return "success";
  }
  if (compiledArtifact?.compileStatus === "failure" || backtestArtifact?.backtestStatus === "failure") {
    return "failure";
  }
  return spec.compileStatus ?? "pending";
}

function mergeBlueprintAndNodes(
  harness: Harness,
  blueprint: HarnessBlueprint,
  capabilityNodes: CapabilityNode[],
  additionalArtifacts: SpecArtifact[],
): Harness {
  const specArtifacts = mergeArtifacts(harness.specArtifacts, additionalArtifacts);
  const artifactsByOwner = new Map<string, SpecArtifact[]>();
  for (const artifact of specArtifacts) {
    if (!artifact.ownerId) {
      continue;
    }
    const list = artifactsByOwner.get(artifact.ownerId) ?? [];
    list.push(artifact);
    artifactsByOwner.set(artifact.ownerId, list);
  }

  const agents = blueprint.agents.map((agent) => {
    const nodeArtifacts = artifactsByOwner.get(agent.id) ?? [];
    return {
      ...agent,
      specArtifactIds: Array.from(new Set([...(agent.specArtifactIds ?? []), ...nodeArtifacts.map((artifact) => artifact.id)])),
    };
  });

  const specs = blueprint.specs.map((spec) => {
    const nodeArtifacts = artifactsByOwner.get(spec.agentId) ?? [];
    const sourceArtifact = nodeArtifacts.find((artifact) => artifact.specType === "spec.contract.source");
    const compiledArtifact = nodeArtifacts.find((artifact) => artifact.specType === "spec.contract.compiled");
    const backtestArtifact = nodeArtifacts.find((artifact) => artifact.specType === "spec.contract.backtest");
    return {
      ...spec,
      artifactId: compiledArtifact?.id ?? sourceArtifact?.id ?? spec.artifactId,
      specArtifactIds: Array.from(new Set([...(spec.specArtifactIds ?? []), ...nodeArtifacts.map((artifact) => artifact.id)])),
      compileStatus: toCompileStatus(spec, compiledArtifact, backtestArtifact),
      compiledPath: compiledArtifact?.compiledPath ?? spec.compiledPath,
      stdout: compiledArtifact?.stdout ?? spec.stdout,
      stderr: compiledArtifact?.stderr ?? backtestArtifact?.backtestStderr ?? spec.stderr,
    };
  });

  return {
    ...harness,
    blueprint: {
      ...blueprint,
      agents,
      capabilities: capabilityNodes,
      specs,
    },
    agentNodes: agents,
    capabilityNodes,
    specArtifacts,
    edges: blueprint.edges,
    updatedAt: nowIso(),
  };
}

export async function createHarness(input: Partial<CreateHarnessRequest> = {}): Promise<Harness> {
  const draft = seedDraft(input);
  saveHarness(draft);

  persistAndBroadcast(
    createEvent(draft.id, "system", "intake", "intake.received", "Harness draft created.", {
      harnessStatus: draft.status,
      goal: draft.intake.goal,
      mainModel: draft.intake.mainModel,
      auxiliaryModel: draft.intake.auxiliaryModel,
      codingAgentModel: draft.intake.codingAgentModel,
      capabilityPolicy: draft.intake.capabilityPolicy,
    }),
  );

  persistAndBroadcast(
    createEvent(draft.id, "system", "intake", "draft.created", "Harness draft created and ready for build orchestration.", {
      harnessId: draft.id,
      status: draft.status,
    }),
  );

  return getHarnessById(draft.id) ?? draft;
}

export async function startHarnessBuild(harnessId: string, _request: BuildHarnessRequest = {}): Promise<Harness | null> {
  const outcome = await new BuildOrchestratorService().runBuild(harnessId, _request);
  return outcome?.harness ?? null;
}

export function getHarness(harnessId: string): Harness | null {
  return getHarnessById(harnessId);
}

export function getHarnessEvents(harnessId: string): HarnessEvent[] {
  return listHarnessEvents(harnessId);
}

export function subscribeToHarnessEvents(harnessId: string, listener: (event: HarnessEvent) => void): () => void {
  return subscribeHarnessEvents(harnessId, listener);
}

function collectArtifactsFromError(error: unknown): SpecArtifact[] {
  if (error && typeof error === "object" && "artifacts" in error) {
    const artifacts = (error as { artifacts?: SpecArtifact[] }).artifacts;
    return artifacts ?? [];
  }
  return [];
}

function deriveCodingAgentModel(mainModel: CreateHarnessRequest["mainModel"]): CreateHarnessRequest["codingAgentModel"] {
  return {
    ...mainModel,
    model: "qwen3-coder-plus",
  };
}
