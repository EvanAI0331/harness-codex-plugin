import Ajv from "ajv/dist/2020";
import type { Harness, HarnessEvent, SpecArtifact } from "shared/types";
import { makeId } from "@/lib/id";
import { hash16 } from "@/lib/specs/spec-hash";
import { nowIso } from "@/lib/time";
import { splitOutputIntoChunks } from "@/lib/output-chunks";
import type { LLMAdapter } from "@/lib/llm/types";
import { loadRunOutputSchemaObject } from "@/lib/run-output/schema";
import { loadRunOutputSpecObject } from "@/lib/run-output/spec";
import { renderRunOutputPrompt } from "@/lib/run-output/prompt";
import type {
  RunOutputGenerationInput,
  RunOutputGenerationOutcome,
  RunOutputResult,
  RunOutputEvidence,
} from "@/lib/run-output/types";
import { RunOutputGenerationError } from "@/lib/run-output/errors";

const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(loadRunOutputSchemaObject() as object);

export class LLMRunOutputAdapter {
  constructor(private readonly llm: LLMAdapter) {}

  async generate(input: RunOutputGenerationInput): Promise<RunOutputGenerationOutcome> {
    const harnessSummaryJson = JSON.stringify(
      {
        harness: input.harness.id,
        name: input.harness.name,
        harnessSummary: input.harness.blueprint?.summary ?? input.harness.intake.goal,
        goal: input.harness.intake.goal,
        agentCount: input.harness.agentNodes.length,
        capabilityCount: input.harness.capabilityNodes.length,
        runtimeOrder: input.harness.agentNodes.map((agent) => agent.label),
      },
      null,
      2,
    );
    const taskInstanceJson = JSON.stringify(input.taskInstance, null, 2);
    const finalDeliverableJson = JSON.stringify(
      {
        id: input.finalDeliverable.id,
        type: input.finalDeliverable.type,
        title: input.finalDeliverable.title,
        summary: input.finalDeliverable.summary,
        nodeId: input.finalDeliverable.nodeId,
        contentJson: input.finalDeliverable.contentJson,
        contentText: input.finalDeliverable.contentText,
      },
      null,
      2,
    );
    const runtimeEvidence = buildRuntimeEvidence(input);
    const runtimeEvidenceJson = JSON.stringify(runtimeEvidence, null, 2);
    const artifactRefsJson = JSON.stringify(input.artifactRefs ?? [], null, 2);
    const specJson = JSON.stringify(loadRunOutputSpecObject(), null, 2);
    const schemaJson = JSON.stringify(loadRunOutputSchemaObject(), null, 2);
    const prompt = renderRunOutputPrompt({
      taskOutputSpecJson: specJson,
      taskOutputSchemaJson: schemaJson,
      harnessSummaryJson,
      taskInstanceJson,
      finalDeliverableJson,
      runtimeEvidenceJson,
      artifactRefsJson,
      taskInstruction: input.taskInstruction,
    });

    const llmResponse = await this.llm.generateJson({
      config: input.harness.intake.mainModel,
      systemPrompt: prompt,
      userPrompt: JSON.stringify(
        {
          runId: input.runId,
          harnessId: input.harness.id,
          taskInstruction: input.taskInstruction,
        },
        null,
        2,
      ),
      schemaName: "RunTaskOutput",
    });

    const rawArtifact = makeArtifact(
      "run.raw",
      "Run Task Raw Response",
      "run",
      input.runId,
      JSON.stringify(llmResponse.rawPayload, null, 2),
      "raw",
      [input.runId, input.harness.id, llmResponse.model, "runtime-output"],
    );
    rawArtifact.sourceText = llmResponse.rawText;

    let parsed: RunOutputResult;
    try {
      parsed = JSON.parse(llmResponse.rawText) as RunOutputResult;
    } catch (error) {
      throw new RunOutputGenerationError(
        `Run output JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
        [artifactSummary(rawArtifact)],
      );
    }
    if (!validate(parsed)) {
      throw new RunOutputGenerationError(
        `Run output schema validation failed: ${(validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message || "invalid"}`).join("; ")}`,
        [artifactSummary(rawArtifact)],
      );
    }

    const result = parsed;
    const events: HarnessEvent[] = [];
    const reportChunks = splitOutputIntoChunks(result.reportMarkdown);
    pushEvent(events, input.harness.id, "task-output", "task.output.started", "Run task output generation started.", {
      runId: input.runId,
      chunkCount: reportChunks.length,
    });
    reportChunks.forEach((chunkText, index) => {
      pushEvent(events, input.harness.id, "task-output", "task.output.chunk", `Run task output chunk ${index + 1}/${reportChunks.length}.`, {
        runId: input.runId,
        chunkIndex: index + 1,
        chunkCount: reportChunks.length,
        chunkText,
      });
    });
    pushEvent(events, input.harness.id, "task-output", "task.output.completed", "Run task output generation completed.", {
      runId: input.runId,
      outputSummary: result.summary,
      chunkCount: reportChunks.length,
    });
    pushEvent(events, input.harness.id, "task-output", "task.output.generated", "Run task output generated.", {
      runId: input.runId,
      outputSummary: result.summary,
      chunkCount: reportChunks.length,
    });

    const jsonArtifact = makeArtifact(
      "final.report",
      `Final Report Data: ${result.title}`,
      "run",
      input.runId,
      JSON.stringify(result, null, 2),
      "report",
      [input.runId, input.harness.id, "final-report"],
    );
    const markdownArtifact = makeArtifact(
      "final.report",
      `Final Report: ${result.title}`,
      "run",
      input.runId,
      result.reportMarkdown,
      "report",
      [input.runId, input.harness.id, "final-report"],
    );
    const promptArtifact = makeArtifact(
      "run.prompt",
      "Run Task Output Prompt",
      "run",
      input.runId,
      prompt,
      "prompt",
      [input.runId, input.harness.id, llmResponse.model, "runtime-output"],
    );
    const schemaArtifact = makeArtifact(
      "run.schema",
      "Run Task Output Schema",
      "run",
      input.runId,
      schemaJson,
      "report",
      [input.runId, input.harness.id, "runtime-output"],
    );

    const artifacts = [promptArtifact, schemaArtifact, rawArtifact, jsonArtifact, markdownArtifact];
    return {
      result,
      artifacts,
      artifactMap: {
        markdown: markdownArtifact,
        json: jsonArtifact,
        prompt: promptArtifact,
        schema: schemaArtifact,
        raw: rawArtifact,
      },
      events,
    };
  }
}

function buildRuntimeEvidence(input: RunOutputGenerationInput): Array<RunOutputEvidence & { kind: string; nodeStatus: string }> {
  const toolEvents = input.runtimeEvents.filter((event) => event.kind === "runtime.tool.completed" || event.kind === "runtime.tool.failed");
  const evidence: Array<RunOutputEvidence & { kind: string; nodeStatus: string }> = [];
  for (const step of input.runtimeSteps) {
    evidence.push({
      nodeId: step.nodeId,
      nodeName: step.nodeName,
      action: step.action,
      summary: step.summary,
      timestamp: step.timestamp,
      kind: "runtime.step",
      nodeStatus: step.status,
    });
  }
  for (const event of toolEvents) {
    const payload = event.payload as Record<string, unknown>;
    evidence.push({
      nodeId: String(payload.nodeId ?? ""),
      nodeName: String(payload.nodeName ?? ""),
      action: String(payload.action ?? event.kind),
      summary: String(payload.summary ?? event.message),
      timestamp: event.createdAt,
      kind: event.kind,
      nodeStatus: String(payload.status ?? "completed"),
    });
  }
  return evidence;
}

function makeArtifact(
  specType: SpecArtifact["specType"],
  title: string,
  ownerType: SpecArtifact["ownerType"],
  sourceTemplateId: string,
  content: string,
  artifactType: SpecArtifact["artifactType"],
  compiledFrom: string[],
): SpecArtifact {
  const createdAt = nowIso();
  return {
    id: makeId("artifact"),
    specType,
    title,
    kind: "run",
    artifactType,
    content,
    contentHash: hash16(content),
    sourceTemplateId,
    compiledFrom,
    ownerType,
    compileStatus: "not-applicable",
    createdAt,
    updatedAt: createdAt,
  };
}

function artifactSummary(artifact: SpecArtifact): { id: string; title: string; specType: string } {
  return {
    id: artifact.id,
    title: artifact.title,
    specType: artifact.specType,
  };
}

function pushEvent(
  events: HarnessEvent[],
  harnessId: string,
  phase: HarnessEvent["phase"],
  kind: string,
  message: string,
  payload: Record<string, unknown>,
): void {
  events.push({
    id: makeId("event"),
    harnessId,
    channel: "runtime",
    phase,
    kind,
    message,
    payload,
    createdAt: nowIso(),
  });
}
