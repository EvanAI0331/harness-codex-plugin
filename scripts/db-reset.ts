import fs from "node:fs";
import path from "node:path";
import { getDatabase } from "@/lib/sqlite";
import { readDatabasePath } from "@/lib/env";

function main(): void {
  const dbPath = resolveWorkspacePath(readDatabasePath());
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  removeIfExists(dbPath);
  removeIfExists(`${dbPath}-wal`);
  removeIfExists(`${dbPath}-shm`);

  const db = getDatabase();
  seedSpecxVerificationHarness(db);
  console.log(`[db:reset] reset and reinitialized sqlite at ${dbPath}`);
}

function seedSpecxVerificationHarness(db: ReturnType<typeof getDatabase>): void {
  const now = new Date().toISOString();
  const harnessId = "harness_specx_verify_seed";
  const agentId = "agent-specx-verify-coding";
  const contract = {
    outputContract: {
      role: "engineering-senior-developer",
      artifactType: "agent.output",
      outputType: "engineering-senior-developer.runtime-output.v1",
      requiredFields: ["engineeringSeniorDeveloperDeliverable", "engineeringSeniorDeveloperFindings", "engineeringSeniorDeveloperHandoff"],
      contentFields: ["engineeringSeniorDeveloperDeliverable", "engineeringSeniorDeveloperFindings", "engineeringSeniorDeveloperHandoff"],
    },
    runtimeBinding: {
      dependencyIds: [harnessId],
    },
    validation: {
      requiredChecks: ["source schema validation", "compiled payload validation", "runtime binding backtest"],
    },
  };
  const artifacts = [
    {
      id: "artifact_seed_contract",
      specType: "spec.contract.compiled",
      title: "Seed Contract",
      kind: "contract",
      artifactType: "compiled",
      content: JSON.stringify(contract),
      contentHash: "seed",
      sourceTemplateId: "seed",
      compiledFrom: [harnessId, agentId],
      ownerType: "agent",
      ownerId: agentId,
      compileStatus: "success",
      backtestStatus: "success",
      createdAt: now,
      updatedAt: now,
    },
    layer("role", {
      specFamily: "agent-role",
      agentId,
      role: "engineering-senior-developer",
      outputObligation: { requiredFields: contract.outputContract.requiredFields },
    }),
    layer("execution", {
      specFamily: "agent-execution",
      agentId,
      dependencyIds: [harnessId],
      stages: [
        "read_task_instance",
        "read_upstream_artifacts",
        "llm_reasoning_decision",
        "capability_selection",
        "skill_or_script_execution_when_selected",
        "persist_agent_output_artifact",
        "handoff_to_downstream_agent",
      ],
      gates: contract.validation.requiredChecks,
    }),
    layer("output", {
      specFamily: "agent-output",
      agentId,
      artifactType: "agent.output",
      requiredFields: contract.outputContract.requiredFields,
      contentFields: contract.outputContract.contentFields,
    }),
  ];
  const agent = {
    id: agentId,
    nodeType: "agent",
    label: "SpecX Verify Coding Agent",
    role: "engineering-senior-developer",
    agentKind: "coding",
    executionOrder: 1,
    catalogGroup: "engineering",
    model: { provider: "openai_compatible", model: "seed", temperature: 0.2, maxTokens: 1024 },
    status: "completed",
    specArtifactIds: artifacts.map((artifact) => artifact.id),
    skillArtifactIds: [],
    scriptArtifactIds: [],
    capabilityIds: [],
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    `insert into harnesses (id,name,status,intake_json,blueprint_json,spec_artifacts_json,agent_nodes_json,capability_nodes_json,edges_json,created_at,updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    harnessId,
    "SpecX verification seed",
    "ready",
    JSON.stringify({ goal: "SpecX verification seed" }),
    JSON.stringify({ agents: [agent], specs: [], capabilities: [], edges: [] }),
    JSON.stringify(artifacts),
    JSON.stringify([agent]),
    JSON.stringify([]),
    JSON.stringify([]),
    now,
    now,
  );

  function layer(specType: "role" | "execution" | "output", content: Record<string, unknown>) {
    return {
      id: `artifact_seed_${specType}`,
      specType,
      title: `Seed ${specType}`,
      kind: specType,
      artifactType: "compiled",
      content: JSON.stringify(content),
      contentHash: "seed",
      sourceTemplateId: "seed",
      compiledFrom: [harnessId, agentId],
      ownerType: "agent",
      ownerId: agentId,
      compileStatus: "success",
      backtestStatus: "success",
      createdAt: now,
      updatedAt: now,
    };
  }
}

function removeIfExists(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch (error) {
    throw new Error(`Failed to remove ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolveWorkspacePath(value: string): string {
  return path.isAbsolute(value) ? value : path.join(process.cwd(), value);
}

main();
