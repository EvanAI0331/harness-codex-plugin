import type { AgentNode, Harness, SpecArtifact } from "shared/types";
import type { SpecxContractSourcePayload } from "@/lib/specx/contract";

const REQUIRED_EXECUTION_STAGES = [
  "read_task_instance",
  "read_upstream_artifacts",
  "llm_reasoning_decision",
  "capability_selection",
  "skill_or_script_execution_when_selected",
  "persist_agent_output_artifact",
  "handoff_to_downstream_agent",
];

const GENERIC_OUTPUT_FIELDS = new Set(["summary", "status", "nodeId", "trace"]);

export function validateAgentThreeLayerSpecs(harness: Harness, agent: AgentNode): string[] {
  const issues: string[] = [];
  const artifacts = harness.specArtifacts.filter((artifact) => artifact.ownerId === agent.id);
  const contractArtifact = latestArtifact(artifacts, "spec.contract.compiled");
  const roleArtifact = latestArtifact(artifacts, "role");
  const executionArtifact = latestArtifact(artifacts, "execution");
  const outputArtifact = latestArtifact(artifacts, "output");

  if (!contractArtifact || contractArtifact.compileStatus !== "success" || contractArtifact.backtestStatus !== "success") {
    issues.push("compiled SpecX contract missing or not backtest-success");
    return issues;
  }

  const contract = parseJson<SpecxContractSourcePayload>(contractArtifact.content, "compiled SpecX contract", issues);
  if (!contract) {
    return issues;
  }

  validateRoleSpec(roleArtifact, contract, agent, issues);
  validateExecutionSpec(executionArtifact, contract, agent, issues);
  validateOutputSpec(outputArtifact, contract, agent, issues);

  return issues;
}

function validateRoleSpec(
  artifact: SpecArtifact | undefined,
  contract: SpecxContractSourcePayload,
  agent: AgentNode,
  issues: string[],
): void {
  const spec = parseLayerSpec(artifact, "role", agent, issues);
  if (!spec) return;
  expectEqual(spec.specFamily, "agent-role", "role.specFamily", issues);
  expectEqual(spec.agentId, agent.id, "role.agentId", issues);
  expectEqual(spec.role, contract.outputContract.role, "role.role", issues);
  expectArrayMin(spec.mission, 3, "role.mission", issues);
  expectEqual(
    readPath(spec, ["capabilityBoundary", "githubSearchPolicy"]),
    "GitHub search may only resolve skills, tools, libraries, or repositories; it is forbidden for information or content research.",
    "role.capabilityBoundary.githubSearchPolicy",
    issues,
  );
  expectStringArrayEquals(readPath(spec, ["outputObligation", "requiredFields"]), contract.outputContract.requiredFields, "role.outputObligation.requiredFields", issues);
}

function validateExecutionSpec(
  artifact: SpecArtifact | undefined,
  contract: SpecxContractSourcePayload,
  agent: AgentNode,
  issues: string[],
): void {
  const spec = parseLayerSpec(artifact, "execution", agent, issues);
  if (!spec) return;
  expectEqual(spec.specFamily, "agent-execution", "execution.specFamily", issues);
  expectEqual(spec.agentId, agent.id, "execution.agentId", issues);
  expectEqual(spec.runtimeOrder, contract.runtimeBinding.runtimeOrder, "execution.runtimeOrder", issues);
  expectStringArrayEquals(spec.dependencyIds, contract.runtimeBinding.dependencyIds, "execution.dependencyIds", issues);
  expectStringArrayEquals(spec.requiredArtifacts, contract.runtimeBinding.requiredArtifacts, "execution.requiredArtifacts", issues);
  expectStringArrayIncludes(spec.stages, REQUIRED_EXECUTION_STAGES, "execution.stages", issues);
  expectStringArrayEquals(spec.gates, contract.validation.requiredChecks, "execution.gates", issues);
}

function validateOutputSpec(
  artifact: SpecArtifact | undefined,
  contract: SpecxContractSourcePayload,
  agent: AgentNode,
  issues: string[],
): void {
  const spec = parseLayerSpec(artifact, "output", agent, issues);
  if (!spec) return;
  expectEqual(spec.specFamily, "agent-output", "output.specFamily", issues);
  expectEqual(spec.agentId, agent.id, "output.agentId", issues);
  expectEqual(spec.artifactType, contract.outputContract.artifactType, "output.artifactType", issues);
  expectEqual(spec.outputType, contract.outputContract.outputType, "output.outputType", issues);
  expectStringArrayEquals(spec.requiredFields, contract.outputContract.requiredFields, "output.requiredFields", issues);
  expectStringArrayEquals(spec.contentFields, contract.outputContract.contentFields, "output.contentFields", issues);
  expectArrayMin(spec.qualityGates, 3, "output.qualityGates", issues);
  for (const field of [...toStringArray(spec.requiredFields), ...toStringArray(spec.contentFields)]) {
    if (GENERIC_OUTPUT_FIELDS.has(field)) {
      issues.push(`output contains forbidden generic field ${field}`);
    }
  }
}

function parseLayerSpec(
  artifact: SpecArtifact | undefined,
  specType: "role" | "execution" | "output",
  agent: AgentNode,
  issues: string[],
): Record<string, unknown> | null {
  if (!artifact) {
    issues.push(`${specType} spec missing`);
    return null;
  }
  if (artifact.artifactType !== "compiled" || artifact.compileStatus !== "success") {
    issues.push(`${specType} spec not compiled successfully`);
  }
  if (artifact.ownerId !== agent.id || artifact.ownerType !== "agent") {
    issues.push(`${specType} spec owner mismatch`);
  }
  if (!artifact.compiledFrom.some((id) => id === agent.id)) {
    issues.push(`${specType} spec is not linked to agent in compiledFrom`);
  }
  return parseJson<Record<string, unknown>>(artifact.content, `${specType} spec`, issues);
}

function latestArtifact(artifacts: SpecArtifact[], specType: SpecArtifact["specType"]): SpecArtifact | undefined {
  return [...artifacts].reverse().find((artifact) => artifact.specType === specType);
}

function parseJson<T>(content: string, label: string, issues: string[]): T | null {
  try {
    return JSON.parse(content) as T;
  } catch (error) {
    issues.push(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function expectEqual(actual: unknown, expected: unknown, label: string, issues: string[]): void {
  if (actual !== expected) {
    issues.push(`${label} mismatch`);
  }
}

function expectArrayMin(actual: unknown, minItems: number, label: string, issues: string[]): void {
  if (!Array.isArray(actual) || actual.length < minItems) {
    issues.push(`${label} must contain at least ${minItems} items`);
  }
}

function expectStringArrayEquals(actual: unknown, expected: string[], label: string, issues: string[]): void {
  const normalized = toStringArray(actual);
  if (normalized.length !== expected.length || normalized.some((item, index) => item !== expected[index])) {
    issues.push(`${label} mismatch`);
  }
}

function expectStringArrayIncludes(actual: unknown, expectedItems: string[], label: string, issues: string[]): void {
  const normalized = new Set(toStringArray(actual));
  for (const expected of expectedItems) {
    if (!normalized.has(expected)) {
      issues.push(`${label} missing ${expected}`);
    }
  }
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function readPath(value: Record<string, unknown>, path: string[]): unknown {
  let cursor: unknown = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}
