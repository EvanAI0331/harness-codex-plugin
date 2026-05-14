import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Harness, HarnessEvent, RunSession } from "shared/types";
import { makeId } from "@/lib/id";
import { nowIso } from "@/lib/time";
import { splitOutputIntoChunks } from "@/lib/output-chunks";
import type { RunOutputGenerationInput, RunOutputGenerationOutcome } from "@/lib/run-output/types";
import { LLMRunOutputAdapter } from "@/lib/run-output/llm-task-output-adapter";
import { createArtifact } from "@/lib/artifact-repository";
import { saveRunSession, saveRunOutputArtifacts } from "@/lib/run-repository";
import { createLLMAdapter } from "@/lib/demo-mode";

export interface RunOutputOutcome extends RunOutputGenerationOutcome {
  events: HarnessEvent[];
  reportPath: string;
  jsonPath: string;
}

export class RunOutputService {
  constructor(private readonly adapter = new LLMRunOutputAdapter(createLLMAdapter())) {}

  async generate(harness: Harness, run: RunSession, input: Omit<RunOutputGenerationInput, "harness" | "runId">): Promise<RunOutputOutcome> {
    const result = await this.adapter.generate({
      harness,
      runId: run.id,
      taskInstruction: input.taskInstance.instruction,
      taskInstance: input.taskInstance,
      finalDeliverable: input.finalDeliverable,
      runtimeEvents: input.runtimeEvents,
      runtimeSteps: input.runtimeSteps,
      artifactRefs: input.artifactRefs ?? [],
    });

    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const reportDir = path.join(moduleDir, "../../../data/runs", run.id);
    await fs.mkdir(reportDir, { recursive: true });
    const jsonPath = path.join(reportDir, "task-output.json");
    const reportPath = path.join(reportDir, "task-output.md");
    await fs.writeFile(jsonPath, JSON.stringify(result.result, null, 2), "utf8");
    await fs.writeFile(reportPath, result.result.reportMarkdown, "utf8");

    const persistedArtifacts = result.artifacts.map((artifact) =>
      createArtifact({
        id: artifact.id,
        runId: run.id,
        harnessId: harness.id,
        nodeId: null,
        type: artifact.specType,
        title: artifact.title,
        contentJson: artifact,
        contentText: artifact.content,
        summary: artifact.title,
        createdAt: artifact.createdAt,
      }),
    );
    saveRunOutputArtifacts(run.id, result.artifacts);
    const updatedRun: RunSession = {
      ...run,
      outputArtifactIds: Array.from(new Set([...(run.outputArtifactIds ?? []), ...persistedArtifacts.map((artifact) => artifact.id)])),
      reportArtifactId: result.artifactMap.markdown.id,
      outputSummary: result.result.summary,
      outputStatus: result.result.status === "success" ? "success" : "failure",
      updatedAt: new Date().toISOString(),
    };
    saveRunSession(updatedRun);

    const events: HarnessEvent[] = [];
    const reportChunks = splitOutputIntoChunks(result.result.reportMarkdown);
    events.push(
      buildRunEvent(harness.id, "task-output", "task.output.started", "Run task output generation started.", {
        runId: run.id,
        chunkCount: reportChunks.length,
      }),
    );
    reportChunks.forEach((chunkText, index) => {
      events.push(
        buildRunEvent(harness.id, "task-output", "task.output.chunk", `Run task output chunk ${index + 1}/${reportChunks.length}.`, {
          runId: run.id,
          chunkIndex: index + 1,
          chunkCount: reportChunks.length,
          chunkText,
        }),
      );
    });
    events.push(
      buildRunEvent(harness.id, "task-output", "task.output.completed", "Run task output generation completed.", {
        runId: run.id,
        outputSummary: result.result.summary,
        reportPath,
        jsonPath,
        artifactIds: result.artifacts.map((artifact) => artifact.id),
      }),
    );
    events.push(
      buildRunEvent(harness.id, "task-output", "task.output.generated", "Run task output generated.", {
        runId: run.id,
        outputSummary: result.result.summary,
        reportPath,
        jsonPath,
        artifactIds: result.artifacts.map((artifact) => artifact.id),
      }),
    );

    return {
      ...result,
      events,
      reportPath,
      jsonPath,
    };
  }
}

function buildRunEvent(
  harnessId: string,
  phase: HarnessEvent["phase"],
  kind: string,
  message: string,
  payload: Record<string, unknown>,
): HarnessEvent {
  return {
    id: makeId("event"),
    harnessId,
    channel: "runtime",
    phase,
    kind,
    message,
    payload,
    createdAt: nowIso(),
  };
}
