import type { AgentNode, ArtifactReference, Harness, HarnessEvent, RunArtifact, RunPolicy, SpecArtifact, TaskInstance } from "shared/types";
import { makeId } from "@/lib/id";
import { nowIso } from "@/lib/time";
import type { RuntimeExecutorAdapter, RuntimeExecutionStep } from "@/lib/runtime/types";
import { SimpleRuntimeExecutorAdapter } from "@/lib/runtime/simple-executor-adapter";
import { createArtifact, toArtifactReference } from "@/lib/artifact-repository";

export interface RuntimeExecutionOutcome {
  harness: Harness;
  events: HarnessEvent[];
  steps: RuntimeExecutionStep[];
  artifacts: SpecArtifact[];
}

export interface RuntimeExecutionHooks {
  onStep?: (snapshot: Harness, step: RuntimeExecutionStep, event: HarnessEvent) => Promise<void> | void;
  onEvent?: (event: HarnessEvent) => Promise<void> | void;
  context?: {
    runId?: string;
    taskInstruction?: string;
    taskInstance?: TaskInstance;
    taskInstanceArtifact?: RunArtifact;
    runPolicy?: RunPolicy;
  };
}

export class RuntimeExecutorService {
  constructor(private readonly adapter: RuntimeExecutorAdapter = new SimpleRuntimeExecutorAdapter()) {}

  async execute(harness: Harness, hooks: RuntimeExecutionHooks = {}): Promise<RuntimeExecutionOutcome> {
    const orderedAgents = resolveRuntimeOrder(harness);
    const events: HarnessEvent[] = [];
    const steps: RuntimeExecutionStep[] = [];
    const artifacts: SpecArtifact[] = [];
    const runId = hooks.context?.runId ?? harness.id;
    const taskInstance = hooks.context?.taskInstance;
    const runPolicy = hooks.context?.runPolicy;
    if (!taskInstance) {
      throw new Error("Runtime execution requires a task instance.");
    }
    if (!runPolicy) {
      throw new Error("Runtime execution requires a run policy.");
    }
    const latestArtifactsByNode = new Map<string, RunArtifact>();
    if (hooks.context?.taskInstanceArtifact) {
      latestArtifactsByNode.set(hooks.context.taskInstanceArtifact.id, hooks.context.taskInstanceArtifact);
    }

    const startedEvent = buildRuntimeEvent(harness.id, "runtime.started", "Runtime execution started.", {
      orderedAgents: orderedAgents.map((agent) => agent.id),
      runId,
      taskInstruction: hooks.context?.taskInstruction,
      taskInstanceId: hooks.context?.taskInstance?.id,
    });
    events.push(startedEvent);
    await hooks.onStep?.(harness, {
      nodeId: harness.id,
      nodeName: harness.name,
      action: "runtime.started",
      status: "running",
      summary: "Runtime simulation started.",
      timestamp: startedEvent.createdAt,
    }, startedEvent);

    let current = harness;
    for (const agent of orderedAgents) {
      const binding = resolveRuntimeBinding(current, agent);
      const dependencyStatuses = dependencyStatusSnapshot(current, agent);
      const upstreamArtifacts = Array.from(latestArtifactsByNode.values());
      const upstreamArtifactRefs = upstreamArtifacts.map(toArtifactReference);
      const validationArtifact = persistRuntimeArtifact({
        runId,
        harnessId: current.id,
        nodeId: agent.id,
        type: "spec_validation",
        title: `Spec validation: ${agent.label}`,
        summary: binding ? `Spec validation passed for ${agent.label}.` : `Spec validation failed for ${agent.label}.`,
        contentJson: {
          nodeId: agent.id,
          nodeName: agent.label,
          status: binding ? "passed" : "failed",
          contractArtifactId: binding?.contractArtifactId ?? null,
          backtestStatus: binding?.backtestStatus ?? "failure",
          dependencyStatuses,
          runId,
          taskInstruction: hooks.context?.taskInstruction ?? null,
          reason: binding ? null : "contract_binding_missing_or_unverified",
        },
        contentText: binding
          ? `Spec validation passed for ${agent.label}.`
          : `Spec validation failed for ${agent.label}. No verified SpecX contract binding found.`,
      });
      latestArtifactsByNode.set(agent.id, validationArtifact);

      if (!binding) {
        const nodeResultArtifact = persistRuntimeArtifact({
          runId,
          harnessId: current.id,
          nodeId: agent.id,
          type: "node_result",
          title: `Node result: ${agent.label}`,
          summary: `No verified SpecX contract binding found for ${agent.label}.`,
          contentJson: {
            nodeId: agent.id,
            nodeName: agent.label,
            status: "failed",
            action: "contract_binding_missing",
            summary: `No verified SpecX contract binding found for ${agent.label}.`,
            validationArtifactId: validationArtifact.id,
            runId,
            taskInstruction: hooks.context?.taskInstruction ?? null,
          },
          contentText: `No verified SpecX contract binding found for ${agent.label}.`,
        });
        const errorArtifact = persistRuntimeArtifact({
          runId,
          harnessId: current.id,
          nodeId: agent.id,
          type: "error",
          title: `Runtime error: ${agent.label}`,
          summary: `No verified SpecX contract binding found for ${agent.label}.`,
          contentJson: {
            nodeId: agent.id,
            nodeName: agent.label,
            action: "contract_binding_missing",
            error: "contract_binding_missing",
            summary: `No verified SpecX contract binding found for ${agent.label}.`,
            runId,
            taskInstruction: hooks.context?.taskInstruction ?? null,
            nodeResultArtifactId: nodeResultArtifact.id,
          },
          contentText: `No verified SpecX contract binding found for ${agent.label}.`,
        });
        const outputArtifact = persistRuntimeArtifact({
          runId,
          harnessId: current.id,
          nodeId: agent.id,
          type: "agent.output",
          title: `Agent output: ${agent.label}`,
          summary: `No verified SpecX contract binding found for ${agent.label}.`,
          contentJson: {
            nodeId: agent.id,
            nodeName: agent.label,
            runId,
            taskInstanceId: taskInstance.id,
            taskInstruction: hooks.context?.taskInstruction ?? null,
            status: "failed",
            summary: `No verified SpecX contract binding found for ${agent.label}.`,
            error: "contract_binding_missing",
          },
          contentText: `No verified SpecX contract binding found for ${agent.label}.`,
        });
        latestArtifactsByNode.set(agent.id, outputArtifact);
        const failedEvent = buildRuntimeEvent(current.id, "node.failed", `${agent.label} failed during runtime.`, {
          nodeId: agent.id,
          nodeName: agent.label,
          action: "contract_binding_missing",
          summary: `No verified SpecX contract binding found for ${agent.label}.`,
          error: "contract_binding_missing",
          validationArtifactId: validationArtifact.id,
          nodeResultArtifactId: nodeResultArtifact.id,
          errorArtifactId: errorArtifact.id,
          outputArtifactId: outputArtifact.id,
          runId,
          taskInstruction: hooks.context?.taskInstruction,
        });
        current = updateAgentStatus(current, agent.id, "failed");
        events.push(failedEvent);
        const failedStep: RuntimeExecutionStep = {
          nodeId: agent.id,
          nodeName: agent.label,
          action: "contract_binding_missing",
          status: "failed",
          summary: `No verified SpecX contract binding found for ${agent.label}.`,
          timestamp: failedEvent.createdAt,
        };
        steps.push(failedStep);
        await hooks.onStep?.(current, failedStep, failedEvent);
        return {
          harness: current,
          events,
          steps,
          artifacts,
        };
      }

      const contractArtifact = findRuntimeContractArtifact(current, agent);
      const outputContract = extractOutputContract(contractArtifact);
      const runningEvent = buildRuntimeEvent(current.id, "node.running", `${agent.label} is running.`, {
        nodeId: agent.id,
        nodeName: agent.label,
        action: "delegate",
        summary: `Executing agent ${agent.label}.`,
        dependencyStatuses,
        contractArtifactId: binding.contractArtifactId,
        outputContract,
        backtestStatus: binding.backtestStatus,
        validationArtifactId: validationArtifact.id,
        artifactRefs: upstreamArtifactRefs.map((artifact) => artifact.id),
        upstreamArtifactIds: upstreamArtifacts.map((artifact) => artifact.id),
        runId,
        taskInstruction: hooks.context?.taskInstruction,
        taskInstanceId: hooks.context?.taskInstance?.id,
      });
      current = updateAgentStatus(current, agent.id, "running");
      events.push(runningEvent);
      await hooks.onStep?.(current, {
        nodeId: agent.id,
        nodeName: agent.label,
        action: "delegate",
        status: "running",
        summary: `Executing agent ${agent.label}.`,
        timestamp: runningEvent.createdAt,
      }, runningEvent);

      const result = await this.adapter.execute({
        harness: current,
        agent,
        availableCapabilities: current.capabilityNodes,
        dependencyStatuses,
        runtimeEvents: events.slice(),
        runtimeSteps: steps.slice(),
        upstreamArtifacts,
        artifactRefs: upstreamArtifactRefs,
        runId,
        taskInstruction: hooks.context?.taskInstruction,
        binding,
        contractArtifact,
        outputContract,
        taskInstance: hooks.context?.taskInstance!,
        runPolicy: hooks.context?.runPolicy!,
      });

      if (result.artifacts?.length) {
        artifacts.push(...result.artifacts);
        for (const artifact of result.artifacts) {
          const persisted = persistSpecArtifact(runId, current.id, agent.id, artifact);
          latestArtifactsByNode.set(agent.id, persisted);
        }
      }

      if (!result.success) {
        const failedHarness = updateAgentStatus(current, agent.id, "failed");
        const nodeResultArtifact = persistRuntimeArtifact({
          runId,
          harnessId: failedHarness.id,
          nodeId: agent.id,
          type: "node_result",
          title: `Node result: ${agent.label}`,
          summary: result.summary,
          contentJson: {
            nodeId: agent.id,
            nodeName: agent.label,
            status: "failed",
            action: result.action,
            summary: result.summary,
            error: result.error ?? "runtime_execution_failed",
            validationArtifactId: validationArtifact.id,
            artifactIds: result.artifacts?.map((artifact) => artifact.id) ?? [],
            toolCallIds: result.artifacts?.filter((artifact) => artifact.specType === "tool.result").map((artifact) => artifact.id) ?? [],
            runId,
            taskInstruction: hooks.context?.taskInstruction ?? null,
          },
          contentText: result.summary,
        });
        latestArtifactsByNode.set(agent.id, nodeResultArtifact);
        const errorArtifact = persistRuntimeArtifact({
          runId,
          harnessId: failedHarness.id,
          nodeId: agent.id,
          type: "error",
          title: `Runtime error: ${agent.label}`,
          summary: result.summary,
          contentJson: {
            nodeId: agent.id,
            nodeName: agent.label,
            action: result.action,
            summary: result.summary,
            error: result.error ?? "runtime_execution_failed",
            validationArtifactId: validationArtifact.id,
            nodeResultArtifactId: nodeResultArtifact.id,
            artifactIds: result.artifacts?.map((artifact) => artifact.id) ?? [],
            toolCallIds: result.artifacts?.filter((artifact) => artifact.specType === "tool.result").map((artifact) => artifact.id) ?? [],
            runId,
            taskInstruction: hooks.context?.taskInstruction ?? null,
          },
          contentText: result.summary,
        });
        latestArtifactsByNode.set(agent.id, errorArtifact);
        for (const toolCall of result.toolCalls ?? []) {
          const toolEvent = buildRuntimeEvent(failedHarness.id, "runtime.tool.failed", `${agent.label} tool call failed.`, {
            nodeId: agent.id,
            nodeName: agent.label,
            capabilityId: toolCall.capabilityId,
            capabilityLabel: toolCall.capabilityLabel,
            action: toolCall.toolName,
            summary: toolCall.summary,
            query: toolCall.query,
            backend: toolCall.backend,
            mode: toolCall.mode,
            stdout: toolCall.stdout,
            stderr: toolCall.stderr,
            status: "failed",
            artifactId: result.artifacts?.find((artifact) => artifact.specType === "tool.result")?.id,
            runId,
            taskInstruction: hooks.context?.taskInstruction,
          });
          events.push(toolEvent);
          await hooks.onStep?.(failedHarness, {
            nodeId: agent.id,
            nodeName: agent.label,
            action: toolCall.toolName,
            status: "failed",
            summary: toolCall.summary,
            timestamp: toolEvent.createdAt,
          }, toolEvent);
        }
        const failedEvent = buildRuntimeEvent(failedHarness.id, "node.failed", `${agent.label} failed during runtime.`, {
          nodeId: agent.id,
          nodeName: agent.label,
          action: result.action,
          summary: result.summary,
          error: result.error,
          runId,
          taskInstruction: hooks.context?.taskInstruction,
        });
        events.push(failedEvent);
        steps.push({
          nodeId: agent.id,
          nodeName: agent.label,
          action: result.action,
          status: "failed",
          summary: result.summary,
          timestamp: failedEvent.createdAt,
        });
        await hooks.onStep?.(failedHarness, steps[steps.length - 1], failedEvent);
        return {
          harness: failedHarness,
          events,
          steps,
          artifacts,
        };
      }

      current = updateAgentStatus(current, agent.id, "completed");
      const nodeResultArtifact = persistRuntimeArtifact({
        runId,
        harnessId: current.id,
        nodeId: agent.id,
        type: "node_result",
        title: `Node result: ${agent.label}`,
        summary: result.summary,
        contentJson: {
          nodeId: agent.id,
          nodeName: agent.label,
          status: "completed",
          action: result.action,
          summary: result.summary,
          validationArtifactId: validationArtifact.id,
          artifactIds: result.artifacts?.map((artifact) => artifact.id) ?? [],
          toolCallIds: result.artifacts?.filter((artifact) => artifact.specType === "tool.result").map((artifact) => artifact.id) ?? [],
          runId,
          taskInstruction: hooks.context?.taskInstruction ?? null,
        },
        contentText: result.summary,
      });
      latestArtifactsByNode.set(agent.id, nodeResultArtifact);
      for (const toolCall of result.toolCalls ?? []) {
        const toolEvent = buildRuntimeEvent(current.id, "runtime.tool.completed", `${agent.label} tool call completed.`, {
          nodeId: agent.id,
          nodeName: agent.label,
          capabilityId: toolCall.capabilityId,
          capabilityLabel: toolCall.capabilityLabel,
          action: toolCall.toolName,
          summary: toolCall.summary,
          query: toolCall.query,
          backend: toolCall.backend,
          mode: toolCall.mode,
          stdout: toolCall.stdout,
          stderr: toolCall.stderr,
          status: "completed",
          artifactId: result.artifacts?.find((artifact) => artifact.specType === "tool.result")?.id,
          runId,
          taskInstruction: hooks.context?.taskInstruction,
        });
        events.push(toolEvent);
        await hooks.onStep?.(current, {
          nodeId: agent.id,
          nodeName: agent.label,
          action: toolCall.toolName,
          status: "completed",
          summary: toolCall.summary,
          timestamp: toolEvent.createdAt,
        }, toolEvent);
      }
      const completedEvent = buildRuntimeEvent(current.id, "node.completed", `${agent.label} completed successfully.`, {
        nodeId: agent.id,
        nodeName: agent.label,
        action: result.action,
        summary: result.summary,
        contractArtifactId: binding.contractArtifactId,
        validationArtifactId: validationArtifact.id,
        nodeResultArtifactId: nodeResultArtifact.id,
        runId,
        taskInstruction: hooks.context?.taskInstruction,
      });
      events.push(completedEvent);
      const step: RuntimeExecutionStep = {
        nodeId: agent.id,
        nodeName: agent.label,
        action: result.action,
        status: "completed",
        summary: result.summary,
        timestamp: completedEvent.createdAt,
      };
      steps.push(step);
      await hooks.onStep?.(current, step, completedEvent);
    }

    const finishedEvent = buildRuntimeEvent(current.id, "runtime.completed", "Runtime execution completed.", {
      nodeCount: steps.length,
      artifactCount: artifacts.length,
      runId,
    });
    events.push(finishedEvent);
    await hooks.onStep?.(current, {
      nodeId: current.id,
      nodeName: current.name,
      action: "runtime.completed",
      status: "completed",
      summary: "Runtime simulation completed.",
      timestamp: finishedEvent.createdAt,
    }, finishedEvent);

    return {
      harness: current,
      events,
      steps,
      artifacts,
    };
  }
}

function persistSpecArtifact(runId: string, harnessId: string, nodeId: string, artifact: SpecArtifact): RunArtifact {
  return createArtifact({
    id: artifact.id,
    runId,
    harnessId,
    nodeId,
    type: artifact.specType,
    title: artifact.title,
    contentJson: artifact,
    contentText: normalizeArtifactText(artifact),
    summary: artifact.title,
    createdAt: artifact.createdAt,
  });
}

function persistRuntimeArtifact(input: {
  runId: string;
  harnessId: string;
  nodeId?: string | null;
  type: string;
  title: string;
  contentJson: unknown;
  contentText?: string;
  summary?: string;
}): RunArtifact {
  return createArtifact({
    runId: input.runId,
    harnessId: input.harnessId,
    nodeId: input.nodeId ?? null,
    type: input.type,
    title: input.title,
    contentJson: input.contentJson,
    contentText: input.contentText,
    summary: input.summary,
  });
}

function persistToolCallArtifact(
  runId: string,
  harnessId: string,
  nodeId: string,
  toolCall: {
    capabilityId?: string;
    capabilityLabel?: string;
    toolName: string;
    query: string;
    backend?: string;
    mode?: string;
    summary: string;
    stdout?: string;
    stderr?: string;
  },
  success: boolean,
  taskInstruction?: string,
): RunArtifact {
  return persistRuntimeArtifact({
    runId,
    harnessId,
    nodeId,
    type: "capability_call",
    title: `${toolCall.toolName} capability call`,
    summary: toolCall.summary,
    contentJson: {
      nodeId,
      capabilityId: toolCall.capabilityId ?? null,
      capabilityLabel: toolCall.capabilityLabel ?? null,
      toolName: toolCall.toolName,
      query: toolCall.query,
      backend: toolCall.backend ?? null,
      mode: toolCall.mode ?? null,
      summary: toolCall.summary,
      stdout: toolCall.stdout ?? "",
      stderr: toolCall.stderr ?? "",
      status: success ? "completed" : "failed",
      runId,
      taskInstruction: taskInstruction ?? null,
    },
    contentText: toolCall.summary,
  });
}

function normalizeArtifactText(artifact: SpecArtifact): string {
  if (typeof artifact.content === "string" && artifact.content.trim().length > 0) {
    return artifact.content;
  }
  if (typeof artifact.sourceText === "string" && artifact.sourceText.trim().length > 0) {
    return artifact.sourceText;
  }
  if (typeof artifact.stdout === "string" && artifact.stdout.trim().length > 0) {
    return artifact.stdout;
  }
  if (typeof artifact.stderr === "string" && artifact.stderr.trim().length > 0) {
    return artifact.stderr;
  }
  return JSON.stringify(artifact, null, 2);
}

function resolveRuntimeOrder(harness: Harness): AgentNode[] {
  const agents = harness.agentNodes.length > 0 ? harness.agentNodes : harness.blueprint?.agents ?? [];
  const agentMap = new Map(agents.map((agent) => [agent.id, agent] as const));
  const agentIndexById = new Map(agents.map((agent, index) => [agent.id, index] as const));
  const adjacency = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  agents.forEach((agent) => {
    adjacency.set(agent.id, new Set());
    indegree.set(agent.id, 0);
  });

  const edges = harness.edges.length > 0 ? harness.edges : harness.blueprint?.edges ?? [];
  for (const edge of edges) {
    if (!agentMap.has(edge.source) || !agentMap.has(edge.target)) {
      continue;
    }
    if (edge.relation !== "depends_on" && edge.relation !== "delegates_to") {
      continue;
    }
    const sourceIndex = agentIndexById.get(edge.source);
    const targetIndex = agentIndexById.get(edge.target);
    if (typeof sourceIndex === "number" && typeof targetIndex === "number" && sourceIndex >= targetIndex) {
      continue;
    }
    const dependents = adjacency.get(edge.source);
    if (!dependents || dependents.has(edge.target)) {
      continue;
    }
    dependents.add(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const queue = agents.filter((agent) => (indegree.get(agent.id) ?? 0) === 0);
  const ordered: AgentNode[] = [];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) {
      continue;
    }
    ordered.push(next);
    const dependents = adjacency.get(next.id);
    if (!dependents) {
      continue;
    }
    for (const targetId of dependents) {
      const nextDegree = (indegree.get(targetId) ?? 0) - 1;
      indegree.set(targetId, nextDegree);
      if (nextDegree === 0) {
        const target = agentMap.get(targetId);
        if (target) {
          queue.push(target);
        }
      }
    }
  }

  if (ordered.length !== agents.length) {
    return agents;
  }

  return ordered;
}

function dependencyStatusSnapshot(harness: Harness, agent: AgentNode): Array<{ nodeId: string; status: AgentNode["status"] }> {
  const agentIndexById = new Map(harness.agentNodes.map((item, index) => [item.id, index] as const));
  const dependencyIds = new Set<string>();
  for (const edge of harness.edges) {
    if (edge.target !== agent.id) {
      continue;
    }
    if (edge.relation !== "depends_on" && edge.relation !== "delegates_to") {
      continue;
    }
    const sourceIndex = agentIndexById.get(edge.source);
    const targetIndex = agentIndexById.get(edge.target);
    if (typeof sourceIndex === "number" && typeof targetIndex === "number" && sourceIndex >= targetIndex) {
      continue;
    }
    dependencyIds.add(edge.source);
  }

  return Array.from(dependencyIds).map((nodeId) => {
    if (nodeId === harness.id) {
      return {
        nodeId,
        status: harness.status === "ready" ? "completed" : harness.status === "failed" ? "failed" : "blocked",
      };
    }
    const candidate = harness.agentNodes.find((item) => item.id === nodeId);
    return {
      nodeId,
      status: candidate?.status ?? "blocked",
    };
  });
}

function resolveRuntimeBinding(harness: Harness, agent: AgentNode) {
  const compiledArtifact = [...harness.specArtifacts]
    .reverse()
    .find((artifact) => artifact.ownerId === agent.id && artifact.specType === "spec.contract.compiled" && artifact.runtimeBinding);

  const hasSkill = [...harness.specArtifacts].reverse().some((artifact) => artifact.ownerId === agent.id && artifact.specType === "skill.compiled" && artifact.compileStatus === "success");
  const hasScript = [...harness.specArtifacts].reverse().some((artifact) => artifact.ownerId === agent.id && artifact.specType === "script.compiled" && artifact.compileStatus === "success");

  if (!compiledArtifact?.runtimeBinding || compiledArtifact.runtimeBinding.backtestStatus !== "success" || !hasSkill || !hasScript) {
    return null;
  }

  return compiledArtifact.runtimeBinding;
}

function findRuntimeContractArtifact(harness: Harness, agent: AgentNode): SpecArtifact | undefined {
  return [...harness.specArtifacts]
    .reverse()
    .find((artifact) => artifact.ownerId === agent.id && artifact.specType === "spec.contract.compiled" && artifact.runtimeBinding);
}

function extractOutputContract(artifact: SpecArtifact | undefined): unknown {
  if (!artifact?.content) {
    return null;
  }
  try {
    const parsed = JSON.parse(artifact.content) as { outputContract?: unknown };
    return parsed.outputContract ?? null;
  } catch {
    return null;
  }
}

function updateAgentStatus(harness: Harness, agentId: string, status: AgentNode["status"]): Harness {
  const updatedAgents = harness.agentNodes.map((agent) => (agent.id === agentId ? { ...agent, status, updatedAt: nowIso() } : agent));
  const updatedBlueprint = harness.blueprint
    ? {
        ...harness.blueprint,
        agents: harness.blueprint.agents.map((agent) => (agent.id === agentId ? { ...agent, status, updatedAt: nowIso() } : agent)),
      }
    : harness.blueprint;

  return {
    ...harness,
    agentNodes: updatedAgents,
    blueprint: updatedBlueprint,
    updatedAt: nowIso(),
  };
}

function buildRuntimeEvent(
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
