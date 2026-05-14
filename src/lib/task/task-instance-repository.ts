import { makeId } from "@/lib/id";
import { nowIso } from "@/lib/time";
import { createArtifact, getArtifactById } from "@/lib/artifact-repository";
import { getDatabase } from "@/lib/sqlite";
import { createTaskInstanceText, normalizeTaskInstance } from "@/lib/task/task-instance";
import type { RunArtifact, TaskAgentAssignment, TaskDeliverableContract, TaskInstance } from "shared/types";

interface TaskInstanceRow {
  id: string;
  run_id: string;
  harness_id: string;
  task_instruction: string;
  goal: string;
  constraints_json: string;
  success_criteria_json: string;
  per_agent_assignments_json: string;
  final_deliverable_json: string;
  planning_summary: string;
  created_at: string;
  updated_at: string;
}

export interface CreateTaskInstanceInput {
  runId: string;
  harnessId: string;
  instruction: string;
  taskInstruction: string;
  goal: string;
  constraints: string[];
  successCriteria: string[];
  perAgentAssignments: TaskAgentAssignment[];
  finalDeliverable: TaskDeliverableContract;
  planningSummary: string;
}

export function createTaskInstance(input: CreateTaskInstanceInput): { taskInstance: TaskInstance; artifact: RunArtifact } {
  const db = getDatabase();
  const createdAt = nowIso();
  const taskInstance: TaskInstance = normalizeTaskInstance({
    id: makeId("task"),
    runId: input.runId,
    harnessId: input.harnessId,
    instruction: input.instruction,
    taskInstruction: input.taskInstruction,
    goal: input.goal,
    constraints: input.constraints,
    successCriteria: input.successCriteria,
    perAgentAssignments: input.perAgentAssignments,
    finalDeliverable: input.finalDeliverable,
    planningSummary: input.planningSummary,
    createdAt,
    updatedAt: createdAt,
  });

  db.prepare(
    `
    INSERT INTO task_instances (
      id, run_id, harness_id, task_instruction, goal, constraints_json, success_criteria_json,
      per_agent_assignments_json, final_deliverable_json, planning_summary, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      task_instruction=excluded.task_instruction,
      goal=excluded.goal,
      constraints_json=excluded.constraints_json,
      success_criteria_json=excluded.success_criteria_json,
      per_agent_assignments_json=excluded.per_agent_assignments_json,
      final_deliverable_json=excluded.final_deliverable_json,
      planning_summary=excluded.planning_summary,
      updated_at=excluded.updated_at
  `,
  ).run(
    taskInstance.id,
    taskInstance.runId,
    taskInstance.harnessId,
    taskInstance.instruction,
    taskInstance.goal,
    JSON.stringify(taskInstance.constraints),
    JSON.stringify(taskInstance.successCriteria),
    JSON.stringify(taskInstance.perAgentAssignments),
    JSON.stringify(taskInstance.finalDeliverable),
    taskInstance.planningSummary,
    taskInstance.createdAt,
    taskInstance.updatedAt,
  );

  const artifact = createArtifact({
    id: taskInstance.id,
    runId: taskInstance.runId,
    harnessId: taskInstance.harnessId,
    nodeId: null,
    type: "task.instance",
    title: "Task Instance",
    summary: taskInstance.goal,
    contentJson: taskInstance,
    contentText: createTaskInstanceText(taskInstance),
    createdAt: taskInstance.createdAt,
  });

  return { taskInstance, artifact };
}

export function getTaskInstanceByRunId(runId: string): TaskInstance | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `
      SELECT id, run_id, harness_id, task_instruction, goal, constraints_json, success_criteria_json,
             per_agent_assignments_json, final_deliverable_json, planning_summary, created_at, updated_at
      FROM task_instances
      WHERE run_id = ?
    `,
    )
    .get(runId) as TaskInstanceRow | undefined;

  if (!row) {
    return null;
  }

  return normalizeTaskInstance({
    id: row.id,
    runId: row.run_id,
    harnessId: row.harness_id,
    instruction: row.task_instruction,
    taskInstruction: row.task_instruction,
    goal: row.goal,
    constraints: parseJson<string[]>(row.constraints_json, []),
    successCriteria: parseJson<string[]>(row.success_criteria_json, []),
    perAgentAssignments: parseJson<TaskAgentAssignment[]>(row.per_agent_assignments_json, []),
    finalDeliverable: parseJson<TaskDeliverableContract>(row.final_deliverable_json, {
      artifactType: "final.deliverable",
      ownerAgentId: "",
      ownerAgentRole: "",
      title: "",
      format: "",
      summary: "",
      requiredFields: [],
    }),
    planningSummary: row.planning_summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function getTaskInstanceArtifactByRunId(runId: string): RunArtifact | null {
  const taskInstance = getTaskInstanceByRunId(runId);
  if (!taskInstance) {
    return null;
  }
  return getArtifactById(taskInstance.id);
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
