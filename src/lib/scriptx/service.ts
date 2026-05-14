import type { AgentNode, Harness, HarnessEvent, SpecArtifact } from "shared/types";
import { makeId } from "@/lib/id";
import { nowIso } from "@/lib/time";
import type { LLMAdapter } from "@/lib/llm/types";
import { LLMScriptAuthoringAdapter } from "@/lib/scriptx/llm-script-authoring-adapter";
import type { ScriptAuthoringAdapter, ScriptCompilerAdapter, ScriptxGenerationOutcome } from "@/lib/scriptx/types";
import { LocalScriptCompilerAdapter } from "@/lib/scriptx/local-compiler-adapter";
import { hash16 } from "@/lib/specs/spec-hash";
import { splitOutputIntoChunks } from "@/lib/output-chunks";
import { createLLMAdapter } from "@/lib/demo-mode";

export class ScriptxService {
  constructor(
    private readonly authoringAdapter: ScriptAuthoringAdapter,
    private readonly compiler: ScriptCompilerAdapter,
  ) {}

  async generateAndCompileForAgent(agent: AgentNode, harness: Harness): Promise<ScriptxGenerationOutcome> {
    if (!harness.blueprint) {
      throw new Error("Script authoring requires a blueprint.");
    }
    const binding = resolveRuntimeBinding(harness, agent);
    const events: HarnessEvent[] = [];
    const initialResponse = await this.authoringAdapter.generate({
      harness,
      agent,
      binding,
      model: harness.intake.codingAgentModel,
    });
    const initialAttempt = await authorAndCompileAttempt({
      harness,
      agent,
      response: initialResponse,
      events,
      compiler: this.compiler,
      attemptLabel: "initial",
    });
    if (initialAttempt.success) {
      return { artifacts: initialAttempt.artifacts, events };
    }

    if (!this.authoringAdapter.repair) {
      return { artifacts: initialAttempt.artifacts, events };
    }

    pushEvent(events, harness.id, "script-authoring", "script.repair.started", `${agent.label} script repair started.`, {
      agentId: agent.id,
      failedKind: initialAttempt.failedKind,
      compilerError: initialAttempt.compilerError,
    });

    const repairedResponse = await this.authoringAdapter.repair({
      harness,
      agent,
      binding,
      model: harness.intake.codingAgentModel,
      failedPlan: initialResponse.plan,
      failedKind: initialAttempt.failedKind,
      compilerError: initialAttempt.compilerError,
      failingSource: initialAttempt.failingSource,
    });

    const repairedAttempt = await authorAndCompileAttempt({
      harness,
      agent,
      response: repairedResponse,
      events,
      compiler: this.compiler,
      attemptLabel: "repair",
    });
    if (repairedAttempt.success) {
      pushEvent(events, harness.id, "script-authoring", "script.repair.completed", `${agent.label} script repair completed.`, {
        agentId: agent.id,
        artifactIds: repairedAttempt.artifacts.map((artifact) => artifact.id),
      });
      return { artifacts: repairedAttempt.artifacts, events };
    }

    return { artifacts: repairedAttempt.artifacts, events };
  }
}

export function makeDefaultScriptxService(): ScriptxService {
  return new ScriptxService(new LLMScriptAuthoringAdapter(createLLMAdapter() as LLMAdapter), new LocalScriptCompilerAdapter());
}

function makeArtifact(
  id: string,
  specType: SpecArtifact["specType"],
  title: string,
  kind: SpecArtifact["kind"],
  sourceTemplateId: string,
  content: string,
  artifactType: SpecArtifact["artifactType"],
  compiledFrom: string[],
  ownerId: string,
  sourceText: string,
): SpecArtifact {
  const createdAt = nowIso();
  return {
    id,
    specType,
    title,
    kind,
    artifactType,
    content,
    contentHash: hash16(content),
    sourceTemplateId,
    compiledFrom,
    ownerType: "agent",
    ownerId,
    sourceText,
    compileStatus: specType === "skill.source" || specType === "script.source" ? "not-applicable" : "pending",
    backtestStatus: "not-applicable",
    createdAt,
    updatedAt: createdAt,
  };
}

function buildCompiledArtifact(
  id: string,
  sourceArtifact: SpecArtifact,
  result: { success: boolean; compiledPath?: string; compiledPayload?: string; stdout: string; stderr: string },
  specType: "skill.compiled" | "script.compiled",
  fileName: string,
  kind: "skill" | "script",
): SpecArtifact {
  const createdAt = nowIso();
  const content = result.success ? result.compiledPayload ?? sourceArtifact.content : "";
  return {
    id,
    specType,
    title: sourceArtifact.title.replace("Source", "Compiled"),
    kind,
    artifactType: "compiled",
    content,
    contentHash: hash16(content || `${sourceArtifact.ownerId ?? "agent"}:${kind}:${result.success}`),
    sourceTemplateId: kind === "skill" ? "scriptx.skill.compiler.v1" : "scriptx.script.compiler.v1",
    compiledFrom: [...sourceArtifact.compiledFrom, fileName],
    ownerType: "agent",
    ownerId: sourceArtifact.ownerId,
    sourceText: sourceArtifact.sourceText,
    compileStatus: result.success ? "success" : "failure",
    backtestStatus: "not-applicable",
    compiledPath: result.compiledPath,
    compiledPayload: result.compiledPayload,
    stdout: result.stdout,
    stderr: result.stderr,
    createdAt,
    updatedAt: createdAt,
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
    channel: "system",
    phase,
    kind,
    message,
    payload,
    createdAt: nowIso(),
  });
}

async function authorAndCompileAttempt(args: {
  harness: Harness;
  agent: AgentNode;
  response: { plan: import("@/lib/scriptx/types").ScriptAuthoringPlan; model: string; provider: string };
  events: HarnessEvent[];
  compiler: ScriptCompilerAdapter;
  attemptLabel: "initial" | "repair";
}): Promise<{
  success: boolean;
  artifacts: SpecArtifact[];
  failedKind: "skill" | "script";
  compilerError: string;
  failingSource: string;
}> {
  const { harness, agent, response, events, compiler, attemptLabel } = args;
  const artifacts: SpecArtifact[] = [];

  emitOutputProgress(events, harness.id, agent.id, agent.label, "skill", response.plan.skill.fileName, response.plan.skill.sourceText);
  const skillSourceArtifact = makeArtifact(
    makeId("artifact"),
    "skill.source",
    "Skill Source",
    "skill",
    response.plan.artifacts.skillSourceTemplateId,
    response.plan.skill.sourceText,
    "source",
    [harness.id, agent.id, response.model, attemptLabel],
    agent.id,
    response.plan.skill.sourceText,
  );
  artifacts.push(skillSourceArtifact);
  emitChunkEvents(events, harness.id, agent.id, agent.label, "skill", response.plan.skill.fileName, response.plan.skill.sourceText);
  pushEvent(events, harness.id, "script-authoring", "skill.output.completed", `${agent.label} skill output delivered in batches.`, {
    agentId: agent.id,
    artifactId: skillSourceArtifact.id,
    fileName: response.plan.skill.fileName,
    chunkCount: splitOutputIntoChunks(response.plan.skill.sourceText).length,
  });
  pushEvent(events, harness.id, "script-authoring", "skill.generated", `${agent.label} skill source generated.`, {
    agentId: agent.id,
    artifactId: skillSourceArtifact.id,
    fileName: response.plan.skill.fileName,
    attempt: attemptLabel,
  });

  emitOutputProgress(events, harness.id, agent.id, agent.label, "script", response.plan.script.fileName, response.plan.script.sourceText);
  const scriptSourceArtifact = makeArtifact(
    makeId("artifact"),
    "script.source",
    "Script Source",
    "script",
    response.plan.artifacts.scriptSourceTemplateId,
    response.plan.script.sourceText,
    "source",
    [harness.id, agent.id, response.model, attemptLabel],
    agent.id,
    response.plan.script.sourceText,
  );
  artifacts.push(scriptSourceArtifact);
  emitChunkEvents(events, harness.id, agent.id, agent.label, "script", response.plan.script.fileName, response.plan.script.sourceText);
  pushEvent(events, harness.id, "script-authoring", "script.output.completed", `${agent.label} script output delivered in batches.`, {
    agentId: agent.id,
    artifactId: scriptSourceArtifact.id,
    fileName: response.plan.script.fileName,
    chunkCount: splitOutputIntoChunks(response.plan.script.sourceText).length,
  });
  pushEvent(events, harness.id, "script-authoring", "script.generated", `${agent.label} script source generated.`, {
    agentId: agent.id,
    artifactId: scriptSourceArtifact.id,
    fileName: response.plan.script.fileName,
    attempt: attemptLabel,
  });

  const skillCompile = await compiler.compileSkill({
    harness,
    agent,
    source: skillSourceArtifact.content,
    fileName: response.plan.skill.fileName,
  });
  const scriptCompile = await compiler.compileScript({
    harness,
    agent,
    source: scriptSourceArtifact.content,
    fileName: response.plan.script.fileName,
  });

  const compiledSkillArtifact = buildCompiledArtifact(makeId("artifact"), skillSourceArtifact, skillCompile, "skill.compiled", response.plan.skill.fileName, "skill");
  const compiledScriptArtifact = buildCompiledArtifact(makeId("artifact"), scriptSourceArtifact, scriptCompile, "script.compiled", response.plan.script.fileName, "script");
  artifacts.push(compiledSkillArtifact, compiledScriptArtifact);

  if (!skillCompile.success || !scriptCompile.success) {
    const failedKind: "skill" | "script" = !skillCompile.success ? "skill" : "script";
    const compilerError = !skillCompile.success ? skillCompile.stderr : scriptCompile.stderr;
    const failingSource = !skillCompile.success ? skillSourceArtifact.content : scriptSourceArtifact.content;
    const failureEventKind = failedKind === "skill" ? "skill.failed" : "script.failed";
    pushEvent(events, harness.id, "script-authoring", failureEventKind, `${agent.label} ${failedKind} package compilation failed.`, {
      agentId: agent.id,
      artifactId: failedKind === "skill" ? compiledSkillArtifact.id : compiledScriptArtifact.id,
      stderr: failedKind === "skill" ? skillCompile.stderr : scriptCompile.stderr,
      skillArtifactId: compiledSkillArtifact.id,
      scriptArtifactId: compiledScriptArtifact.id,
      skillStderr: skillCompile.stderr,
      scriptStderr: scriptCompile.stderr,
      attempt: attemptLabel,
    });
    return {
      success: false,
      artifacts,
      failedKind,
      compilerError,
      failingSource,
    };
  }

  pushEvent(events, harness.id, "script-authoring", "skill.compiled", `${agent.label} skill compiled successfully.`, {
    agentId: agent.id,
    artifactId: compiledSkillArtifact.id,
    compiledPath: skillCompile.compiledPath,
    attempt: attemptLabel,
  });
  pushEvent(events, harness.id, "script-authoring", "script.compiled", `${agent.label} script compiled successfully.`, {
    agentId: agent.id,
    artifactId: compiledScriptArtifact.id,
    compiledPath: scriptCompile.compiledPath,
    attempt: attemptLabel,
  });

  return {
    success: true,
    artifacts,
    failedKind: "script",
    compilerError: "",
    failingSource: "",
  };
}

function emitOutputProgress(
  events: HarnessEvent[],
  harnessId: string,
  agentId: string,
  agentLabel: string,
  outputKind: "skill" | "script",
  fileName: string,
  sourceText: string,
): void {
  const chunks = splitOutputIntoChunks(sourceText);
  pushEvent(events, harnessId, "script-authoring", `${outputKind}.output.started`, `${agentLabel} ${outputKind} output started.`, {
    agentId,
    outputKind,
    fileName,
    chunkCount: chunks.length,
    resetOutput: true,
  });
}

function emitChunkEvents(
  events: HarnessEvent[],
  harnessId: string,
  agentId: string,
  agentLabel: string,
  outputKind: "skill" | "script",
  fileName: string,
  sourceText: string,
): void {
  const chunks = splitOutputIntoChunks(sourceText);
  chunks.forEach((chunkText, index) => {
    pushEvent(events, harnessId, "script-authoring", `${outputKind}.output.chunk`, `${agentLabel} ${outputKind} output chunk ${index + 1}/${chunks.length}.`, {
      agentId,
      outputKind,
      fileName,
      chunkIndex: index + 1,
      chunkCount: chunks.length,
      chunkText,
    });
  });
}

function resolveRuntimeBinding(harness: Harness, agent: AgentNode) {
  const compiledArtifact = [...harness.specArtifacts].reverse().find(
    (artifact) => artifact.ownerId === agent.id && artifact.specType === "spec.contract.compiled" && artifact.runtimeBinding,
  );
  if (!compiledArtifact?.runtimeBinding) {
    throw new Error(`Missing compiled runtime binding for ${agent.label}.`);
  }
  return compiledArtifact.runtimeBinding;
}
