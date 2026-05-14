import path from "node:path";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

type JsonRecord = Record<string, unknown>;
type AgentRow = { id: string; label?: string; role?: string };
type SpecArtifact = {
  id: string;
  specType: string;
  artifactType?: string;
  compileStatus?: string;
  backtestStatus?: string;
  ownerType?: string;
  ownerId?: string;
  compiledFrom?: string[];
  content?: string;
};

const harnessId = process.argv[2];
const dbPath = path.resolve(process.env.DATABASE_PATH ?? "data/harness.sqlite");
if (!fs.existsSync(dbPath)) {
  console.error(`[specx-three-layer] Database not found at ${dbPath}. Run npm run db:reset before npm run specx:verify, then build at least one harness.`);
  process.exit(1);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
if (!hasTable(db, "harnesses")) {
  console.error(`[specx-three-layer] Database at ${dbPath} has no harnesses table. Run npm run db:reset before npm run specx:verify.`);
  process.exit(1);
}
const rows = harnessId
  ? db.prepare("select id, agent_nodes_json, spec_artifacts_json from harnesses where id = ?").all(harnessId)
  : db.prepare("select id, agent_nodes_json, spec_artifacts_json from harnesses where spec_artifacts_json != '[]'").all();

if (rows.length === 0) {
  console.error(harnessId ? `[specx-three-layer] No harness found for ${harnessId}` : "[specx-three-layer] No harness artifacts found for verification");
  process.exit(1);
}

const failures: string[] = [];

for (const row of rows as Array<{ id: string; agent_nodes_json: string; spec_artifacts_json: string }>) {
  const agents = parseJson<AgentRow[]>(row.agent_nodes_json, []);
  const artifacts = parseJson<SpecArtifact[]>(row.spec_artifacts_json, []);
  for (const agent of agents) {
    const issues = validateAgentThreeLayerSpecs(agent, artifacts.filter((artifact) => artifact.ownerId === agent.id));
    if (issues.length > 0) {
      failures.push(`${row.id}/${agent.id}: ${issues.join("; ")}`);
    }
  }
}

db.close();

if (failures.length > 0) {
  console.error("[specx-three-layer] FAIL");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`[specx-three-layer] PASS ${rows.length} harness(es) checked`);

function validateAgentThreeLayerSpecs(agent: AgentRow, artifacts: SpecArtifact[]): string[] {
  const issues: string[] = [];
  const contractArtifact = latestArtifact(artifacts, "spec.contract.compiled");
  const roleArtifact = latestArtifact(artifacts, "role");
  const executionArtifact = latestArtifact(artifacts, "execution");
  const outputArtifact = latestArtifact(artifacts, "output");

  if (!contractArtifact || contractArtifact.compileStatus !== "success" || contractArtifact.backtestStatus !== "success") {
    issues.push("compiled SpecX contract missing or not backtest-success");
    return issues;
  }

  const contract = parseJson<JsonRecord>(contractArtifact.content ?? "", {});
  const outputContract = readObject(contract.outputContract);
  const runtimeBinding = readObject(contract.runtimeBinding);
  const validation = readObject(contract.validation);

  validateLayer(roleArtifact, "role", agent, issues);
  validateLayer(executionArtifact, "execution", agent, issues);
  validateLayer(outputArtifact, "output", agent, issues);

  const roleSpec = parseJson<JsonRecord>(roleArtifact?.content ?? "", {});
  expectEqual(roleSpec.specFamily, "agent-role", "role.specFamily", issues);
  expectEqual(roleSpec.agentId, agent.id, "role.agentId", issues);
  expectEqual(roleSpec.role, outputContract.role, "role.role", issues);
  expectArrayEquals(readPath(roleSpec, ["outputObligation", "requiredFields"]), toStringArray(outputContract.requiredFields), "role.outputObligation.requiredFields", issues);

  const executionSpec = parseJson<JsonRecord>(executionArtifact?.content ?? "", {});
  expectEqual(executionSpec.specFamily, "agent-execution", "execution.specFamily", issues);
  expectEqual(executionSpec.agentId, agent.id, "execution.agentId", issues);
  expectArrayEquals(executionSpec.dependencyIds, toStringArray(runtimeBinding.dependencyIds), "execution.dependencyIds", issues);
  expectArrayIncludes(executionSpec.stages, [
    "read_task_instance",
    "read_upstream_artifacts",
    "llm_reasoning_decision",
    "capability_selection",
    "skill_or_script_execution_when_selected",
    "persist_agent_output_artifact",
    "handoff_to_downstream_agent",
  ], "execution.stages", issues);
  expectArrayEquals(executionSpec.gates, toStringArray(validation.requiredChecks), "execution.gates", issues);

  const outputSpec = parseJson<JsonRecord>(outputArtifact?.content ?? "", {});
  expectEqual(outputSpec.specFamily, "agent-output", "output.specFamily", issues);
  expectEqual(outputSpec.agentId, agent.id, "output.agentId", issues);
  expectEqual(outputSpec.artifactType, outputContract.artifactType, "output.artifactType", issues);
  expectArrayEquals(outputSpec.requiredFields, toStringArray(outputContract.requiredFields), "output.requiredFields", issues);
  expectArrayEquals(outputSpec.contentFields, toStringArray(outputContract.contentFields), "output.contentFields", issues);
  for (const field of [...toStringArray(outputSpec.requiredFields), ...toStringArray(outputSpec.contentFields)]) {
    if (["summary", "status", "nodeId", "trace"].includes(field)) {
      issues.push(`output contains forbidden generic field ${field}`);
    }
  }

  return issues;
}

function validateLayer(artifact: SpecArtifact | undefined, specType: "role" | "execution" | "output", agent: AgentRow, issues: string[]): void {
  if (!artifact) {
    issues.push(`${specType} spec missing`);
    return;
  }
  if (artifact.artifactType !== "compiled" || artifact.compileStatus !== "success") {
    issues.push(`${specType} spec not compiled successfully`);
  }
  if (artifact.ownerType !== "agent" || artifact.ownerId !== agent.id) {
    issues.push(`${specType} spec owner mismatch`);
  }
  if (!Array.isArray(artifact.compiledFrom) || !artifact.compiledFrom.includes(agent.id)) {
    issues.push(`${specType} spec is not linked to agent in compiledFrom`);
  }
}

function latestArtifact(artifacts: SpecArtifact[], specType: string): SpecArtifact | undefined {
  return [...artifacts].reverse().find((artifact) => artifact.specType === specType);
}

function parseJson<T>(content: string, fallback: T): T {
  try {
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}

function readObject(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function readPath(value: JsonRecord, pathParts: string[]): unknown {
  let current: unknown = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as JsonRecord)[part];
  }
  return current;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function expectEqual(actual: unknown, expected: unknown, label: string, issues: string[]): void {
  if (actual !== expected) {
    issues.push(`${label} mismatch`);
  }
}

function expectArrayEquals(actual: unknown, expected: string[], label: string, issues: string[]): void {
  const normalized = toStringArray(actual);
  if (normalized.length !== expected.length || normalized.some((item, index) => item !== expected[index])) {
    issues.push(`${label} mismatch`);
  }
}

function expectArrayIncludes(actual: unknown, expected: string[], label: string, issues: string[]): void {
  const normalized = new Set(toStringArray(actual));
  for (const item of expected) {
    if (!normalized.has(item)) {
      issues.push(`${label} missing ${item}`);
    }
  }
}

function hasTable(db: DatabaseSync, tableName: string): boolean {
  const row = db.prepare("select name from sqlite_master where type = 'table' and name = ?").get(tableName) as { name?: string } | undefined;
  return row?.name === tableName;
}
