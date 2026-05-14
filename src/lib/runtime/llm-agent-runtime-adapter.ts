import Ajv from "ajv/dist/2020";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentNode,
  ArtifactReference,
  CapabilityNode,
  RunArtifact,
  RunPolicy,
  TaskInstance,
  AgentRuntimeDecision,
} from "shared/types";
import type { LLMAdapter } from "@/lib/llm/types";
import { renderRuntimeAgentPrompt } from "@/lib/runtime/runtime-agent-prompt";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = path.join(MODULE_DIR, "../../../shared/specs/runtime/agent-runtime.spec.json");
const SCHEMA_PATH = path.join(MODULE_DIR, "../../../shared/schemas/runtime-agent.schema.json");

const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(loadSchemaObject() as object);

export interface AgentRuntimeDecisionInput {
  taskInstance: TaskInstance;
  harness: import("shared/types").Harness;
  agent: AgentNode;
  upstreamArtifacts: RunArtifact[];
  availableCapabilities: CapabilityNode[];
  runPolicy: RunPolicy;
  outputContract?: unknown;
  artifactRefs?: ArtifactReference[];
  taskInstruction?: string;
}

export class AgentRuntimeLLMAdapter {
  constructor(private readonly llm: LLMAdapter) {}

  async decide(input: AgentRuntimeDecisionInput): Promise<AgentRuntimeDecision> {
    const prompt = renderRuntimeAgentPrompt({
      runtimeAgentSpecJson: loadSpec(),
      runtimeAgentSchemaJson: loadSchema(),
      taskInstanceJson: JSON.stringify(input.taskInstance, null, 2),
      agentSpecJson: JSON.stringify(buildAgentSummary(input.agent, input.outputContract), null, 2),
      outputContractJson: JSON.stringify(input.outputContract ?? null, null, 2),
      upstreamArtifactsJson: JSON.stringify(buildUpstreamArtifactSummary(input.upstreamArtifacts, input.artifactRefs ?? []), null, 2),
      availableCapabilitiesJson: JSON.stringify(buildCapabilitySummary(input.availableCapabilities), null, 2),
      runPolicyJson: JSON.stringify(input.runPolicy, null, 2),
      taskInstruction: input.taskInstance.instruction,
    });

    const response = await this.llm.generateJson({
      config: input.agent.model,
      systemPrompt: prompt,
      userPrompt: JSON.stringify(
        {
          harnessId: input.harness.id,
          taskInstanceId: input.taskInstance.id,
          agentId: input.agent.id,
          agentRole: input.agent.role,
          upstreamArtifactCount: input.upstreamArtifacts.length,
          capabilityCount: input.availableCapabilities.length,
        },
        null,
        2,
      ),
      schemaName: "AgentRuntimeDecision",
    });

    let parsed: AgentRuntimeDecision;
    try {
      parsed = JSON.parse(response.rawText) as AgentRuntimeDecision;
    } catch (error) {
      throw new Error(`Agent runtime decision returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!validate(parsed)) {
      throw new Error(`Agent runtime decision schema validation failed: ${(validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message || "invalid"}`).join("; ")}`);
    }
    const contractErrors = validateDecisionAgainstOutputContract(parsed, input.outputContract);
    if (contractErrors.length > 0) {
      throw new Error(`Agent runtime decision output contract validation failed: ${contractErrors.join("; ")}`);
    }
    return parsed;
  }
}

function loadSpec(): string {
  return fs.readFileSync(SPEC_PATH, "utf8");
}

function loadSchema(): string {
  return fs.readFileSync(SCHEMA_PATH, "utf8");
}

function loadSchemaObject(): object {
  return JSON.parse(loadSchema()) as object;
}

function buildAgentSummary(agent: AgentNode, outputContract: unknown): Record<string, unknown> {
  return {
    id: agent.id,
    label: agent.label,
    role: agent.role,
    agentKind: agent.agentKind,
    executionOrder: agent.executionOrder,
    model: agent.model,
    status: agent.status,
    capabilityIds: agent.capabilityIds,
    specArtifactIds: agent.specArtifactIds,
    skillArtifactIds: agent.skillArtifactIds,
    scriptArtifactIds: agent.scriptArtifactIds,
    outputContract,
  };
}

function buildUpstreamArtifactSummary(artifacts: RunArtifact[], refs: ArtifactReference[]): Array<Record<string, unknown>> {
  const referenceMap = new Map(refs.map((ref) => [ref.id, ref] as const));
  return artifacts.map((artifact) => ({
    id: artifact.id,
    type: artifact.type,
    title: artifact.title,
    summary: artifact.summary,
    nodeId: artifact.nodeId,
    contentText: artifact.contentText,
    reference: referenceMap.get(artifact.id) ?? null,
  }));
}

function buildCapabilitySummary(capabilities: CapabilityNode[]): Array<Record<string, unknown>> {
  return capabilities.map((capability) => ({
    id: capability.id,
    label: capability.label,
    summary: capability.summary,
    capabilityType: capability.capabilityType,
    source: capability.source,
    status: capability.status,
    registryKey: capability.registryKey ?? null,
    policyFlags: capability.policyFlags,
  }));
}

function validateDecisionAgainstOutputContract(decision: AgentRuntimeDecision, outputContract: unknown): string[] {
  if (!outputContract || typeof outputContract !== "object" || Array.isArray(outputContract)) {
    return ["compiled output contract is required"];
  }
  const contract = outputContract as { contentFields?: unknown; requiredFields?: unknown; role?: unknown };
  const contentJson = decision.agentOutputDraft.contentJson;
  const fields = Array.isArray(contract.contentFields) ? contract.contentFields.map((item) => String(item)) : [];
  const required = fields.length > 0 ? fields : Array.isArray(contract.requiredFields) ? contract.requiredFields.map((item) => String(item)) : [];
  const errors: string[] = [];
  for (const field of required) {
    if (!(field in contentJson)) {
      errors.push(`agentOutputDraft.contentJson is missing role output field ${field}`);
    }
  }
  for (const legacyField of ["nodeId", "status", "trace"]) {
    if (legacyField in contentJson) {
      errors.push(`agentOutputDraft.contentJson cannot use generic field ${legacyField}`);
    }
  }
  return errors;
}
