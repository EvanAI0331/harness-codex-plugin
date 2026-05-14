import type {
  AgentNode,
  CapabilityNode,
  CapabilityPolicy,
  Harness,
  HarnessBlueprint,
  HarnessEvent,
  HarnessStatus,
  ModelConfig,
  RequirementIntake,
  SpecArtifact,
} from "shared/types";
import { getDatabase } from "@/lib/sqlite";
import { readLLMSettings } from "@/lib/env";
import { findAgencyAgentByRole } from "@/lib/agency-agents/catalog";

interface HarnessRow {
  id: string;
  name: string;
  status: HarnessStatus;
  intake_json: string;
  blueprint_json: string | null;
  spec_artifacts_json: string;
  agent_nodes_json: string;
  capability_nodes_json: string;
  edges_json: string;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  harness_id: string;
  channel: HarnessEvent["channel"];
  phase: HarnessEvent["phase"];
  kind: string;
  message: string;
  payload_json: string;
  created_at: string;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeModelConfig(value: ModelConfig | undefined, fallback: ModelConfig): ModelConfig {
  return {
    provider: value?.provider ?? fallback.provider,
    model: value?.model ?? fallback.model,
    baseURL: typeof value?.baseURL === "string" ? value.baseURL : fallback.baseURL,
    credentialRef: typeof value?.credentialRef === "string" ? value.credentialRef : fallback.credentialRef,
    temperature: typeof value?.temperature === "number" ? value.temperature : fallback.temperature,
    maxTokens: typeof value?.maxTokens === "number" ? value.maxTokens : fallback.maxTokens,
  };
}

function normalizeCapabilityPolicy(value: CapabilityPolicy | undefined): CapabilityPolicy {
  return {
    allowGithubSearch: Boolean(value?.allowGithubSearch),
    allowAutoGenerateSkill: Boolean(value?.allowAutoGenerateSkill),
    allowAutoGenerateScript: Boolean(value?.allowAutoGenerateScript),
  };
}

function normalizeHarnessStatus(value: string): HarnessStatus {
  if (value === "draft" || value === "draft_ready" || value === "dirty" || value === "building" || value === "ready" || value === "failed") {
    return value;
  }
  if (value === "planning") {
    return "draft_ready";
  }
  return "draft";
}

function normalizeCapabilityNode(node: Partial<CapabilityNode> & Pick<CapabilityNode, "id" | "label" | "summary" | "createdAt" | "updatedAt">): CapabilityNode {
  return {
    ...node,
    nodeType: "capability",
    capabilityType: node.capabilityType ?? "tool",
    source: node.source ?? "unresolved",
    status: node.status ?? "unresolved",
    specArtifactIds: Array.isArray(node.specArtifactIds) ? node.specArtifactIds : [],
    policyFlags: normalizeCapabilityPolicy(node.policyFlags),
  };
}

function normalizeAgentNode(
  node: Partial<AgentNode> & Pick<AgentNode, "id" | "label" | "role" | "createdAt" | "updatedAt">,
  intake: RequirementIntake,
  index: number,
  total: number,
): AgentNode {
  const catalog = findAgencyAgentByRole(node.role);
  const normalizedKind =
    String(node.agentKind ?? "") === "output" ? "coding" : node.agentKind;
  const agentKind = normalizedKind ?? (catalog?.dispatcher ? "dispatcher" : index === total - 1 ? "coding" : "expert");
  return {
    ...node,
    nodeType: "agent",
    agentKind,
    executionOrder: typeof node.executionOrder === "number" ? node.executionOrder : index,
    catalogGroup: typeof node.catalogGroup === "string" ? node.catalogGroup : catalog?.group ?? "specialized",
    model: normalizeModelConfig(
      node.model,
      agentKind === "coding" || catalog?.group === "engineering" ? intake.codingAgentModel : intake.mainModel,
    ),
    status: node.status ?? "idle",
    specArtifactIds: Array.isArray(node.specArtifactIds) ? node.specArtifactIds : [],
    skillArtifactIds: Array.isArray(node.skillArtifactIds) ? node.skillArtifactIds : [],
    scriptArtifactIds: Array.isArray(node.scriptArtifactIds) ? node.scriptArtifactIds : [],
    capabilityIds: Array.isArray(node.capabilityIds) ? node.capabilityIds : [],
  };
}

function normalizeSpecArtifact(artifact: Partial<SpecArtifact> & Pick<SpecArtifact, "id" | "title" | "content" | "contentHash" | "sourceTemplateId" | "compiledFrom" | "createdAt" | "updatedAt">): SpecArtifact {
  return {
    ...artifact,
    specType: artifact.specType ?? "requirement",
    kind: artifact.kind ?? "spec",
    artifactType: artifact.artifactType ?? "report",
    ownerType: artifact.ownerType ?? "system",
    compileStatus: artifact.compileStatus ?? "not-applicable",
    compiledFrom: Array.isArray(artifact.compiledFrom) ? artifact.compiledFrom : [],
  };
}

function normalizeBlueprint(blueprint: HarnessBlueprint | null, intake: RequirementIntake): HarnessBlueprint | null {
  if (!blueprint) {
    return null;
  }

  return {
    ...blueprint,
    agents: blueprint.agents.map((agent, index) => normalizeAgentNode(agent, intake, index, blueprint.agents.length)),
    specs: blueprint.specs.map((spec) => ({
      ...spec,
      compileStatus: spec.compileStatus ?? "pending",
      specArtifactIds: Array.isArray(spec.specArtifactIds) ? spec.specArtifactIds : [],
    })),
    capabilities: blueprint.capabilities.map((capability) => normalizeCapabilityNode(capability)),
    edges: blueprint.edges ?? [],
  };
}

function rowToHarness(row: HarnessRow, events: HarnessEvent[]): Harness {
  const intake = parseJson<RequirementIntake>(row.intake_json, {
    goal: "",
    mainModel: readLLMSettings(),
    auxiliaryModel: {
      ...readLLMSettings(),
      temperature: 0.1,
      maxTokens: 2048,
    },
    codingAgentModel: {
      ...readLLMSettings(),
      model: "qwen3-coder-plus",
    },
    capabilityPolicy: {
      allowGithubSearch: false,
      allowAutoGenerateSkill: false,
      allowAutoGenerateScript: false,
    },
  });
  const normalizedIntake: RequirementIntake = {
    goal: intake.goal ?? "",
    mainModel: normalizeModelConfig(intake.mainModel, {
      provider: "openai_compatible",
      model: "qwen3.6-plus",
      temperature: 0.2,
      maxTokens: 4096,
      baseURL: "https://coding.dashscope.aliyuncs.com/v1",
      credentialRef: readLLMSettings().credentialRef,
    }),
    auxiliaryModel: normalizeModelConfig(intake.auxiliaryModel, {
      provider: "openai_compatible",
      model: "qwen3.6-plus",
      temperature: 0.1,
      maxTokens: 2048,
      baseURL: "https://coding.dashscope.aliyuncs.com/v1",
      credentialRef: readLLMSettings().credentialRef,
    }),
    codingAgentModel: normalizeModelConfig(intake.codingAgentModel, {
      provider: "openai_compatible",
      model: "qwen3-coder-plus",
      temperature: 0.2,
      maxTokens: 4096,
      baseURL: "https://coding.dashscope.aliyuncs.com/v1",
      credentialRef: readLLMSettings().credentialRef,
    }),
    capabilityPolicy: normalizeCapabilityPolicy(intake.capabilityPolicy),
  };

  return {
    id: row.id,
    name: row.name,
    status: normalizeHarnessStatus(row.status),
    intake: normalizedIntake,
    blueprint: normalizeBlueprint(parseJson<HarnessBlueprint | null>(row.blueprint_json, null), normalizedIntake),
    specArtifacts: parseJson<SpecArtifact[]>(row.spec_artifacts_json, []).map((artifact) => normalizeSpecArtifact(artifact)),
    agentNodes: parseJson<AgentNode[]>(row.agent_nodes_json, []).map((agent, index, array) => normalizeAgentNode(agent, normalizedIntake, index, array.length)),
    capabilityNodes: parseJson<CapabilityNode[]>(row.capability_nodes_json, []).map((capability) => normalizeCapabilityNode(capability)),
    edges: parseJson(row.edges_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    events,
  };
}

export function saveHarness(harness: Harness): Harness {
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO harnesses (
      id, name, status, intake_json, blueprint_json,
      spec_artifacts_json, agent_nodes_json, capability_nodes_json, edges_json,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      status=excluded.status,
      intake_json=excluded.intake_json,
      blueprint_json=excluded.blueprint_json,
      spec_artifacts_json=excluded.spec_artifacts_json,
      agent_nodes_json=excluded.agent_nodes_json,
      capability_nodes_json=excluded.capability_nodes_json,
      edges_json=excluded.edges_json,
      updated_at=excluded.updated_at
  `,
  ).run(
    harness.id,
    harness.name,
    harness.status,
    JSON.stringify(harness.intake),
    harness.blueprint ? JSON.stringify(harness.blueprint) : null,
    JSON.stringify(harness.specArtifacts),
    JSON.stringify(harness.agentNodes),
    JSON.stringify(harness.capabilityNodes),
    JSON.stringify(harness.edges),
    harness.createdAt,
    harness.updatedAt,
  );

  return harness;
}

export function getHarnessById(harnessId: string): Harness | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `
      SELECT id, name, status, intake_json, blueprint_json, spec_artifacts_json,
             agent_nodes_json, capability_nodes_json, edges_json, created_at, updated_at
      FROM harnesses
      WHERE id = ?
    `,
    )
    .get(harnessId) as HarnessRow | undefined;

  if (!row) {
    return null;
  }

  return rowToHarness(row, listHarnessEvents(harnessId));
}

export function listHarnesses(): Harness[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `
      SELECT id, name, status, intake_json, blueprint_json, spec_artifacts_json,
             agent_nodes_json, capability_nodes_json, edges_json, created_at, updated_at
      FROM harnesses
      ORDER BY created_at DESC
    `,
    )
    .all() as unknown as HarnessRow[];

  return rows.map((row) => rowToHarness(row, listHarnessEvents(row.id)));
}

export function saveHarnessEvent(event: HarnessEvent): HarnessEvent {
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO harness_events (
      id, harness_id, channel, phase, kind, message, payload_json, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    event.id,
    event.harnessId,
    event.channel,
    event.phase,
    event.kind,
    event.message,
    JSON.stringify(event.payload),
    event.createdAt,
  );

  return event;
}

export function listHarnessEvents(harnessId: string): HarnessEvent[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `
      SELECT id, harness_id, channel, phase, kind, message, payload_json, created_at
      FROM harness_events
      WHERE harness_id = ?
      ORDER BY created_at ASC
    `,
    )
    .all(harnessId) as unknown as EventRow[];

  return rows.map((row) => ({
    id: row.id,
    harnessId: row.harness_id,
    channel: row.channel,
    phase: row.phase,
    kind: row.kind,
    message: row.message,
    payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
    createdAt: row.created_at,
  }));
}
