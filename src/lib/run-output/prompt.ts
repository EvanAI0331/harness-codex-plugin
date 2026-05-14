import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const promptPath = path.join(MODULE_DIR, "../../../shared/prompts/run.task-output.prompt.md");

export function renderRunOutputPrompt(args: {
  taskOutputSpecJson: string;
  taskOutputSchemaJson: string;
  harnessSummaryJson: string;
  taskInstanceJson: string;
  finalDeliverableJson: string;
  runtimeEvidenceJson: string;
  artifactRefsJson: string;
  taskInstruction: string;
}): string {
  return fs
    .readFileSync(promptPath, "utf8")
    .replace("{{task_output_spec_json}}", args.taskOutputSpecJson)
    .replace("{{task_output_schema_json}}", args.taskOutputSchemaJson)
    .replace("{{harness_summary_json}}", args.harnessSummaryJson)
    .replace("{{task_instance_json}}", args.taskInstanceJson)
    .replace("{{final_deliverable_json}}", args.finalDeliverableJson)
    .replace("{{runtime_evidence_json}}", args.runtimeEvidenceJson)
    .replace("{{artifact_refs_json}}", args.artifactRefsJson)
    .replace("{{task_instruction}}", args.taskInstruction);
}
