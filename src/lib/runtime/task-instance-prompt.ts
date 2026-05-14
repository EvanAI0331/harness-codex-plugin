import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_PATHS = {
  goal: path.join(MODULE_DIR, "../../../shared/prompts/task-instance.goal.prompt.md"),
  criteria: path.join(MODULE_DIR, "../../../shared/prompts/task-instance.criteria.prompt.md"),
  assignment: path.join(MODULE_DIR, "../../../shared/prompts/task-instance.assignment.prompt.md"),
  assignments: path.join(MODULE_DIR, "../../../shared/prompts/task-instance.assignments.prompt.md"),
  deliverable: path.join(MODULE_DIR, "../../../shared/prompts/task-instance.deliverable.prompt.md"),
  summary: path.join(MODULE_DIR, "../../../shared/prompts/task-instance.summary.prompt.md"),
} as const;

export type TaskInstancePromptSegment = keyof typeof PROMPT_PATHS;

export function renderTaskInstancePrompt(
  segment: TaskInstancePromptSegment,
  args: {
    harnessSummaryJson: string;
    blueprintSummaryJson: string;
    runPolicyJson: string;
    runParametersJson: string;
    taskInstruction: string;
    stageResultJson?: string;
    extraReplacements?: Record<string, string>;
  },
): string {
  const prompt = fs.readFileSync(PROMPT_PATHS[segment], "utf8");
  const replacements: Record<string, string> = {
    harness_summary_json: args.harnessSummaryJson,
    blueprint_summary_json: args.blueprintSummaryJson,
    run_policy_json: args.runPolicyJson,
    run_parameters_json: args.runParametersJson,
    task_instruction: args.taskInstruction,
    stage_result_json: args.stageResultJson ?? "",
    available_capabilities_json: "",
    criteria_draft_json: "",
    agent_summary_json: "",
    prior_assignments_json: "",
    assignments_json: "",
    failure_reason_json: "",
    ...(args.extraReplacements ?? {}),
  };

  return Object.entries(replacements).reduce(
    (accumulator, [key, value]) => accumulator.replace(new RegExp(`{{${key}}}`, "g"), value),
    prompt,
  );
}
