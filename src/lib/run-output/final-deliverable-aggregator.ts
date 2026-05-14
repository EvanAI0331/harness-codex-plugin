import type { Harness, RunArtifact, RunSession, TaskInstance } from "shared/types";
import { getRunFinalOutput, listArtifactsByRun } from "@/lib/artifact-repository";
import { getTaskInstanceArtifactByRunId, getTaskInstanceByRunId } from "@/lib/task/task-instance-repository";

export interface FinalDeliverableAggregationInput {
  harness: Harness;
  run: RunSession;
  taskInstance?: TaskInstance | null;
}

export interface FinalDeliverableAggregationOutcome {
  finalDeliverable: RunArtifact;
  keyArtifacts: RunArtifact[];
}

export function aggregateFinalDeliverableArtifacts(input: FinalDeliverableAggregationInput): FinalDeliverableAggregationOutcome {
  const keyArtifacts = collectKeyArtifacts(input.run.id);
  if (keyArtifacts.length === 0) {
    throw new Error(`Run ${input.run.id} has no agent output or tool result artifacts to aggregate.`);
  }

  const taskInstance = input.taskInstance ?? getTaskInstanceByRunId(input.run.id);
  const taskInstanceArtifact = getTaskInstanceArtifactByRunId(input.run.id);
  if (!taskInstanceArtifact) {
    throw new Error(`Run ${input.run.id} is missing a task.instance artifact.`);
  }
  const finalDeliverable = requireFinalDeliverableArtifact(input.run.id, taskInstance);
  const existing = getRunFinalOutput(input.run.id);
  if (existing && existing.id !== finalDeliverable.id) {
    throw new Error(`Run ${input.run.id} has multiple final deliverable artifacts.`);
  }

  return {
    finalDeliverable,
    keyArtifacts,
  };
}

function collectKeyArtifacts(runId: string): RunArtifact[] {
  const artifacts = listArtifactsByRun(runId);
  const latestByNode = new Map<string, RunArtifact>();
  for (const artifact of artifacts) {
    if (!artifact.nodeId) {
      continue;
    }
    if (artifact.type !== "agent.output" && artifact.type !== "tool.result") {
      continue;
    }
    if (!latestByNode.has(artifact.nodeId)) {
      latestByNode.set(artifact.nodeId, artifact);
    }
  }
  return Array.from(latestByNode.values());
}

function requireFinalDeliverableArtifact(runId: string, taskInstance: TaskInstance | null): RunArtifact {
  if (!taskInstance) {
    throw new Error(`Run ${runId} is missing a task instance.`);
  }
  if (!taskInstance.finalDeliverable || typeof taskInstance.finalDeliverable.ownerAgentId !== "string" || taskInstance.finalDeliverable.ownerAgentId.trim().length === 0) {
    throw new Error(`Run ${runId} is missing a final deliverable owner.`);
  }

  const artifacts = listArtifactsByRun(runId);
  const deliverableContractId = `${taskInstance.harnessId}:${taskInstance.id}:final`;
  const deliverable = artifacts.find(
    (artifact) =>
      artifact.type === "final.deliverable" &&
      artifact.nodeId === taskInstance.finalDeliverable.ownerAgentId &&
      readArtifactContractId(artifact) === deliverableContractId,
  );
  if (!deliverable) {
    throw new Error(`Run ${runId} is missing final deliverable contract ${deliverableContractId} from ${taskInstance.finalDeliverable.ownerAgentRole}.`);
  }
  return deliverable;
}

function readArtifactContractId(artifact: RunArtifact): string | null {
  const payload = artifact.contentJson;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const direct = (payload as { deliverableContractId?: unknown }).deliverableContractId;
  if (typeof direct === "string") {
    return direct;
  }

  const nested = (payload as { contentJson?: unknown }).contentJson;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
    return null;
  }
  const nestedContractId = (nested as { deliverableContractId?: unknown }).deliverableContractId;
  return typeof nestedContractId === "string" ? nestedContractId : null;
}
