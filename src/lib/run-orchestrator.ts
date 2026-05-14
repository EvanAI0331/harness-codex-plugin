import type { Harness, HarnessEvent, RunHarnessRequest, RunSession } from "shared/types";
import { createArtifact, toArtifactReference } from "@/lib/artifact-repository";
import { broadcastHarnessEvent } from "@/lib/harness-event-bus";
import { getHarnessById, saveHarness, saveHarnessEvent } from "@/lib/harness-repository";
import { completeRunSession, createRunSession, failRunSession } from "@/lib/run-machine";
import { RunOutputService } from "@/lib/run-output/service";
import { RuntimeExecutorService } from "@/lib/runtime/executor";
import { aggregateFinalDeliverableArtifacts } from "@/lib/run-output/final-deliverable-aggregator";
import { TaskInstancePlannerAdapter } from "@/lib/runtime/task-instance-planner";
import { createTaskInstance } from "@/lib/task/task-instance-repository";
import { saveRunSession } from "@/lib/run-repository";
import { makeId } from "@/lib/id";
import { nowIso } from "@/lib/time";
import { createLLMAdapter } from "@/lib/demo-mode";

export interface RunOrchestratorOutcome {
  harness: Harness;
  run: RunSession;
  events: HarnessEvent[];
}

export class RunOrchestratorService {
  constructor(
    private readonly runtimeExecutorService = new RuntimeExecutorService(),
    private readonly taskPlanner = new TaskInstancePlannerAdapter(createLLMAdapter()),
    private readonly runOutputService = new RunOutputService(),
  ) {}

  async startRun(harnessId: string, request: RunHarnessRequest): Promise<RunOrchestratorOutcome | null> {
    const harness = getHarnessById(harnessId);
    if (!harness) {
      return null;
    }
    if (!harness.blueprint) {
      throw new Error("Harness blueprint is required before starting a run.");
    }

    const run = createRunSession(harnessId, request);
    saveRunSession(run);

    const events: HarnessEvent[] = [];
    persistAndBroadcast(
      buildRunEvent(harness.id, "runtime.requested", "Run request accepted.", {
        runId: run.id,
        taskInstruction: request.taskInstruction,
        parameters: request.parameters,
        policy: request.policy,
      }),
      events,
    );
    void this.executeRun(harness, run, request, events).catch((error) => {
      persistAndBroadcast(
        buildRunEvent(harness.id, "runtime.failed", "Run execution crashed.", {
          runId: run.id,
          error: error instanceof Error ? error.message : String(error),
        }),
        events,
      );
      saveRunSession(
        failRunSession(run, {
          outputArtifactIds: [
            ...(run.outputArtifactIds ?? []),
            writeRunErrorArtifact({
              run,
              harnessId: harness.id,
              phase: "runtime",
              error,
              events,
            }).id,
          ],
          outputStatus: "failure",
          outputSummary: error instanceof Error ? error.message : String(error),
        }),
      );
    });

    return {
      harness,
      run,
      events,
    };
  }

  private async executeRun(
    harness: Harness,
    run: RunSession,
    request: RunHarnessRequest,
    events: HarnessEvent[],
  ): Promise<void> {
    let taskInstanceRecord: ReturnType<typeof createTaskInstance> | null = null;
    try {
      const plannedTask = await this.taskPlanner.plan({
        harness,
        taskInstruction: request.taskInstruction.trim(),
        parameters: request.parameters,
        policy: request.policy,
        onProgress: (update) => {
          persistAndBroadcast(
            buildRunEvent(
              harness.id,
              `task.instance.${update.segment}${update.agentId ? `.${update.agentId}` : ""}.${update.status}`,
              progressMessage(update),
              {
                runId: run.id,
                segment: update.segment,
                agentId: update.agentId,
                status: update.status,
                summary: update.summary,
              },
            ),
            events,
          );
        },
      });
      taskInstanceRecord = createTaskInstance({
        runId: run.id,
        harnessId: harness.id,
        instruction: request.taskInstruction.trim(),
        taskInstruction: request.taskInstruction.trim(),
        goal: plannedTask.goal,
        constraints: plannedTask.constraints,
        successCriteria: plannedTask.successCriteria,
        perAgentAssignments: plannedTask.perAgentAssignments,
        finalDeliverable: plannedTask.finalDeliverable,
        planningSummary: plannedTask.planningSummary,
      });
    } catch (error) {
      const errorArtifact = writeRunErrorArtifact({
        run,
        harnessId: harness.id,
        phase: "task_instance_planning",
        error,
        events,
      });
      const failedRun = failRunSession(run, {
        outputArtifactIds: [errorArtifact.id],
        outputStatus: "failure",
        outputSummary: error instanceof Error ? error.message : String(error),
      });
      saveRunSession(failedRun);
      persistAndBroadcast(
        buildRunEvent(harness.id, "planning", "Task instance planning failed.", {
          runId: run.id,
          error: error instanceof Error ? error.message : String(error),
        }),
        events,
      );
      return;
    }
    if (!taskInstanceRecord) {
      throw new Error("Task instance planning did not produce a task instance.");
    }
    persistAndBroadcast(
      buildRunEvent(harness.id, "planning", "Task instance created.", {
        runId: run.id,
        taskInstanceId: taskInstanceRecord.taskInstance.id,
        planningSummary: taskInstanceRecord.taskInstance.planningSummary,
      }),
      events,
    );

    const runtimeOutcome = await this.runtimeExecutorService.execute(harness, {
      context: {
        runId: run.id,
        taskInstruction: taskInstanceRecord.taskInstance.instruction,
        taskInstance: taskInstanceRecord.taskInstance,
        taskInstanceArtifact: taskInstanceRecord.artifact,
        runPolicy: request.policy,
      },
      onEvent: async (event) => {
        persistAndBroadcast(event, events);
      },
      onStep: async (snapshot, step, event) => {
        saveHarness(snapshot);
        persistAndBroadcast(
          {
            ...event,
            payload: {
            ...event.payload,
            runId: run.id,
            taskInstruction: taskInstanceRecord.taskInstance.instruction,
            taskInstanceId: taskInstanceRecord.taskInstance.id,
          },
        },
          events,
        );
      },
    });

    const completedHarness = saveHarness(runtimeOutcome.harness);
    const runtimeFailed = runtimeOutcome.steps.some((step) => step.status === "failed");
    const runSnapshotForFinalization: RunSession = runtimeFailed ? failRunSession(run, {}) : completeRunSession(run, {});
    const firstFailedStep = runtimeOutcome.steps.find((step) => step.status === "failed");
    const runtimeErrorArtifact = runtimeFailed
      ? writeRunErrorArtifact({
          run,
          harnessId: completedHarness.id,
          phase: "runtime",
          error: firstFailedStep?.summary ?? "Runtime execution failed.",
          events,
          affectedAgentId: firstFailedStep?.nodeId,
          affectedTaskInstanceId: taskInstanceRecord.taskInstance.id,
        })
      : null;

    let finalization: ReturnType<typeof aggregateFinalDeliverableArtifacts>;
    try {
      finalization = aggregateFinalDeliverableArtifacts({
        harness: completedHarness,
        run: runSnapshotForFinalization,
        taskInstance: taskInstanceRecord.taskInstance,
      });
    } catch (error) {
      const errorArtifact = writeRunErrorArtifact({
        run,
        harnessId: completedHarness.id,
        phase: "final_deliverable_aggregation",
        error,
        events,
        affectedTaskInstanceId: taskInstanceRecord.taskInstance.id,
      });
      const failedRun = failRunSession(run, {
        outputArtifactIds: [errorArtifact.id],
        outputStatus: "failure",
        outputSummary: error instanceof Error ? error.message : String(error),
      });
      saveRunSession(failedRun);
      persistAndBroadcast(
        buildRunEvent(completedHarness.id, "run.failed", "Run failed.", {
          runId: run.id,
          errorArtifactId: errorArtifact.id,
          error: errorArtifact.summary,
        }),
        events,
      );
      return;
    }

    const finalRunBase = runtimeFailed
      ? failRunSession(run, {
          outputArtifactIds: [
            ...(runtimeErrorArtifact ? [runtimeErrorArtifact.id] : []),
            finalization.finalDeliverable.id,
          ],
          outputSummary: finalization.finalDeliverable.summary,
          outputStatus: "failure",
        })
      : completeRunSession(run, {
          outputArtifactIds: [finalization.finalDeliverable.id],
          outputSummary: finalization.finalDeliverable.summary,
          outputStatus: "success",
        });
    saveRunSession(finalRunBase);

    let finalReportArtifactId: string | undefined;
    let finalReportSummary: string | undefined;
    let finalReportArtifactIds: string[] = [];
    try {
      const finalReport = await this.runOutputService.generate(completedHarness, finalRunBase, {
        taskInstruction: request.taskInstruction.trim(),
        taskInstance: taskInstanceRecord.taskInstance,
        finalDeliverable: finalization.finalDeliverable,
        runtimeEvents: runtimeOutcome.events,
        runtimeSteps: runtimeOutcome.steps,
        artifactRefs: finalization.keyArtifacts.map(toArtifactReference),
      });
      finalReportArtifactId = finalReport.artifactMap.markdown.id;
      finalReportSummary = finalReport.result.summary;
      finalReportArtifactIds = finalReport.artifacts.map((artifact) => artifact.id);
      for (const event of finalReport.events) {
        persistAndBroadcast(event, events);
      }
    } catch (error) {
      persistAndBroadcast(
        buildRunEvent(completedHarness.id, "task-output", "Final report generation failed.", {
          runId: run.id,
          error: error instanceof Error ? error.message : String(error),
          finalOutputArtifactId: finalization.finalDeliverable.id,
        }),
        events,
      );
    }

    const persistedRun: RunSession = {
      ...finalRunBase,
      outputArtifactIds: Array.from(
        new Set([
          ...(finalRunBase.outputArtifactIds ?? []),
          finalization.finalDeliverable.id,
          ...finalReportArtifactIds,
          ...(finalReportArtifactId ? [finalReportArtifactId] : []),
        ]),
      ),
      reportArtifactId: finalReportArtifactId,
      outputSummary: finalReportSummary ?? finalization.finalDeliverable.summary,
      outputStatus: runtimeFailed ? "failure" : "success",
      updatedAt: nowIso(),
    };
    saveRunSession(persistedRun);

    const finalEvent = runtimeFailed
      ? buildRunEvent(completedHarness.id, "run.failed", "Run failed.", {
          runId: run.id,
          failingNodeIds: runtimeOutcome.steps.filter((step) => step.status === "failed").map((step) => step.nodeId),
          finalOutputArtifactId: finalization.finalDeliverable.id,
          reportArtifactId: finalReportArtifactId,
        })
      : buildRunEvent(completedHarness.id, "run.completed", "Run completed.", {
          runId: run.id,
          finalOutputArtifactId: finalization.finalDeliverable.id,
          reportArtifactId: finalReportArtifactId,
        });
    persistAndBroadcast(finalEvent, events);
  }
}

function writeRunErrorArtifact(input: {
  run: RunSession;
  harnessId: string;
  phase: string;
  error: unknown;
  events: HarnessEvent[];
  affectedAgentId?: string;
  affectedTaskInstanceId?: string;
}) {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  const stack = input.error instanceof Error ? input.error.stack : undefined;
  return createArtifact({
    runId: input.run.id,
    harnessId: input.harnessId,
    nodeId: input.affectedAgentId ?? null,
    type: "run.error",
    title: "Run failed",
    contentJson: {
      runId: input.run.id,
      harnessId: input.harnessId,
      failedAt: nowIso(),
      phase: input.phase,
      errorMessage: message,
      stack: stack ?? null,
      lastEventId: input.events[input.events.length - 1]?.id ?? null,
      affectedAgentId: input.affectedAgentId ?? null,
      affectedTaskInstanceId: input.affectedTaskInstanceId ?? null,
    },
    contentText: message,
    summary: message,
  });
}

function buildRunEvent(
  harnessId: string,
  kind: string,
  message: string,
  payload: Record<string, unknown>,
): HarnessEvent {
  return {
    id: makeId("event"),
    harnessId,
    channel: "runtime",
    phase: "runtime",
    kind,
    message,
    payload,
    createdAt: nowIso(),
  };
}

function progressMessage(update: { segment: string; status: string; summary?: string }): string {
  const action = update.status === "started" ? "started" : "completed";
  if (update.summary) {
    return `Task instance ${update.segment} ${action}: ${update.summary}`;
  }
  return `Task instance ${update.segment} ${action}.`;
}

function persistAndBroadcast(event: HarnessEvent, events: HarnessEvent[]): void {
  saveHarnessEvent(event);
  broadcastHarnessEvent(event);
  events.push(event);
}
