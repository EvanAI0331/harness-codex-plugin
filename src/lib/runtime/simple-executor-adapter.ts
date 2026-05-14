import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { LLMAdapter } from "@/lib/llm/types";
import type { RuntimeExecutorAdapter, RuntimeStepRequest, RuntimeStepResult } from "@/lib/runtime/types";
import { AgentRuntimeLLMAdapter } from "@/lib/runtime/llm-agent-runtime-adapter";
import { hash16 } from "@/lib/specs/spec-hash";
import { makeId } from "@/lib/id";
import { nowIso } from "@/lib/time";
import { readArtifactDir } from "@/lib/env";
import type { AgentRuntimeDecision, SpecArtifact } from "shared/types";
import { createLLMAdapter, createRuntimeToolAdapter } from "@/lib/demo-mode";

export class SimpleRuntimeExecutorAdapter implements RuntimeExecutorAdapter {
  constructor(
    private readonly toolAdapter = createRuntimeToolAdapter(),
    private readonly runtimeAdapter = new AgentRuntimeLLMAdapter(createLLMAdapter()),
    private readonly executionLLM = createLLMAdapter(),
  ) {}

  async execute(request: RuntimeStepRequest): Promise<RuntimeStepResult> {
    if (request.binding.backtestStatus !== "success") {
      return {
        success: false,
        action: "contract_backtest_unverified",
        summary: `Execution blocked because the SpecX contract backtest is not verified for ${request.agent.label}.`,
        error: "contract_backtest_unverified",
        artifacts: [makeBlockedOutputArtifact(request, "contract_backtest_unverified", `Execution blocked because the SpecX contract backtest is not verified for ${request.agent.label}.`)],
      };
    }

    const hasBlockedDependency = request.dependencyStatuses.some((dependency) => dependency.status !== "completed");
    if (hasBlockedDependency) {
      return {
        success: false,
        action: "blocked_by_dependency",
        summary: `Execution blocked because one or more dependencies are not completed for ${request.agent.label}.`,
        error: "dependency_not_completed",
        artifacts: [makeBlockedOutputArtifact(request, "dependency_not_completed", `Execution blocked because one or more dependencies are not completed for ${request.agent.label}.`)],
      };
    }

    const decision = await this.runtimeAdapter.decide({
      harness: request.harness,
      taskInstance: request.taskInstance,
      agent: request.agent,
      upstreamArtifacts: request.upstreamArtifacts,
      availableCapabilities: request.availableCapabilities,
      runPolicy: request.runPolicy,
      outputContract: request.outputContract,
      artifactRefs: request.artifactRefs,
      taskInstruction: request.taskInstance.instruction,
    });

    const artifacts: SpecArtifact[] = [];
    artifacts.push(
      makeRuntimeArtifact({
        specType: "agent.plan",
        title: `Agent plan: ${request.agent.label}`,
        ownerId: request.agent.id,
        sourceTemplateId: "runtime.agent.plan.v1",
        artifactType: "plan",
        contentJson: {
          nodeId: request.agent.id,
          nodeName: request.agent.label,
          runId: request.runId ?? request.harness.id,
          taskInstanceId: request.taskInstance.id,
          taskInstruction: request.taskInstance.instruction,
          decision,
          outputContract: request.outputContract ?? null,
          upstreamArtifactIds: request.upstreamArtifacts.map((artifact) => artifact.id),
          status: "planned",
        },
        contentText: buildPlanText(request.agent.label, decision),
        summary: decision.taskSummary,
      }),
    );

    const selectedCapability = selectCapability(request.availableCapabilities, decision);
    const toolCalls: NonNullable<RuntimeStepResult["toolCalls"]> = [];
    let actionOutcomeSummary = decision.handoffSummary;
    let success = true;
    let error: string | undefined;

    if (decision.actionDecision === "tool") {
      if (!selectedCapability) {
        return buildUnsupportedDecisionFailure(request, decision, artifacts, "runtime_tool_capability_missing");
      }

      const toolResult = await this.toolAdapter.invoke({
        harness: request.harness,
        agent: request.agent,
        capability: selectedCapability,
        query: decision.capabilitySelection.query ?? decision.taskSummary,
        runId: request.runId,
        taskInstruction: request.taskInstance.instruction,
      });
      toolCalls.push({
        capabilityId: selectedCapability.id,
        capabilityLabel: selectedCapability.label,
        toolName: toolResult.toolName,
        query: toolResult.query,
        backend: toolResult.backend,
        mode: toolResult.mode,
        summary: toolResult.summary,
        stdout: toolResult.stdout,
        stderr: toolResult.stderr,
      });
      artifacts.push(
        makeRuntimeArtifact({
          specType: "tool.result",
          title: `Tool result: ${selectedCapability.label}`,
          ownerId: request.agent.id,
          sourceTemplateId: "runtime.tool.result.v1",
          artifactType: "raw",
          contentJson: {
            nodeId: request.agent.id,
            nodeName: request.agent.label,
            runId: request.runId ?? request.harness.id,
            taskInstanceId: request.taskInstance.id,
            capabilityId: selectedCapability.id,
            capabilityLabel: selectedCapability.label,
            toolName: toolResult.toolName,
            query: toolResult.query,
            backend: toolResult.backend ?? null,
            mode: toolResult.mode ?? null,
            summary: toolResult.summary,
            stdout: toolResult.stdout ?? "",
            stderr: toolResult.stderr ?? "",
            status: toolResult.success ? "completed" : "failed",
          },
          contentText: toolResult.summary,
          summary: toolResult.summary,
        }),
      );
      actionOutcomeSummary = toolResult.summary;
      success = toolResult.success;
      error = toolResult.error;
      if (!toolResult.success) {
        artifacts.push(
          makeRuntimeArtifact({
            specType: "agent.output",
            title: `Agent output: ${request.agent.label}`,
            ownerId: request.agent.id,
            sourceTemplateId: "runtime.agent.output.v1",
            artifactType: "report",
            contentJson: {
              nodeId: request.agent.id,
              nodeName: request.agent.label,
              runId: request.runId ?? request.harness.id,
              taskInstanceId: request.taskInstance.id,
              taskInstruction: request.taskInstance.instruction,
              decision,
              capabilityId: selectedCapability.id,
              capabilityLabel: selectedCapability.label,
              toolCalls,
              status: "failed",
              summary: actionOutcomeSummary,
              error: toolResult.error ?? "runtime.tool.failed",
            },
            contentText: actionOutcomeSummary,
            summary: actionOutcomeSummary,
          }),
        );
        return {
          success: false,
          action: "runtime.tool.failed",
          summary: toolResult.summary,
          error: toolResult.error,
          decision,
          toolCalls,
          artifacts,
        };
      }
    } else if (decision.actionDecision === "skill") {
      if (!selectedCapability) {
        return buildUnsupportedDecisionFailure(request, decision, artifacts, "runtime_skill_capability_missing");
      }
      if (selectedCapability.capabilityType !== "skill") {
        return buildUnsupportedDecisionFailure(request, decision, artifacts, "runtime_skill_capability_mismatch");
      }
      const skillExecution = await executeSkillRuntime({
        executionLLM: this.executionLLM,
        request,
        decision,
        capability: selectedCapability,
      });
      success = skillExecution.success;
      actionOutcomeSummary = skillExecution.summary;
      error = skillExecution.error;
      artifacts.push(...skillExecution.artifacts);
    } else if (decision.actionDecision === "script") {
      if (!selectedCapability) {
        return buildUnsupportedDecisionFailure(request, decision, artifacts, "runtime_script_capability_missing");
      }
      if (selectedCapability.capabilityType !== "script") {
        return buildUnsupportedDecisionFailure(request, decision, artifacts, "runtime_script_capability_mismatch");
      }
      const scriptExecution = await executeScriptRuntime({
        request,
        decision,
        capability: selectedCapability,
      });
      success = scriptExecution.success;
      actionOutcomeSummary = scriptExecution.summary;
      error = scriptExecution.error;
      artifacts.push(...scriptExecution.artifacts);
    }

    const agentOutputArtifact = makeRuntimeArtifact({
      specType: "agent.output",
      title: `Agent output: ${request.agent.label}`,
      ownerId: request.agent.id,
      sourceTemplateId: "runtime.agent.output.v1",
      artifactType: "report",
      contentJson: {
        nodeId: request.agent.id,
        nodeName: request.agent.label,
        runId: request.runId ?? request.harness.id,
        taskInstanceId: request.taskInstance.id,
        taskInstruction: request.taskInstance.instruction,
        decision,
        actionDecision: decision.actionDecision,
        capabilityId: selectedCapability?.id ?? null,
        capabilityLabel: selectedCapability?.label ?? null,
        capabilityType: selectedCapability?.capabilityType ?? null,
        toolCalls,
        status: success ? "completed" : "failed",
        summary: decision.agentOutputDraft.summary || actionOutcomeSummary,
        error: error ?? null,
        expectedArtifactSchema: decision.expectedArtifactSchema,
        outputContract: request.outputContract ?? null,
        agentOutputDraft: decision.agentOutputDraft,
      },
      contentText: buildAgentOutputText(decision, actionOutcomeSummary),
      summary: decision.agentOutputDraft.summary || actionOutcomeSummary,
    });
    artifacts.push(agentOutputArtifact);

    const finalDeliverable = request.taskInstance.finalDeliverable;
    if (success && finalDeliverable.ownerAgentId === request.agent.id) {
      artifacts.push(
        makeRuntimeArtifact({
          specType: "final.deliverable",
          title: finalDeliverable.title,
          ownerId: request.agent.id,
          sourceTemplateId: "runtime.final.deliverable.v1",
          artifactType: "report",
          contentJson: {
            nodeId: request.agent.id,
            nodeName: request.agent.label,
            runId: request.runId ?? request.harness.id,
            taskInstanceId: request.taskInstance.id,
            taskInstruction: request.taskInstance.instruction,
            finalDeliverable,
            deliverableContractId: buildDeliverableContractId(request.harness.id, request.taskInstance.id),
            ownerAgentId: request.agent.id,
            outputSchemaHash: hash16(JSON.stringify(request.outputContract ?? {})),
            sourceAgentOutputArtifactId: agentOutputArtifact.id,
            decision,
            capabilityId: selectedCapability?.id ?? null,
            capabilityLabel: selectedCapability?.label ?? null,
            capabilityType: selectedCapability?.capabilityType ?? null,
            toolCalls,
            status: "completed",
            summary: decision.agentOutputDraft.summary || finalDeliverable.summary,
          },
          contentText: buildAgentOutputText(decision, actionOutcomeSummary),
          summary: decision.agentOutputDraft.summary || finalDeliverable.summary,
        }),
      );
    }

    return {
      success,
      action: buildRuntimeAction(decision.actionDecision, success),
      summary: actionOutcomeSummary,
      decision,
      toolCalls,
      artifacts,
    };
  }
}

function selectCapability(
  capabilities: import("shared/types").CapabilityNode[],
  decision: AgentRuntimeDecision,
): import("shared/types").CapabilityNode | null {
  if (decision.capabilitySelection.capabilityId) {
    const byId = capabilities.find((capability) => capability.id === decision.capabilitySelection.capabilityId);
    if (byId) {
      return byId;
    }
  }
  if (decision.capabilitySelection.capabilityLabel) {
    const byLabel = capabilities.find((capability) => capability.label === decision.capabilitySelection.capabilityLabel);
    if (byLabel) {
      return byLabel;
    }
  }
  return null;
}

function buildUnsupportedDecisionFailure(
  request: RuntimeStepRequest,
  decision: AgentRuntimeDecision,
  artifacts: SpecArtifact[],
  error: string,
): RuntimeStepResult {
  const summary = `${request.agent.label} selected an unsupported runtime action: ${decision.actionDecision}.`;
  artifacts.push(
    makeRuntimeArtifact({
      specType: "agent.output",
      title: `Agent output: ${request.agent.label}`,
      ownerId: request.agent.id,
      sourceTemplateId: "runtime.agent.output.v1",
      artifactType: "report",
      contentJson: {
        nodeId: request.agent.id,
        nodeName: request.agent.label,
        runId: request.runId ?? request.harness.id,
        taskInstanceId: request.taskInstance.id,
        taskInstruction: request.taskInstance.instruction,
        decision,
        status: "failed",
        summary,
        error,
      },
      contentText: summary,
      summary,
    }),
  );
  return {
    success: false,
    action: `unsupported_${decision.actionDecision}`,
    summary,
    error,
    decision,
    artifacts,
  };
}

function buildRuntimeAction(actionDecision: AgentRuntimeDecision["actionDecision"], success: boolean): string {
  if (!success) {
    if (actionDecision === "tool") {
      return "runtime.tool.failed";
    }
    if (actionDecision === "skill") {
      return "runtime.skill.failed";
    }
    if (actionDecision === "script") {
      return "runtime.script.failed";
    }
    if (actionDecision === "compose") {
      return "runtime.agent.compose_failed";
    }
    return "runtime.agent.handoff_failed";
  }
  if (actionDecision === "tool") {
    return "runtime.tool.called";
  }
  if (actionDecision === "skill") {
    return "runtime.skill.applied";
  }
  if (actionDecision === "script") {
    return "runtime.script.applied";
  }
  if (actionDecision === "compose") {
    return "runtime.agent.composed";
  }
  return "runtime.agent.handoff";
}

function buildDeliverableContractId(harnessId: string, taskInstanceId: string): string {
  return `${harnessId}:${taskInstanceId}:final`;
}

async function executeSkillRuntime(args: {
  executionLLM: LLMAdapter;
  request: RuntimeStepRequest;
  decision: AgentRuntimeDecision;
  capability: import("shared/types").CapabilityNode;
}): Promise<{
  success: boolean;
  summary: string;
  error?: string;
  artifacts: SpecArtifact[];
}> {
  const skillArtifact = findLatestArtifact(args.request.harness.specArtifacts, args.request.agent.id, "skill.compiled");
  if (!skillArtifact) {
    return {
      success: false,
      summary: `No compiled skill artifact found for ${args.request.agent.label}.`,
      error: "runtime_skill_artifact_missing",
      artifacts: [],
    };
  }

  const prompt = [
    "You are executing a compiled skill for a Harness runtime agent.",
    "Follow the skill instructions exactly.",
    "Return strict JSON with fields: summary, contentText, contentJson, stdout, stderr.",
    "The contentText must be the actual task result.",
    "The contentJson must be a structured object that reflects the task result.",
    "",
    "Skill source:",
    skillArtifact.content,
    "",
    "Task instance:",
    JSON.stringify(args.request.taskInstance, null, 2),
    "",
    "Upstream artifacts:",
    JSON.stringify(args.request.upstreamArtifacts.map((artifact) => ({
      id: artifact.id,
      type: artifact.type,
      title: artifact.title,
      summary: artifact.summary,
      contentText: artifact.contentText,
    })), null, 2),
    "",
    "Selected capability:",
    JSON.stringify({
      id: args.capability.id,
      label: args.capability.label,
      capabilityType: args.capability.capabilityType,
      summary: args.capability.summary,
    }, null, 2),
  ].join("\n");

  const response = await args.executionLLM.generateJson({
    config: args.request.agent.model,
    systemPrompt: prompt,
    userPrompt: JSON.stringify(
      {
        runId: args.request.runId ?? args.request.harness.id,
        taskInstanceId: args.request.taskInstance.id,
        agentId: args.request.agent.id,
      },
      null,
      2,
    ),
    schemaName: "RuntimeSkillExecution",
  });

  let parsed: {
    summary?: unknown;
    contentText?: unknown;
    contentJson?: unknown;
    stdout?: unknown;
    stderr?: unknown;
  };
  try {
    parsed = JSON.parse(response.rawText) as typeof parsed;
  } catch (error) {
    return {
      success: false,
      summary: `Skill execution returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      error: "runtime_skill_execution_invalid_json",
      artifacts: [],
    };
  }

  const summary = typeof parsed.summary === "string" && parsed.summary.trim().length > 0 ? parsed.summary : `Executed skill ${args.capability.label}.`;
  const contentText = typeof parsed.contentText === "string" && parsed.contentText.trim().length > 0 ? parsed.contentText : summary;
  const contentJson = parsed.contentJson ?? {
    summary,
    contentText,
    stdout: typeof parsed.stdout === "string" ? parsed.stdout : "",
    stderr: typeof parsed.stderr === "string" ? parsed.stderr : "",
  };
  const stdout = typeof parsed.stdout === "string" ? parsed.stdout : "";
  const stderr = typeof parsed.stderr === "string" ? parsed.stderr : "";

  return {
    success: true,
    summary,
    artifacts: [
      makeRuntimeArtifact({
        specType: "agent.output",
        title: `Agent output: ${args.request.agent.label}`,
        ownerId: args.request.agent.id,
        sourceTemplateId: "runtime.agent.output.v1",
        artifactType: "report",
        contentJson: {
          nodeId: args.request.agent.id,
          nodeName: args.request.agent.label,
          runId: args.request.runId ?? args.request.harness.id,
          taskInstanceId: args.request.taskInstance.id,
          taskInstruction: args.request.taskInstance.instruction,
          decision: args.decision,
          capabilityId: args.capability.id,
          capabilityLabel: args.capability.label,
          capabilityType: args.capability.capabilityType,
          selectedSkillArtifactId: skillArtifact.id,
          stdout,
          stderr,
          status: "completed",
          summary,
          execution: contentJson,
        },
        contentText,
        summary,
      }),
    ],
  };
}

async function executeScriptRuntime(args: {
  request: RuntimeStepRequest;
  decision: AgentRuntimeDecision;
  capability: import("shared/types").CapabilityNode;
}): Promise<{
  success: boolean;
  summary: string;
  error?: string;
  artifacts: SpecArtifact[];
}> {
  const scriptArtifact = findLatestArtifact(args.request.harness.specArtifacts, args.request.agent.id, "script.compiled");
  if (!scriptArtifact) {
    return {
      success: false,
      summary: `No compiled script artifact found for ${args.request.agent.label}.`,
      error: "runtime_script_artifact_missing",
      artifacts: [makeScriptExecutionArtifact(args, { compiledPath: null, status: "failed", exitCode: null, stdout: "", stderr: "script artifact missing", durationMs: 0 })],
    };
  }

  const compiledPath = scriptArtifact.compiledPath;
  if (!compiledPath || !fs.existsSync(compiledPath)) {
    return {
      success: false,
      summary: `Compiled script path is missing for ${args.request.agent.label}.`,
      error: "runtime_script_compiled_path_missing",
      artifacts: [makeScriptExecutionArtifact(args, { compiledPath: compiledPath ?? null, status: "failed", exitCode: null, stdout: "", stderr: "compiled script path missing", durationMs: 0 })],
    };
  }

  const resolvedCompiledPath = path.resolve(compiledPath);
  if (!isPathInsideAllowedScriptRoot(resolvedCompiledPath)) {
    const message = "Refusing to execute script outside artifact sandbox";
    return {
      success: false,
      summary: message,
      error: "runtime_script_outside_artifact_sandbox",
      artifacts: [makeScriptExecutionArtifact(args, { compiledPath, status: "failed", exitCode: null, stdout: "", stderr: message, durationMs: 0 })],
    };
  }

  const runtimeInput = {
    runId: args.request.runId ?? args.request.harness.id,
    taskInstance: args.request.taskInstance,
    agent: {
      id: args.request.agent.id,
      label: args.request.agent.label,
      role: args.request.agent.role,
    },
    decision: args.decision,
    capability: {
      id: args.capability.id,
      label: args.capability.label,
      capabilityType: args.capability.capabilityType,
    },
    upstreamArtifacts: args.request.upstreamArtifacts.map((artifact) => ({
      id: artifact.id,
      type: artifact.type,
      title: artifact.title,
      summary: artifact.summary,
      contentText: artifact.contentText,
    })),
  };

  const executed = await runScriptProcess(resolvedCompiledPath, {
    NODE_ENV: "production",
    HARNESS_RUN_ID: args.request.runId ?? args.request.harness.id,
    HARNESS_TASK_ID: args.request.taskInstance.id,
    HARNESS_AGENT_ID: args.request.agent.id,
    HARNESS_RUNTIME_INPUT_JSON: JSON.stringify(runtimeInput),
    HARNESS_RUNTIME_TASK_INSTANCE_JSON: JSON.stringify(args.request.taskInstance),
  });

  const executionArtifact = makeScriptExecutionArtifact(args, {
    compiledPath,
    status: executed.status,
    exitCode: executed.exitCode,
    stdout: executed.stdout.trim(),
    stderr: executed.stderr.trim(),
    stdoutTruncated: executed.stdoutTruncated,
    stderrTruncated: executed.stderrTruncated,
    durationMs: executed.durationMs,
    timeoutMs: executed.timeoutMs,
  });

  const stdout = executed.stdout.trim();
  const stderr = executed.stderr.trim();
  if (executed.status !== "completed") {
    return {
      success: false,
      summary: stderr || `Script execution failed for ${args.request.agent.label}.`,
      error: executed.status === "timeout" ? "runtime_script_execution_timeout" : `runtime_script_execution_failed:${executed.exitCode ?? "unknown"}`,
      artifacts: [executionArtifact],
    };
  }

  const summary = stdout.split("\n").map((line) => line.trim()).find(Boolean) || `Script executed successfully for ${args.request.agent.label}.`;
  return {
    success: true,
    summary,
    artifacts: [
      makeRuntimeArtifact({
        specType: "agent.output",
        title: `Agent output: ${args.request.agent.label}`,
        ownerId: args.request.agent.id,
        sourceTemplateId: "runtime.agent.output.v1",
        artifactType: "report",
        contentJson: {
          nodeId: args.request.agent.id,
          nodeName: args.request.agent.label,
          runId: args.request.runId ?? args.request.harness.id,
          taskInstanceId: args.request.taskInstance.id,
          taskInstruction: args.request.taskInstance.instruction,
          decision: args.decision,
          capabilityId: args.capability.id,
          capabilityLabel: args.capability.label,
          capabilityType: args.capability.capabilityType,
          selectedScriptArtifactId: scriptArtifact.id,
          compiledPath,
          stdout,
          stderr,
          status: "completed",
          summary,
          runtimeInput,
        },
        contentText: stdout || summary,
        summary,
      }),
      executionArtifact,
    ],
  };
}

function isPathInsideAllowedScriptRoot(resolvedCompiledPath: string): boolean {
  const normalizedCompiledPath = path.normalize(resolvedCompiledPath);
  const allowedRoots = [
    path.resolve(process.cwd(), "data/frameworks"),
    path.resolve(process.cwd(), readArtifactDir()),
  ].map((root) => path.normalize(root));

  return allowedRoots.some((root) => normalizedCompiledPath === root || normalizedCompiledPath.startsWith(`${root}${path.sep}`));
}

const SCRIPT_EXECUTION_TIMEOUT_MS = 60_000;
const MAX_SCRIPT_EXECUTION_TIMEOUT_MS = 300_000;
const MAX_STDIO_BYTES = 1_000_000;

function runScriptProcess(compiledPath: string, env: Record<string, string>): Promise<{
  status: "completed" | "failed" | "timeout";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  durationMs: number;
  timeoutMs: number;
}> {
  const timeoutMs = Math.min(SCRIPT_EXECUTION_TIMEOUT_MS, MAX_SCRIPT_EXECUTION_TIMEOUT_MS);
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [compiledPath], {
      env: env as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      const next = chunk.toString("utf8");
      if (Buffer.byteLength(stdout + next) > MAX_STDIO_BYTES) {
        stdoutTruncated = true;
        stdout = Buffer.from(stdout + next).subarray(0, MAX_STDIO_BYTES).toString("utf8");
      } else {
        stdout += next;
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const next = chunk.toString("utf8");
      if (Buffer.byteLength(stderr + next) > MAX_STDIO_BYTES) {
        stderrTruncated = true;
        stderr = Buffer.from(stderr + next).subarray(0, MAX_STDIO_BYTES).toString("utf8");
      } else {
        stderr += next;
      }
    });
    child.on("error", (error: Error) => {
      clearTimeout(timer);
      resolve({
        status: "failed",
        exitCode: null,
        stdout,
        stderr: error.message,
        stdoutTruncated,
        stderrTruncated,
        durationMs: Date.now() - startedAt,
        timeoutMs,
      });
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({
        status: timedOut ? "timeout" : code === 0 ? "completed" : "failed",
        exitCode: timedOut ? null : code,
        stdout,
        stderr,
        stdoutTruncated,
        stderrTruncated,
        durationMs: Date.now() - startedAt,
        timeoutMs,
      });
    });
  });
}

function makeScriptExecutionArtifact(args: {
  request: RuntimeStepRequest;
  decision: AgentRuntimeDecision;
  capability: import("shared/types").CapabilityNode;
}, result: {
  compiledPath: string | null;
  status: "completed" | "failed" | "timeout";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  durationMs: number;
  timeoutMs?: number;
}): SpecArtifact {
  return makeRuntimeArtifact({
    specType: "script.execution",
    title: "Script execution result",
    ownerId: args.request.agent.id,
    sourceTemplateId: "runtime.script.execution.v1",
    artifactType: "raw",
    contentJson: {
      runId: args.request.runId ?? args.request.harness.id,
      taskId: args.request.taskInstance.id,
      agentId: args.request.agent.id,
      compiledPath: result.compiledPath,
      status: result.status,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutTruncated: Boolean(result.stdoutTruncated),
      stderrTruncated: Boolean(result.stderrTruncated),
      durationMs: result.durationMs,
      timeoutMs: result.timeoutMs ?? null,
    },
    contentText: result.stdout || result.stderr,
    summary: `Script execution ${result.status}`,
  });
}

function findLatestArtifact(
  artifacts: import("shared/types").SpecArtifact[],
  ownerId: string,
  specType: import("shared/types").SpecArtifact["specType"],
): import("shared/types").SpecArtifact | null {
  return [...artifacts].reverse().find((artifact) => artifact.ownerId === ownerId && artifact.specType === specType) ?? null;
}

function buildAgentOutputText(decision: AgentRuntimeDecision, fallback: string): string {
  const draftText = decision.agentOutputDraft?.contentText;
  if (typeof draftText === "string" && draftText.trim().length > 0) {
    return draftText;
  }
  return fallback;
}

function makeBlockedOutputArtifact(
  request: RuntimeStepRequest,
  error: string,
  summary: string,
): SpecArtifact {
  return makeRuntimeArtifact({
    specType: "agent.output",
    title: `Agent output: ${request.agent.label}`,
    ownerId: request.agent.id,
    sourceTemplateId: "runtime.agent.output.v1",
    artifactType: "report",
    contentJson: {
      nodeId: request.agent.id,
      nodeName: request.agent.label,
      runId: request.runId ?? request.harness.id,
      taskInstanceId: request.taskInstance.id,
      taskInstruction: request.taskInstance.instruction,
      status: "failed",
      summary,
      error,
      blockedBy: error,
    },
    contentText: summary,
    summary,
  });
}

function buildPlanText(agentLabel: string, decision: AgentRuntimeDecision): string {
  return [
    `# Agent Plan`,
    ``,
    `Agent: ${agentLabel}`,
    `Action: ${decision.actionDecision}`,
    `Task Summary: ${decision.taskSummary}`,
    `Handoff Summary: ${decision.handoffSummary}`,
    `Expected Artifact: ${decision.expectedArtifactSchema.title}`,
  ].join("\n");
}

function makeRuntimeArtifact(input: {
  specType: SpecArtifact["specType"];
  title: string;
  ownerId: string;
  sourceTemplateId: string;
  artifactType: SpecArtifact["artifactType"];
  contentJson: unknown;
  contentText: string;
  summary: string;
}): SpecArtifact {
  const createdAt = nowIso();
  const content = input.contentText.trim().length > 0 ? input.contentText : JSON.stringify(input.contentJson, null, 2);
  return {
    id: makeId("artifact"),
    specType: input.specType,
    title: input.title,
    kind: input.specType === "agent.plan" ? "execution" : "output",
    artifactType: input.artifactType,
    content,
    contentJson: input.contentJson,
    contentHash: hash16(content),
    sourceTemplateId: input.sourceTemplateId,
    compiledFrom: [input.ownerId],
    ownerType: "agent",
    ownerId: input.ownerId,
    sourceText: typeof input.contentText === "string" ? input.contentText : undefined,
    compileStatus: "not-applicable",
    backtestStatus: "not-applicable",
    createdAt,
    updatedAt: createdAt,
  };
}
