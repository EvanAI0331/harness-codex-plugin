import type { TaskAgentAssignment, TaskDeliverableContract, TaskInstance } from "shared/types";

export type { TaskAgentAssignment, TaskDeliverableContract, TaskInstance } from "shared/types";

export function normalizeTaskInstance(value: TaskInstance): TaskInstance {
  return {
    ...value,
    instruction: value.instruction?.trim() || value.taskInstruction.trim(),
    taskInstruction: value.taskInstruction.trim(),
  };
}

export function createTaskInstanceText(taskInstance: TaskInstance): string {
  return [
    `# Task Instance`,
    ``,
    `Instruction: ${taskInstance.instruction}`,
    `Goal: ${taskInstance.goal}`,
    `Task Instruction: ${taskInstance.taskInstruction}`,
    ``,
    `## Constraints`,
    ...taskInstance.constraints.map((constraint) => `- ${constraint}`),
    ``,
    `## Success Criteria`,
    ...taskInstance.successCriteria.map((criterion) => `- ${criterion}`),
    ``,
    `## Per-Agent Assignment`,
    ...taskInstance.perAgentAssignments.map(
      (assignment) => `- ${assignment.agentRole}: ${assignment.objective} [${assignment.expectedArtifacts.join(", ")}]`,
    ),
    ``,
    `## Final Deliverable`,
    `- Owner: ${taskInstance.finalDeliverable.ownerAgentRole}`,
    `- Title: ${taskInstance.finalDeliverable.title}`,
    `- Format: ${taskInstance.finalDeliverable.format}`,
    `- Required Fields: ${taskInstance.finalDeliverable.requiredFields.join(", ")}`,
    `- Summary: ${taskInstance.finalDeliverable.summary}`,
    ``,
    `## Planning Summary`,
    taskInstance.planningSummary,
  ].join("\n");
}
