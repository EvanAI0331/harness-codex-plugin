import Ajv from "ajv/dist/2020";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Harness, RunParameter, RunPolicy, TaskAgentAssignment, TaskDeliverableContract } from "shared/types";
import type { LLMAdapter } from "@/lib/llm/types";
import { renderTaskInstancePrompt } from "@/lib/runtime/task-instance-prompt";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(MODULE_DIR, "../../../shared/schemas/task-instance.schema.json");

const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(loadSchemaObject() as object);

export interface TaskInstancePlan {
  goal: string;
  constraints: string[];
  successCriteria: string[];
  perAgentAssignments: TaskAgentAssignment[];
  finalDeliverable: TaskDeliverableContract;
  planningSummary: string;
}

export interface TaskInstancePlannerInput {
  harness: Harness;
  taskInstruction: string;
  parameters: RunParameter[];
  policy: RunPolicy;
  onProgress?: (update: TaskInstancePlannerProgressUpdate) => void;
}

export interface TaskInstancePlannerProgressUpdate {
  segment: "goal" | "criteria" | "assignment" | "deliverable" | "summary";
  status: "started" | "completed";
  summary?: string;
  agentId?: string;
}

interface GoalDraft {
  goal: string;
}

interface CriteriaDraft {
  constraints: string[];
  successCriteria: string[];
}

interface AssignmentDraft {
  objective: string;
  expectedArtifacts: string[];
  capabilityFocus: string[];
}

interface DeliverableDraft {
  finalDeliverable: TaskDeliverableContract;
}

export class TaskInstancePlannerAdapter {
  constructor(private readonly llm: LLMAdapter) {}

  async plan(input: TaskInstancePlannerInput): Promise<TaskInstancePlan> {
    const context = buildContext(input);

    input.onProgress?.({ segment: "goal", status: "started" });
    const goalDraft = await this.planGoal(input, context);
    input.onProgress?.({ segment: "goal", status: "completed", summary: goalDraft.goal });

    input.onProgress?.({ segment: "criteria", status: "started" });
    const criteriaDraft = await this.planCriteria(input, context, goalDraft);
    input.onProgress?.({
      segment: "criteria",
      status: "completed",
      summary: `${criteriaDraft.constraints.length} constraints, ${criteriaDraft.successCriteria.length} success criteria`,
    });

    const perAgentAssignments = await this.planAssignments(input, context, goalDraft, criteriaDraft);

    input.onProgress?.({
      segment: "deliverable",
      status: "started",
    });
    const finalDeliverable = await this.planDeliverable(input, context, goalDraft, criteriaDraft, perAgentAssignments);
    input.onProgress?.({
      segment: "deliverable",
      status: "completed",
      summary: `${finalDeliverable.ownerAgentRole} delivers ${finalDeliverable.title}`,
    });

    input.onProgress?.({
      segment: "summary",
      status: "started",
    });
    const planningSummary = buildPlanningSummary(goalDraft, criteriaDraft, perAgentAssignments, finalDeliverable);
    input.onProgress?.({
      segment: "summary",
      status: "completed",
      summary: planningSummary,
    });

    const parsed: TaskInstancePlan = {
      goal: goalDraft.goal,
      constraints: criteriaDraft.constraints,
      successCriteria: criteriaDraft.successCriteria,
      perAgentAssignments,
      finalDeliverable,
      planningSummary,
    };

    if (!validate(parsed)) {
      throw new Error(
        `Task instance planning schema validation failed: ${(validate.errors ?? [])
          .map((error) => `${error.instancePath || "/"} ${error.message || "invalid"}`)
          .join("; ")}`,
      );
    }

    return parsed;
  }

  private async planDeliverable(
    input: TaskInstancePlannerInput,
    context: TaskInstancePlannerContext,
    goalDraft: GoalDraft,
    criteriaDraft: CriteriaDraft,
    assignments: TaskAgentAssignment[],
  ): Promise<TaskDeliverableContract> {
    const response = await this.llm.generateJson({
      config: buildStageModelConfig(input.harness.intake.mainModel, 512),
      systemPrompt: renderTaskInstancePrompt("deliverable", {
        ...context.minimal,
        extraReplacements: {
          criteria_draft_json: JSON.stringify(criteriaDraft, null, 2),
          assignments_json: JSON.stringify(assignments, null, 2),
        },
        stageResultJson: JSON.stringify(goalDraft, null, 2),
      }),
      userPrompt: JSON.stringify(
        {
          harnessId: input.harness.id,
          taskInstruction: input.taskInstruction,
          goalDraft,
          criteriaDraft,
          assignments,
        },
        null,
        2,
      ),
      schemaName: "TaskInstanceDeliverableDraft",
    });

    const parsed = parseJsonResponse<DeliverableDraft>(response.rawText, "Task instance deliverable planning");
    try {
      validateDeliverableDraft(parsed);
      return assertDeliverableOwner(parsed.finalDeliverable, assignments);
    } catch (error) {
      const repaired = await this.retryDeliverableDraft({
        input,
        context,
        goalDraft,
        criteriaDraft,
        assignments,
        failureReason: error instanceof Error ? error.message : String(error),
      });
      validateDeliverableDraft(repaired);
      return assertDeliverableOwner(repaired.finalDeliverable, assignments);
    }
  }

  private async planGoal(input: TaskInstancePlannerInput, context: TaskInstancePlannerContext): Promise<GoalDraft> {
    const response = await this.llm.generateJson({
      config: buildStageModelConfig(input.harness.intake.mainModel, 1024),
      systemPrompt: renderTaskInstancePrompt("goal", {
        ...context.minimal,
        stageResultJson: "",
      }),
      userPrompt: JSON.stringify(
        {
          harnessId: input.harness.id,
          taskInstruction: input.taskInstruction,
        },
        null,
        2,
      ),
      schemaName: "TaskInstanceGoalDraft",
    });

    const parsed = parseJsonResponse<GoalDraft>(response.rawText, "Task instance goal planning");
    validateGoalDraft(parsed);
    return parsed;
  }

  private async planCriteria(
    input: TaskInstancePlannerInput,
    context: TaskInstancePlannerContext,
    goalDraft: GoalDraft,
  ): Promise<CriteriaDraft> {
    const response = await this.llm.generateJson({
      config: buildStageModelConfig(input.harness.intake.mainModel, 1536),
      systemPrompt: renderTaskInstancePrompt("criteria", {
        ...context.minimal,
        stageResultJson: JSON.stringify(goalDraft, null, 2),
      }),
      userPrompt: JSON.stringify(
        {
          harnessId: input.harness.id,
          taskInstruction: input.taskInstruction,
          goalDraft,
        },
        null,
        2,
      ),
      schemaName: "TaskInstanceCriteriaDraft",
    });

    const parsed = parseJsonResponse<CriteriaDraft>(response.rawText, "Task instance criteria planning");
    validateCriteriaDraft(parsed);
    return parsed;
  }

  private async planAssignments(
    input: TaskInstancePlannerInput,
    context: TaskInstancePlannerContext,
    goalDraft: GoalDraft,
    criteriaDraft: CriteriaDraft,
  ): Promise<TaskAgentAssignment[]> {
    const orderedAgents = [...input.harness.agentNodes].sort((left, right) => left.executionOrder - right.executionOrder);
    const assignments: TaskAgentAssignment[] = [];

    for (const agent of orderedAgents) {
      input.onProgress?.({
        segment: "assignment",
        status: "started",
        agentId: agent.id,
        summary: agent.label,
      });
      const availableCapabilities = input.harness.capabilityNodes.filter((capability) =>
        agent.capabilityIds.includes(capability.id),
      );
      const response = await this.llm.generateJson({
        config: buildStageModelConfig(input.harness.intake.mainModel, 512),
        systemPrompt: renderTaskInstancePrompt("assignment", {
          ...context.minimal,
          extraReplacements: {
            available_capabilities_json: JSON.stringify(
              availableCapabilities.map((capability) => ({
                id: capability.id,
                label: capability.label,
                capabilityType: capability.capabilityType,
                source: capability.source,
                status: capability.status,
              })),
              null,
              2,
            ),
            criteria_draft_json: JSON.stringify(criteriaDraft, null, 2),
            agent_summary_json: JSON.stringify(
              {
                id: agent.id,
                label: agent.label,
                role: agent.role,
                agentKind: agent.agentKind,
                executionOrder: agent.executionOrder,
                capabilityIds: agent.capabilityIds,
              },
              null,
              2,
            ),
            prior_assignments_json: JSON.stringify(
              assignments.map((assignment) => ({
                agentId: assignment.agentId,
                agentRole: assignment.agentRole,
              })),
              null,
              2,
            ),
          },
        }),
        userPrompt: JSON.stringify(
          {
            harnessId: input.harness.id,
            taskInstruction: input.taskInstruction,
            goalDraft,
            criteriaDraft,
            agentId: agent.id,
          },
          null,
          2,
        ),
        schemaName: "TaskInstanceAssignmentDraft",
      });

      const partial = parseJsonResponse<AssignmentDraft>(response.rawText, `Task instance assignment planning for ${agent.id}`);
      try {
        validateAssignmentDraft(partial);
      } catch (error) {
        const repaired = await this.retryAssignmentDraft({
          input,
          context,
          goalDraft,
          criteriaDraft,
          agent,
          assignments,
          failureReason: error instanceof Error ? error.message : String(error),
          availableCapabilities,
        });
        validateAssignmentDraft(repaired);
        const assignment = buildTaskAgentAssignment(agent, repaired, assignments);
        assignments.push(assignment);
        input.onProgress?.({
          segment: "assignment",
          status: "completed",
          agentId: agent.id,
          summary: assignment.objective,
        });
        continue;
      }
      const assignment = buildTaskAgentAssignment(agent, partial, assignments);
      assignments.push(assignment);
      input.onProgress?.({
        segment: "assignment",
        status: "completed",
        agentId: agent.id,
        summary: assignment.objective,
      });
    }

    return assignments;
  }

  private async retryAssignmentDraft(args: {
    input: TaskInstancePlannerInput;
    context: TaskInstancePlannerContext;
    goalDraft: GoalDraft;
    criteriaDraft: CriteriaDraft;
    agent: Harness["agentNodes"][number];
    assignments: TaskAgentAssignment[];
    failureReason: string;
    availableCapabilities: Harness["capabilityNodes"];
  }): Promise<AssignmentDraft> {
    const response = await this.llm.generateJson({
      config: buildStageModelConfig(args.input.harness.intake.mainModel, 512),
      systemPrompt: renderTaskInstancePrompt("assignment", {
        ...args.context.minimal,
        extraReplacements: {
          available_capabilities_json: JSON.stringify(
            args.availableCapabilities.map((capability) => ({
              id: capability.id,
              label: capability.label,
              capabilityType: capability.capabilityType,
              source: capability.source,
              status: capability.status,
            })),
            null,
            2,
          ),
          criteria_draft_json: JSON.stringify(args.criteriaDraft, null, 2),
          agent_summary_json: JSON.stringify(
            {
              id: args.agent.id,
              label: args.agent.label,
              role: args.agent.role,
              agentKind: args.agent.agentKind,
              executionOrder: args.agent.executionOrder,
              capabilityIds: args.agent.capabilityIds,
            },
            null,
            2,
          ),
          prior_assignments_json: JSON.stringify(
            args.assignments.map((assignment) => ({
              agentId: assignment.agentId,
              agentRole: assignment.agentRole,
            })),
            null,
            2,
          ),
          failure_reason_json: JSON.stringify(args.failureReason, null, 2),
        },
      }),
      userPrompt: JSON.stringify(
        {
          harnessId: args.input.harness.id,
          taskInstruction: args.input.taskInstruction,
          goalDraft: args.goalDraft,
          criteriaDraft: args.criteriaDraft,
          agentId: args.agent.id,
          failureReason: args.failureReason,
        },
        null,
        2,
      ),
      schemaName: "TaskInstanceAssignmentDraft",
    });

    return parseJsonResponse<AssignmentDraft>(response.rawText, `Task instance assignment retry for ${args.agent.id}`);
  }

  private async retryDeliverableDraft(args: {
    input: TaskInstancePlannerInput;
    context: TaskInstancePlannerContext;
    goalDraft: GoalDraft;
    criteriaDraft: CriteriaDraft;
    assignments: TaskAgentAssignment[];
    failureReason: string;
  }): Promise<DeliverableDraft> {
    const response = await this.llm.generateJson({
      config: buildStageModelConfig(args.input.harness.intake.mainModel, 512),
      systemPrompt: renderTaskInstancePrompt("deliverable", {
        ...args.context.minimal,
        extraReplacements: {
          criteria_draft_json: JSON.stringify(args.criteriaDraft, null, 2),
          assignments_json: JSON.stringify(args.assignments, null, 2),
          failure_reason_json: JSON.stringify(args.failureReason, null, 2),
        },
        stageResultJson: JSON.stringify(args.goalDraft, null, 2),
      }),
      userPrompt: JSON.stringify(
        {
          harnessId: args.input.harness.id,
          taskInstruction: args.input.taskInstruction,
          goalDraft: args.goalDraft,
          criteriaDraft: args.criteriaDraft,
          assignments: args.assignments,
          failureReason: args.failureReason,
        },
        null,
        2,
      ),
      schemaName: "TaskInstanceDeliverableDraft",
    });

    return parseJsonResponse<DeliverableDraft>(response.rawText, "Task instance deliverable retry");
  }

}

interface TaskInstancePlannerContext {
  minimal: {
    harnessSummaryJson: string;
    blueprintSummaryJson: string;
    runPolicyJson: string;
    runParametersJson: string;
    taskInstruction: string;
  };
}

function buildContext(input: TaskInstancePlannerInput): TaskInstancePlannerContext {
  return {
    minimal: {
      harnessSummaryJson: JSON.stringify(buildHarnessSummary(input.harness), null, 2),
      blueprintSummaryJson: JSON.stringify(buildBlueprintSummary(input.harness), null, 2),
      runPolicyJson: JSON.stringify(input.policy, null, 2),
      runParametersJson: JSON.stringify(input.parameters, null, 2),
      taskInstruction: input.taskInstruction,
    },
  };
}

function buildStageModelConfig(model: Harness["intake"]["mainModel"], tokenBudget: number): Harness["intake"]["mainModel"] {
  return {
    ...model,
    maxTokens: Math.max(256, Math.min(model.maxTokens, tokenBudget)),
  };
}

function parseJsonResponse<T>(rawText: string, label: string): T {
  try {
    return JSON.parse(rawText) as T;
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateGoalDraft(value: GoalDraft): void {
  if (!value || typeof value !== "object") {
    throw new Error("Task instance goal planning returned an invalid object.");
  }
  if (typeof value.goal !== "string" || value.goal.trim().length === 0) {
    throw new Error("Task instance goal planning must include a non-empty goal.");
  }
}

function validateCriteriaDraft(value: CriteriaDraft): void {
  if (!value || typeof value !== "object") {
    throw new Error("Task instance criteria planning returned an invalid object.");
  }
  if (
    !Array.isArray(value.constraints) ||
    value.constraints.length === 0 ||
    value.constraints.some((item) => typeof item !== "string" || item.trim().length === 0)
  ) {
    throw new Error("Task instance criteria planning must include non-empty constraints.");
  }
  if (
    !Array.isArray(value.successCriteria) ||
    value.successCriteria.length === 0 ||
    value.successCriteria.some((item) => typeof item !== "string" || item.trim().length === 0)
  ) {
    throw new Error("Task instance criteria planning must include non-empty success criteria.");
  }
}

function validateAssignmentDraft(value: AssignmentDraft): void {
  if (!value || typeof value !== "object") {
    throw new Error("Task instance assignment planning returned an invalid object.");
  }
  if (typeof value.objective !== "string" || value.objective.trim().length === 0) {
    throw new Error("Task instance assignment planning must include a non-empty objective.");
  }
  if (
    !Array.isArray(value.expectedArtifacts) ||
    value.expectedArtifacts.length === 0 ||
    value.expectedArtifacts.some((item) => typeof item !== "string" || item.trim().length === 0)
  ) {
    throw new Error("Task instance assignment planning must include non-empty expected artifacts.");
  }
  if (
    !Array.isArray(value.capabilityFocus) ||
    value.capabilityFocus.length === 0 ||
    value.capabilityFocus.some((item) => typeof item !== "string" || item.trim().length === 0)
  ) {
    throw new Error("Task instance assignment planning must include non-empty capability focus.");
  }
}

function validateDeliverableDraft(value: DeliverableDraft): void {
  if (!value || typeof value !== "object") {
    throw new Error("Task instance deliverable planning returned an invalid object.");
  }
  const deliverable = value.finalDeliverable;
  if (!deliverable || typeof deliverable !== "object") {
    throw new Error("Task instance deliverable planning must include finalDeliverable.");
  }
  if (deliverable.artifactType !== "final.deliverable") {
    throw new Error("Task instance final deliverable must use artifactType final.deliverable.");
  }
  if (typeof deliverable.ownerAgentId !== "string" || deliverable.ownerAgentId.trim().length === 0) {
    throw new Error("Task instance final deliverable must include an ownerAgentId.");
  }
  if (typeof deliverable.ownerAgentRole !== "string" || deliverable.ownerAgentRole.trim().length === 0) {
    throw new Error("Task instance final deliverable must include an ownerAgentRole.");
  }
  if (typeof deliverable.title !== "string" || deliverable.title.trim().length === 0) {
    throw new Error("Task instance final deliverable must include a title.");
  }
  if (typeof deliverable.format !== "string" || deliverable.format.trim().length === 0) {
    throw new Error("Task instance final deliverable must include a format.");
  }
  if (typeof deliverable.summary !== "string" || deliverable.summary.trim().length === 0) {
    throw new Error("Task instance final deliverable must include a summary.");
  }
  if (
    !Array.isArray(deliverable.requiredFields) ||
    deliverable.requiredFields.length === 0 ||
    deliverable.requiredFields.some((item) => typeof item !== "string" || item.trim().length === 0)
  ) {
    throw new Error("Task instance final deliverable must include non-empty required fields.");
  }
}

function assertDeliverableOwner(
  deliverable: TaskDeliverableContract,
  assignments: TaskAgentAssignment[],
): TaskDeliverableContract {
  const owner = assignments.find((assignment) => assignment.agentId === deliverable.ownerAgentId);
  if (!owner) {
    throw new Error(`Task instance final deliverable must be assigned to an existing agent: ${deliverable.ownerAgentId}`);
  }
  if (owner.agentRole !== deliverable.ownerAgentRole) {
    throw new Error(`Task instance final deliverable owner role mismatch for ${deliverable.ownerAgentId}.`);
  }
  return deliverable;
}

function buildTaskAgentAssignment(
  agent: Harness["agentNodes"][number],
  draft: AssignmentDraft,
  priorAssignments: TaskAgentAssignment[],
): TaskAgentAssignment {
  const priorAgentIds = priorAssignments.map((assignment) => assignment.agentId);
  const handoffFrom = priorAgentIds.length > 0 ? [priorAgentIds[priorAgentIds.length - 1]] : [];
  const dependencies = priorAgentIds.length > 0 ? priorAgentIds : handoffFrom;
  return {
    agentId: agent.id,
    agentRole: agent.role,
    objective: draft.objective,
    expectedArtifacts: draft.expectedArtifacts,
    dependencies,
    capabilityFocus: draft.capabilityFocus,
    handoffFrom,
  };
}

function isValidTaskAgentAssignment(value: unknown): value is TaskAgentAssignment {
  if (!value || typeof value !== "object") {
    return false;
  }

  const assignment = value as TaskAgentAssignment & {
    agentId?: unknown;
    agentRole?: unknown;
    objective?: unknown;
    expectedArtifacts?: unknown;
    dependencies?: unknown;
    capabilityFocus?: unknown;
  };

  return (
    typeof assignment.agentId === "string" &&
    assignment.agentId.trim().length > 0 &&
    typeof assignment.agentRole === "string" &&
    assignment.agentRole.trim().length > 0 &&
    typeof assignment.objective === "string" &&
    assignment.objective.trim().length > 0 &&
    Array.isArray(assignment.expectedArtifacts) &&
    assignment.expectedArtifacts.length > 0 &&
    assignment.expectedArtifacts.every((item) => typeof item === "string" && item.trim().length > 0) &&
    Array.isArray(assignment.dependencies) &&
    assignment.dependencies.every((item) => typeof item === "string" && item.trim().length > 0) &&
    Array.isArray(assignment.capabilityFocus) &&
    assignment.capabilityFocus.length > 0 &&
    assignment.capabilityFocus.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}

function loadSchema(): string {
  return fs.readFileSync(SCHEMA_PATH, "utf8");
}

function loadSchemaObject(): object {
  return JSON.parse(loadSchema()) as object;
}

function buildHarnessSummary(harness: Harness): Record<string, unknown> {
  return {
    id: harness.id,
    name: harness.name,
    status: harness.status,
    goal: harness.intake.goal,
    capabilityPolicy: harness.intake.capabilityPolicy,
    agentCount: harness.agentNodes.length,
    capabilityCount: harness.capabilityNodes.length,
  };
}

function buildBlueprintSummary(harness: Harness): Record<string, unknown> {
  return {
    summary: harness.blueprint?.summary ?? "",
    agents: harness.agentNodes.map((agent) => ({
      id: agent.id,
      label: agent.label,
      role: agent.role,
      agentKind: agent.agentKind,
      capabilityIds: agent.capabilityIds,
    })),
    capabilities: harness.capabilityNodes.map((capability) => ({
      id: capability.id,
      label: capability.label,
      capabilityType: capability.capabilityType,
      source: capability.source,
      status: capability.status,
      policyFlags: capability.policyFlags,
    })),
  };
}

function buildPlanningSummary(
  goalDraft: GoalDraft,
  criteriaDraft: CriteriaDraft,
  assignments: TaskAgentAssignment[],
  finalDeliverable: TaskDeliverableContract,
): string {
  const assignmentSummaries = assignments.map((assignment) => {
    const capabilityFocus = assignment.capabilityFocus.slice(0, 2).join("、");
    const artifactFocus = assignment.expectedArtifacts.slice(0, 2).join("、");
    return `${assignment.agentRole}: ${assignment.objective} [${capabilityFocus}] -> ${artifactFocus}`;
  });

  const summaryParts = [
    `目标：${goalDraft.goal}`,
    `约束${criteriaDraft.constraints.length}项，成功标准${criteriaDraft.successCriteria.length}项`,
    `最终交付物：${finalDeliverable.title}，由${finalDeliverable.ownerAgentRole}负责，形式：${finalDeliverable.format}`,
    `分工：${assignmentSummaries.join("；")}`,
  ];

  const summary = summaryParts.join("。");
  return summary.length <= 2000 ? summary : summary.slice(0, 1997) + "...";
}
