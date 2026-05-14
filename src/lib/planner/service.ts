import type { HarnessEvent, PlannerInput, PlannerPlanResult, SpecArtifact } from "shared/types";
import { broadcastHarnessEvent } from "@/lib/harness-event-bus";
import { makeId } from "@/lib/id";
import { nowIso } from "@/lib/time";
import { saveHarnessEvent } from "@/lib/harness-repository";
import { PlannerGenerationError } from "@/lib/planner/errors";
import { LLMPlannerAdapter } from "@/lib/planner/llm-planner-adapter";
import { createLLMAdapter } from "@/lib/demo-mode";

export interface PlannerOutcome extends PlannerPlanResult {
  events: HarnessEvent[];
}

export class PlannerService {
  constructor(private readonly adapter = new LLMPlannerAdapter(createLLMAdapter())) {}

  async generateBlueprint(harnessId: string, input: PlannerInput): Promise<PlannerOutcome> {
    const events: HarnessEvent[] = [];
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const result = await this.adapter.plan(input, {
          onProgress: (update) => {
            const event = buildEvent(
              harnessId,
              "planning",
              `plan.${update.segment}.${update.status}`,
              plannerProgressMessage(update),
              {
                harnessId,
                segment: update.segment,
                status: update.status,
                selectedPlanningAgentRole: update.selectedPlanningAgentRole,
                inputRequirements: update.inputRequirements ?? [],
                summary: update.summary,
                artifactCount: update.artifactCount,
                nodeId: harnessId,
              },
            );
            persistEvents([event]);
            events.push(event);
          },
        });
        const outcomeEvents = [
          buildEvent(harnessId, "intake", "plan.generated", "Dispatcher produced a structured blueprint.", {
            rawResponseArtifactId: result.rawResponseArtifactId,
            rawResponseArtifactIds: result.rawResponseArtifactIds ?? [result.rawResponseArtifactId],
            artifactCount: result.artifacts.length,
            attempt,
          }),
          buildEvent(harnessId, "planning", "graph.updated", "Blueprint graph is ready for downstream services.", {
            blueprintArtifactId: result.artifacts.find((artifact) => artifact.specType === "planner.blueprint")?.id,
            attempt,
          }),
        ];
        persistEvents(outcomeEvents);
        events.push(...outcomeEvents);
        return {
          ...result,
          events: events.slice(),
        };
      } catch (error) {
        lastError = error;
        if (error instanceof PlannerGenerationError && attempt < 2) {
          const retryEvent = buildEvent(harnessId, "planning", "plan.retrying", "Dispatcher output missed spec fields; retrying with the same strict contract.", {
            error: error.message,
            artifactCount: error.artifacts.length,
            attempt,
          });
          persistEvents([retryEvent]);
          continue;
        }

        if (error instanceof PlannerGenerationError) {
          const failureEvents = [
            buildEvent(harnessId, "planning", "node.failed", "Dispatcher schema validation failed.", {
              error: error.message,
              artifactCount: error.artifacts.length,
              attempt,
            }),
          ];
          persistEvents(failureEvents);
          events.push(...failureEvents);
          throw Object.assign(error, { artifacts: error.artifacts, events });
        }

        const failureEvents = [
          buildEvent(harnessId, "planning", "node.failed", "Dispatcher request failed.", {
            error: error instanceof Error ? error.message : String(error),
            attempt,
          }),
        ];
        persistEvents(failureEvents);
        events.push(...failureEvents);
        throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), { events });
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Planner blueprint generation failed.");
  }
}

function persistEvents(events: HarnessEvent[]): void {
  for (const event of events) {
    saveHarnessEvent(event);
    broadcastHarnessEvent(event);
  }
}

function buildEvent(
  harnessId: string,
  phase: HarnessEvent["phase"],
  kind: string,
  message: string,
  payload: Record<string, unknown>,
): HarnessEvent {
  return {
    id: makeId("event"),
    harnessId,
    channel: "system",
    phase,
    kind,
    message,
    payload,
    createdAt: nowIso(),
  };
}

function plannerProgressMessage(update: { segment: string; status: string; summary?: string }): string {
  const action = update.status === "started" ? "started" : "completed";
  if (update.summary) {
    return `Planner ${update.segment} ${action}: ${update.summary}`;
  }
  return `Planner ${update.segment} ${action}.`;
}
