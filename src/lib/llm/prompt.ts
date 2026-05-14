import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CapabilityPolicy, ModelConfig } from "shared/types";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const promptPath = path.join(MODULE_DIR, "../../../shared/prompts/planner.prompt.md");

export function loadPlannerPromptTemplate(): string {
  return fs.readFileSync(promptPath, "utf8");
}

export function renderPlannerPrompt(args: {
  goal: string;
  mainModel: ModelConfig;
  auxiliaryModel: ModelConfig;
  codingAgentModel: ModelConfig;
  capabilityPolicy: CapabilityPolicy;
  blueprintSpecJson: string;
  blueprintSchemaJson: string;
}): string {
  return loadPlannerPromptTemplate()
    .replace("{{blueprint_spec_json}}", args.blueprintSpecJson)
    .replace("{{blueprint_schema_json}}", args.blueprintSchemaJson)
    .replace("{{goal}}", args.goal)
    .replace("{{main_model_json}}", JSON.stringify(args.mainModel, null, 2))
    .replace("{{aux_model_json}}", JSON.stringify(args.auxiliaryModel, null, 2))
    .replace("{{coding_model_json}}", JSON.stringify(args.codingAgentModel, null, 2))
    .replace("{{capability_policy_json}}", JSON.stringify(args.capabilityPolicy, null, 2));
}
