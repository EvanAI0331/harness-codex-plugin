import type { Harness } from "shared/types";
import { makeId } from "@/lib/id";
import { saveHarness } from "@/lib/harness-repository";
import { applyHarnessIntake, createHarnessDraft } from "@/lib/harness-machine";
import { readLLMSettings } from "@/lib/env";

export async function createDraftHarness(name?: string): Promise<Harness> {
  const draft = createHarnessDraft(name?.trim() || "Harness Draft");
  const harness: Harness = {
    ...draft,
    id: makeId("harness"),
    name: name?.trim() || draft.name,
  };

  saveHarness(harness);
  return harness;
}

export async function createDemoHarness(): Promise<Harness> {
  const llmSettings = readLLMSettings();
  const demoHarness = applyHarnessIntake(createHarnessDraft("Repository Audit Harness"), {
    goal: "Audit a repository, explain its architecture, verify execution boundaries, and summarize artifact-driven runtime readiness.",
    mainModel: llmSettings,
    auxiliaryModel: {
      ...llmSettings,
      temperature: 0.1,
      maxTokens: 2048,
    },
    codingAgentModel: {
      ...llmSettings,
      model: "qwen3-coder-plus",
    },
    capabilityPolicy: {
      allowGithubSearch: true,
      allowAutoGenerateSkill: true,
      allowAutoGenerateScript: true,
    },
  });

  const harness: Harness = {
    ...demoHarness,
    id: makeId("harness"),
    name: "Repository Audit Harness",
  };

  saveHarness(harness);
  return harness;
}
