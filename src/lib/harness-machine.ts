import type { Harness, HarnessStatus, RequirementIntake } from "shared/types";
import { nowIso } from "@/lib/time";
import { readLLMSettings } from "@/lib/env";

export function createHarnessDraft(name = "Harness Draft"): Harness {
  const createdAt = nowIso();
  return {
    id: "",
    name,
    status: "draft",
    intake: createDefaultIntake(),
    blueprint: null,
    specArtifacts: [],
    agentNodes: [],
    capabilityNodes: [],
    edges: [],
    createdAt,
    updatedAt: createdAt,
    events: [],
  };
}

export function applyHarnessIntake(harness: Harness, intake: RequirementIntake): Harness {
  const nextStatus = harness.status === "ready" ? "dirty" : "draft_ready";
  return transitionHarness(harness, nextStatus, {
    intake,
    name: intake.goal.trim().length > 0 ? intake.goal.trim().slice(0, 120) : harness.name,
  });
}

export function markHarnessBuilding(harness: Harness): Harness {
  return transitionHarness(harness, "building");
}

export function markHarnessReady(harness: Harness): Harness {
  return transitionHarness(harness, "ready");
}

export function markHarnessFailed(harness: Harness): Harness {
  return transitionHarness(harness, "failed");
}

export function markHarnessDirty(harness: Harness): Harness {
  return transitionHarness(harness, "dirty");
}

export function canTransitionHarnessStatus(current: HarnessStatus, next: HarnessStatus): boolean {
  if (current === next) {
    return true;
  }
  if (next === "building") {
    return current === "draft" || current === "draft_ready" || current === "dirty" || current === "ready" || current === "failed";
  }
  if (next === "draft_ready") {
    return current === "draft" || current === "dirty" || current === "failed" || current === "draft_ready";
  }
  if (next === "dirty") {
    return current === "ready" || current === "draft_ready" || current === "dirty";
  }
  if (next === "ready") {
    return current === "building" || current === "draft_ready" || current === "dirty";
  }
  if (next === "failed") {
    return current === "building" || current === "draft_ready" || current === "dirty" || current === "ready";
  }
  return current === "draft" && next === "draft";
}

export function transitionHarness(harness: Harness, nextStatus: HarnessStatus, patch: Partial<Pick<Harness, "name" | "intake" | "blueprint" | "specArtifacts" | "agentNodes" | "capabilityNodes" | "edges">> = {}): Harness {
  if (!canTransitionHarnessStatus(harness.status, nextStatus)) {
    throw new Error(`Invalid harness status transition from ${harness.status} to ${nextStatus}.`);
  }

  return {
    ...harness,
    ...patch,
    status: nextStatus,
    blueprint: patch.blueprint
      ? {
          ...patch.blueprint,
          harness: {
            ...patch.blueprint.harness,
            status: nextStatus,
          },
        }
      : harness.blueprint
        ? {
            ...harness.blueprint,
            harness: {
              ...harness.blueprint.harness,
              status: nextStatus,
            },
          }
        : harness.blueprint,
    updatedAt: nowIso(),
  };
}

function createDefaultIntake(): RequirementIntake {
  const llmSettings = readLLMSettings();
  const mainModel = {
    provider: llmSettings.provider,
    model: llmSettings.model,
    baseURL: llmSettings.baseURL,
    credentialRef: llmSettings.credentialRef,
    temperature: llmSettings.temperature,
    maxTokens: llmSettings.maxTokens,
  };
  return {
    goal: "",
    mainModel,
    auxiliaryModel: {
      ...mainModel,
      model: "qwen3.6-plus",
      temperature: 0.1,
      maxTokens: 2048,
    },
    codingAgentModel: {
      ...mainModel,
      model: "qwen3-coder-plus",
    },
    capabilityPolicy: {
      allowGithubSearch: true,
      allowAutoGenerateSkill: true,
      allowAutoGenerateScript: true,
    },
  };
}
