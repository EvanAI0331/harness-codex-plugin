import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  BlueprintHarnessNode,
  BlueprintSpec,
  CapabilityNode,
  CapabilityPolicy,
  HarnessBlueprint,
  HarnessEdge,
  PlannerAdapter,
  PlannerInput,
  PlannerPlanResult,
  PlannerProgressHooks,
  PlannerProgressUpdate,
  SpecArtifact,
  ModelConfig,
} from "shared/types";
import { makeId } from "@/lib/id";
import { hash16 } from "@/lib/specs/spec-hash";
import { nowIso } from "@/lib/time";
import type { LLMAdapter } from "@/lib/llm/types";
import { findAgencyAgentByRole, loadAgencyAgentCatalog, selectAgencyAgentsForGoal, selectAgencyExpertsForGoal } from "@/lib/agency-agents/catalog";
import plannerBlueprintSpec from "shared/specs/planner/blueprint.spec.json";
import { canonicalizeBlueprintPayload, validateBlueprintPayload } from "@/lib/planner/blueprint-schema";
import { PlannerGenerationError } from "@/lib/planner/errors";

interface PlannerSectionResult<T> {
  value: T;
  artifacts: SpecArtifact[];
  rawResponseArtifactId: string;
  rawResponseArtifactIds?: string[];
}

type DispatchSection = {
  summary: string;
  selectedPlanningAgentRole: string;
};

type ExpertRosterSection = {
  selectedExpertRoles: string[];
};

type FrameworkSection = {
  summary: string;
  harness: BlueprintHarnessNode;
};

type AgentsSection = {
  agents: HarnessBlueprint["agents"];
};

type SpecsSection = {
  specs: BlueprintSpec[];
};

type CapabilitiesSection = {
  capabilities: CapabilityNode[];
};

type EdgesSection = {
  edges: HarnessEdge[];
};

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_DIR = path.join(MODULE_DIR, "../../../shared/prompts");

type AgentKind = "dispatcher" | "expert" | "coding";

export class LLMPlannerAdapter implements PlannerAdapter {
  constructor(private readonly llm: LLMAdapter) {}

  async plan(input: PlannerInput, hooks?: PlannerProgressHooks): Promise<PlannerPlanResult> {
    const artifacts: SpecArtifact[] = [];

    const dispatch = await this.planDispatch(input, hooks);
    artifacts.push(...dispatch.artifacts);

    const framework = await this.planFramework(input, dispatch.value.selectedPlanningAgentRole, hooks);
    artifacts.push(...framework.artifacts);

    const agents = await this.planAgents(input, framework.value, dispatch.value.selectedPlanningAgentRole, hooks);
    artifacts.push(...agents.artifacts);

    // Keep planner LLM calls serialized to avoid provider concurrency throttling.
    const specs = await this.planSpecs(input, framework.value, agents.value.agents, dispatch.value.selectedPlanningAgentRole, hooks);
    artifacts.push(...specs.artifacts);

    const capabilities = await this.planCapabilities(input, framework.value, dispatch.value.selectedPlanningAgentRole, hooks);
    artifacts.push(...capabilities.artifacts);

    const edges = await this.planEdges(input, framework.value, agents.value.agents, dispatch.value.selectedPlanningAgentRole, hooks);
    artifacts.push(...edges.artifacts);

    const alignedCapabilities = capabilities.value.capabilities.map((capability) => ({
      ...capability,
      policyFlags: requirePolicyFlags(capability.policyFlags, input.capabilityPolicy, "capabilities", artifacts),
    }));

    const blueprintCandidate = {
      summary: framework.value.summary,
      harness: framework.value.harness,
      agents: agents.value.agents,
      specs: specs.value.specs,
      capabilities: alignedCapabilities,
      edges: edges.value.edges,
    };

    const canonicalBlueprint = canonicalizeBlueprintPayload(blueprintCandidate);
    const validation = validateBlueprintPayload(canonicalBlueprint);
    if (!validation.ok) {
      throw new PlannerGenerationError(`Planner blueprint schema validation failed: ${validation.errors.join("; ")}`, artifacts);
    }

    const blueprint = canonicalBlueprint as HarnessBlueprint;
    const blueprintArtifact = makeArtifact(
      "planner.blueprint",
      "Planner Blueprint",
      "planner",
      input.goal,
      JSON.stringify(blueprint, null, 2),
      "plan",
      [input.goal, "planner-multi-part"],
    );
    artifacts.push(blueprintArtifact);

    return {
      blueprint,
      artifacts,
      rawResponseArtifactId: capabilities.rawResponseArtifactId,
      rawResponseArtifactIds: [
        framework.rawResponseArtifactId,
        ...(agents.rawResponseArtifactIds ?? [agents.rawResponseArtifactId]),
        specs.rawResponseArtifactId,
        capabilities.rawResponseArtifactId,
        edges.rawResponseArtifactId,
      ],
    };
  }

  private async planDispatch(input: PlannerInput, hooks?: PlannerProgressHooks): Promise<PlannerSectionResult<DispatchSection>> {
    emitPlannerProgress(hooks, {
      segment: "dispatch",
      status: "started",
      inputRequirements: ["goal", "capability policy", "planning agent catalog"],
    });
    const prompt = renderSectionPrompt("planner.dispatch.prompt.md", {
      goal: input.goal,
      capability_policy_json: JSON.stringify(input.capabilityPolicy),
      agent_catalog_json: JSON.stringify(selectAgencyExpertsForGoal(input.goal), null, 2),
    });

    const llmResponse = await this.llm.generateJson({
      config: limitPlannerModel(input.mainModel, 1024),
      systemPrompt: prompt,
      userPrompt: JSON.stringify({ goal: input.goal }, null, 2),
      schemaName: "PlannerDispatch",
    });

    const rawArtifact = makePlannerRawArtifact("planner.dispatch", "Planner Dispatch Raw Response", input.goal, llmResponse, "dispatch");

    let section: DispatchSection;
    try {
      const parsed = parseSectionJsonObject("planner.dispatch", llmResponse.rawText, [rawArtifact]);
      const selectedPlanningAgentRole = requireSelectedPlanningAgentRole(parsed.selectedPlanningAgentRole, [rawArtifact]);
      const summary = requireString(parsed.summary, "/summary", [rawArtifact]);
      section = { summary, selectedPlanningAgentRole };
    } catch (error) {
      throw attachPlannerArtifacts(error, [rawArtifact]);
    }

    const sectionArtifact = makeArtifact(
      "planner.dispatch",
      "Planner Dispatch",
      "planner",
      input.goal,
      JSON.stringify(section, null, 2),
      "plan",
      [input.goal, llmResponse.model, "dispatch"],
    );

    emitPlannerProgress(hooks, {
      segment: "dispatch",
      status: "completed",
      summary: section.summary,
      selectedPlanningAgentRole: section.selectedPlanningAgentRole,
      artifactCount: 1,
    });

    return {
      value: section,
      artifacts: [makePromptArtifact("planner.dispatch.prompt.md", input.goal, prompt), rawArtifact, sectionArtifact],
      rawResponseArtifactId: rawArtifact.id,
    };
  }

  private async planFramework(
    input: PlannerInput,
    selectedPlanningAgentRole: string,
    hooks?: PlannerProgressHooks,
  ): Promise<PlannerSectionResult<FrameworkSection>> {
    emitPlannerProgress(hooks, {
      segment: "framework",
      status: "started",
      selectedPlanningAgentRole,
      inputRequirements: ["goal", "main model", "auxiliary model", "coding agent model", "capability policy", "agent catalog"],
    });
    const prompt = renderSectionPrompt("planner.framework.prompt.md", {
      goal: input.goal,
      main_model_json: JSON.stringify(input.mainModel),
      aux_model_json: JSON.stringify(input.auxiliaryModel),
      coding_model_json: JSON.stringify(input.codingAgentModel),
      capability_policy_json: JSON.stringify(input.capabilityPolicy),
      selected_planning_agent_role_json: JSON.stringify(selectedPlanningAgentRole),
      agent_catalog_json: JSON.stringify(selectAgencyAgentsForGoal(input.goal), null, 2),
    });

    const llmResponse = await this.llm.generateJson({
      config: limitPlannerModel(input.mainModel, 1500),
      systemPrompt: prompt,
      userPrompt: JSON.stringify({ goal: input.goal }, null, 2),
      schemaName: "PlannerFramework",
    });

    const rawArtifact = makePlannerRawArtifact("planner.framework", "Planner Framework Raw Response", input.goal, llmResponse, "framework");

    let section: FrameworkSection;
    try {
      const parsed = parseSectionJsonObject("planner.framework", llmResponse.rawText, [rawArtifact]);
      const summary = requireString(parsed.summary, "/summary", [rawArtifact]);
      const harness = requireHarnessNode(parsed.harness, [rawArtifact]);
      section = { summary, harness };
    } catch (error) {
      throw attachPlannerArtifacts(error, [rawArtifact]);
    }

    const sectionArtifact = makeArtifact(
      "planner.overview",
      "Planner Framework",
      "planner",
      input.goal,
      JSON.stringify(section, null, 2),
      "plan",
      [input.goal, llmResponse.model, "framework"],
    );

    emitPlannerProgress(hooks, {
      segment: "framework",
      status: "completed",
      summary: section.summary,
      selectedPlanningAgentRole,
      artifactCount: 1,
    });

    return {
      value: section,
      artifacts: [makePromptArtifact("planner.framework.prompt.md", input.goal, prompt), makeSchemaArtifact(input.goal), rawArtifact, sectionArtifact],
      rawResponseArtifactId: rawArtifact.id,
    };
  }

  private async planAgents(
    input: PlannerInput,
    framework: FrameworkSection,
    selectedPlanningAgentRole: string,
    hooks?: PlannerProgressHooks,
  ): Promise<PlannerSectionResult<AgentsSection>> {
    const roster = await this.planExpertRoster(input, framework, selectedPlanningAgentRole, hooks);
    const dispatcherCatalog = loadAgencyAgentCatalog().find((entry) => entry.dispatcher);
    if (!dispatcherCatalog) {
      throw new PlannerGenerationError("Planner dispatch must resolve a dispatcher catalog entry.", roster.artifacts);
    }

    const expertRoles = roster.value.selectedExpertRoles;
    const selectedEntries = [
      dispatcherCatalog,
      findAgencyAgentByRole(selectedPlanningAgentRole) ?? null,
      ...expertRoles.map((role) => findAgencyAgentByRole(role) ?? null),
    ];
    if (selectedEntries[1] == null) {
      throw new PlannerGenerationError(`Planner planning agent role ${selectedPlanningAgentRole} must exist in the agency-agents catalog.`, roster.artifacts);
    }
    const missingExpertRole = expertRoles.find((role) => !findAgencyAgentByRole(role));
    if (missingExpertRole) {
      throw new PlannerGenerationError(`Planner expert role ${missingExpertRole} must exist in the agency-agents catalog.`, roster.artifacts);
    }

    const agents = selectedEntries.map((entry, index) => {
      if (!entry) {
        throw new PlannerGenerationError(`Planner agent roster/${index} is missing a catalog entry.`, roster.artifacts);
      }
      return materializeAgentNodeFromCatalog(entry, index + 1, input);
    });
    const section = { agents };

    const sectionArtifact = makeArtifact(
      "planner.agents",
      "Planner Agents",
      "planner",
      input.goal,
      JSON.stringify(section, null, 2),
      "plan",
      [input.goal, "planner-agent-parts", "agents"],
    );

    return {
      value: section,
      artifacts: [...roster.artifacts, sectionArtifact],
      rawResponseArtifactId: roster.rawResponseArtifactId,
      rawResponseArtifactIds: [roster.rawResponseArtifactId],
    };
  }

  private async planExpertRoster(
    input: PlannerInput,
    framework: FrameworkSection,
    selectedPlanningAgentRole: string,
    hooks?: PlannerProgressHooks,
  ): Promise<PlannerSectionResult<ExpertRosterSection>> {
    emitPlannerProgress(hooks, {
      segment: "experts",
      status: "started",
      selectedPlanningAgentRole,
      inputRequirements: ["goal", "framework", "expert catalog", "planning agent role"],
    });
    const prompt = renderSectionPrompt("planner.experts.prompt.md", {
      goal: input.goal,
      framework_json: JSON.stringify(framework),
      main_model_json: JSON.stringify(input.mainModel),
      aux_model_json: JSON.stringify(input.auxiliaryModel),
      capability_policy_json: JSON.stringify(input.capabilityPolicy),
      selected_planning_agent_role_json: JSON.stringify(selectedPlanningAgentRole),
      agent_catalog_json: JSON.stringify(selectAgencyExpertsForGoal(input.goal), null, 2),
    });

    const llmResponse = await this.llm.generateJson({
      config: limitPlannerModel(input.mainModel, 1024),
      systemPrompt: prompt,
      userPrompt: JSON.stringify({ goal: input.goal, framework }, null, 2),
      schemaName: "PlannerExpertRoster",
    });

    const rawArtifact = makePlannerRawArtifact("planner.experts", "Planner Expert Roster Raw Response", input.goal, llmResponse, "agents");

    let section: ExpertRosterSection;
    try {
      const parsed = parseSectionJsonObject("planner.experts", llmResponse.rawText, [rawArtifact]);
      const selectedExpertRoles = requireSelectedExpertRoles(parsed.selectedExpertRoles, selectedPlanningAgentRole, [rawArtifact]);
      section = { selectedExpertRoles };
    } catch (error) {
      throw attachPlannerArtifacts(error, [rawArtifact]);
    }

    const sectionArtifact = makeArtifact(
      "planner.agents",
      "Planner Expert Roster",
      "planner",
      input.goal,
      JSON.stringify(section, null, 2),
      "plan",
      [input.goal, llmResponse.model, "agents-roster"],
    );

    emitPlannerProgress(hooks, {
      segment: "experts",
      status: "completed",
      summary: `Selected ${section.selectedExpertRoles.length} experts.`,
      selectedPlanningAgentRole,
      artifactCount: 1,
    });

    return {
      value: section,
      artifacts: [makePromptArtifact("planner.experts.prompt.md", input.goal, prompt), rawArtifact, sectionArtifact],
      rawResponseArtifactId: rawArtifact.id,
    };
  }
  private async planSpecs(
    input: PlannerInput,
    framework: FrameworkSection,
    agents: HarnessBlueprint["agents"],
    selectedPlanningAgentRole: string,
    hooks?: PlannerProgressHooks,
  ): Promise<PlannerSectionResult<SpecsSection>> {
    emitPlannerProgress(hooks, {
      segment: "specs",
      status: "started",
      selectedPlanningAgentRole,
      inputRequirements: ["framework", "agent roster", "canonical agent ids"],
    });
    const prompt = renderSectionPrompt("planner.specs.prompt.md", {
      goal: input.goal,
      framework_json: JSON.stringify(framework),
      agents_json: JSON.stringify(agents),
      selected_planning_agent_role_json: JSON.stringify(selectedPlanningAgentRole),
      canonical_agent_ids_json: JSON.stringify(agents.map((agent) => agent.id)),
      agent_catalog_json: JSON.stringify(selectAgencyAgentsForGoal(input.goal), null, 2),
    });

    const llmResponse = await this.llm.generateJson({
      config: limitPlannerModel(input.mainModel, 1536),
      systemPrompt: prompt,
      userPrompt: JSON.stringify({ goal: input.goal, framework }, null, 2),
      schemaName: "PlannerSpecs",
    });

    const rawArtifact = makePlannerRawArtifact("planner.specs", "Planner Specs Raw Response", input.goal, llmResponse, "specs");

    let section: SpecsSection;
    try {
      const parsed = parseSectionJsonObject("planner.specs", llmResponse.rawText, [rawArtifact]);
      const specs = requireSpecsArray(parsed.specs, agents, [rawArtifact]);
      section = { specs };
    } catch (error) {
      throw attachPlannerArtifacts(error, [rawArtifact]);
    }

    const sectionArtifact = makeArtifact(
      "planner.specs",
      "Planner Specs",
      "planner",
      input.goal,
      JSON.stringify(section, null, 2),
      "plan",
      [input.goal, llmResponse.model, "specs"],
    );

    emitPlannerProgress(hooks, {
      segment: "specs",
      status: "completed",
      summary: `Planned ${section.specs.length} specs.`,
      selectedPlanningAgentRole,
      artifactCount: 1,
    });

    return {
      value: section,
      artifacts: [makePromptArtifact("planner.specs.prompt.md", input.goal, prompt), rawArtifact, sectionArtifact],
      rawResponseArtifactId: rawArtifact.id,
    };
  }

  private async planCapabilities(
    input: PlannerInput,
    framework: FrameworkSection,
    selectedPlanningAgentRole: string,
    hooks?: PlannerProgressHooks,
  ): Promise<PlannerSectionResult<CapabilitiesSection>> {
    emitPlannerProgress(hooks, {
      segment: "capabilities",
      status: "started",
      selectedPlanningAgentRole,
      inputRequirements: ["framework", "capability policy"],
    });
    const prompt = renderSectionPrompt("planner.capabilities.prompt.md", {
      goal: input.goal,
      framework_json: JSON.stringify(framework),
      capability_policy_json: JSON.stringify(input.capabilityPolicy),
      selected_planning_agent_role_json: JSON.stringify(selectedPlanningAgentRole),
    });

    const llmResponse = await this.llm.generateJson({
      config: limitPlannerModel(input.mainModel, 1500),
      systemPrompt: prompt,
      userPrompt: JSON.stringify({ goal: input.goal, framework, capabilityPolicy: input.capabilityPolicy }, null, 2),
      schemaName: "PlannerCapabilities",
    });

    const rawArtifact = makePlannerRawArtifact(
      "planner.capabilities",
      "Planner Capabilities Raw Response",
      input.goal,
      llmResponse,
      "capabilities",
    );

    let section: CapabilitiesSection;
    try {
      const parsed = parseSectionJsonObject("planner.capabilities", llmResponse.rawText, [rawArtifact]);
      const capabilities = requireCapabilitiesArray(parsed.capabilities, input.capabilityPolicy, [rawArtifact]);
      section = { capabilities };
    } catch (error) {
      throw attachPlannerArtifacts(error, [rawArtifact]);
    }

    const sectionArtifact = makeArtifact(
      "planner.capabilities",
      "Planner Capabilities",
      "planner",
      input.goal,
      JSON.stringify(section, null, 2),
      "plan",
      [input.goal, llmResponse.model, "capabilities"],
    );

    emitPlannerProgress(hooks, {
      segment: "capabilities",
      status: "completed",
      summary: `Planned ${section.capabilities.length} capabilities.`,
      selectedPlanningAgentRole,
      artifactCount: 1,
    });

    return {
      value: section,
      artifacts: [makePromptArtifact("planner.capabilities.prompt.md", input.goal, prompt), rawArtifact, sectionArtifact],
      rawResponseArtifactId: rawArtifact.id,
    };
  }

  private async planEdges(
    input: PlannerInput,
    framework: FrameworkSection,
    agents: HarnessBlueprint["agents"],
    selectedPlanningAgentRole: string,
    hooks?: PlannerProgressHooks,
  ): Promise<PlannerSectionResult<EdgesSection>> {
    emitPlannerProgress(hooks, {
      segment: "edges",
      status: "started",
      selectedPlanningAgentRole,
      inputRequirements: ["framework", "agents", "canonical node ids"],
    });
    const prompt = renderSectionPrompt("planner.edges.prompt.md", {
      goal: input.goal,
      framework_json: JSON.stringify(framework),
      agents_json: JSON.stringify(agents),
      selected_planning_agent_role_json: JSON.stringify(selectedPlanningAgentRole),
      canonical_agent_ids_json: JSON.stringify([framework.harness.id, ...agents.map((agent) => agent.id)]),
    });

    const llmResponse = await this.llm.generateJson({
      config: limitPlannerModel(input.mainModel, 1500),
      systemPrompt: prompt,
      userPrompt: JSON.stringify({ goal: input.goal, framework }, null, 2),
      schemaName: "PlannerEdges",
    });

    const rawArtifact = makePlannerRawArtifact("planner.edges", "Planner Edges Raw Response", input.goal, llmResponse, "edges");

    let section: EdgesSection;
    try {
      const parsed = parseSectionJsonObject("planner.edges", llmResponse.rawText, [rawArtifact]);
      const edges = requireEdgesArray(parsed.edges, [framework.harness.id, ...agents.map((agent) => agent.id)], [rawArtifact]);
      section = { edges };
    } catch (error) {
      throw attachPlannerArtifacts(error, [rawArtifact]);
    }

    const sectionArtifact = makeArtifact(
      "planner.edges",
      "Planner Edges",
      "planner",
      input.goal,
      JSON.stringify(section, null, 2),
      "plan",
      [input.goal, llmResponse.model, "edges"],
    );

    emitPlannerProgress(hooks, {
      segment: "edges",
      status: "completed",
      summary: `Planned ${section.edges.length} edges.`,
      selectedPlanningAgentRole,
      artifactCount: 1,
    });

    return {
      value: section,
      artifacts: [makePromptArtifact("planner.edges.prompt.md", input.goal, prompt), rawArtifact, sectionArtifact],
      rawResponseArtifactId: rawArtifact.id,
    };
  }
}

function renderSectionPrompt(filename: string, replacements: Record<string, string>): string {
  let template = fs.readFileSync(path.join(PROMPT_DIR, filename), "utf8");
  for (const [needle, value] of Object.entries(replacements)) {
    template = template.replaceAll(`{{${needle}}}`, value);
  }
  return template;
}

function limitPlannerModel(config: ModelConfig, maxTokens: number): ModelConfig {
  return {
    ...config,
    maxTokens: Math.min(config.maxTokens, maxTokens),
  };
}

function emitPlannerProgress(hooks: PlannerProgressHooks | undefined, update: PlannerProgressUpdate): void {
  hooks?.onProgress?.(update);
}

function parseSectionJsonObject(sectionName: string, text: string, artifacts: SpecArtifact[]): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("response was not a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new PlannerGenerationError(
      `Planner ${sectionName} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      artifacts,
    );
  }
}

function requireString(value: unknown, pathLabel: string, artifacts: SpecArtifact[]): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PlannerGenerationError(`Planner section is missing ${pathLabel}.`, artifacts);
  }
  return value.trim();
}

function requireHarnessNode(value: unknown, artifacts: SpecArtifact[]): BlueprintHarnessNode {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PlannerGenerationError("Planner section is missing harness.", artifacts);
  }
  const record = value as Record<string, unknown>;
  return {
    id: requireString(record.id, "/harness.id", artifacts),
    nodeType: "harness",
    label: requireString(record.label, "/harness.label", artifacts),
    summary: requireString(record.summary, "/harness.summary", artifacts),
    status: requireHarnessStatus(record.status, artifacts),
  };
}

function requireAgentsArray(
  value: unknown,
  mainModel: ModelConfig,
  selectedPlanningAgentRole: string,
  artifacts: SpecArtifact[],
): HarnessBlueprint["agents"] {
  if (!Array.isArray(value)) {
    throw new PlannerGenerationError("Planner section is missing agents.", artifacts);
  }
  if (value.length < 2) {
    throw new PlannerGenerationError("Planner agents must contain the dispatcher and at least one selected expert.", artifacts);
  }

  const agents = value.map((item, index) => requireAgentNode(item, index, mainModel, artifacts));
  agents.sort((left, right) => {
    if (left.executionOrder !== right.executionOrder) {
      return left.executionOrder - right.executionOrder;
    }
    return left.id.localeCompare(right.id);
  });
  validateAgentSequence(agents, selectedPlanningAgentRole, artifacts);
  return agents;
}

function requireSelectedPlanningAgentRole(value: unknown, artifacts: SpecArtifact[]): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PlannerGenerationError("Planner dispatch must include selectedPlanningAgentRole.", artifacts);
  }
  const role = value.trim();
  const catalog = findAgencyAgentByRole(role);
  if (!catalog) {
    throw new PlannerGenerationError("Planner dispatch selectedPlanningAgentRole must exist in the agency-agents catalog.", artifacts);
  }
  if (catalog.dispatcher) {
    throw new PlannerGenerationError("Planner dispatch selectedPlanningAgentRole cannot select the dispatcher.", artifacts);
  }
  return role;
}

function requireSelectedExpertRoles(value: unknown, selectedPlanningAgentRole: string, artifacts: SpecArtifact[]): string[] {
  if (!Array.isArray(value)) {
    throw new PlannerGenerationError("Planner expert roster must include selectedExpertRoles.", artifacts);
  }
  if (value.length === 0) {
    throw new PlannerGenerationError("Planner expert roster must select at least one expert role.", artifacts);
  }

  const selectedRoles = value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new PlannerGenerationError(`Planner expert roster selectedExpertRoles/${index} must be a non-empty string.`, artifacts);
    }
    const role = item.trim();
    const catalog = findAgencyAgentByRole(role);
    if (!catalog) {
      throw new PlannerGenerationError(`Planner expert roster selectedExpertRoles/${index} must exist in the agency-agents catalog.`, artifacts);
    }
    if (catalog.dispatcher) {
      throw new PlannerGenerationError(`Planner expert roster selectedExpertRoles/${index} cannot select the dispatcher.`, artifacts);
    }
    if (role === selectedPlanningAgentRole) {
      throw new PlannerGenerationError(`Planner expert roster selectedExpertRoles/${index} cannot select the planning agent itself.`, artifacts);
    }
    return role;
  });

  return Array.from(new Set(selectedRoles));
}

function requireAgentNode(
  value: unknown,
  index: number,
  mainModel: ModelConfig,
  artifacts: SpecArtifact[],
): HarnessBlueprint["agents"][number] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PlannerGenerationError(`Planner agents/${index} must be an object.`, artifacts);
  }
  const record = value as Record<string, unknown>;
  const role = requireCatalogRole(requireString(record.role, `/agents/${index}.role`, artifacts), index, artifacts);
  const agentKind = requireAgentKind(record.agentKind, `/agents/${index}.agentKind`, artifacts);
  const executionOrder = requireExecutionOrder(record.executionOrder, `/agents/${index}.executionOrder`, artifacts);
  const catalogGroup = requireCatalogGroup(requireString(record.catalogGroup, `/agents/${index}.catalogGroup`, artifacts), role, index, artifacts);
  const model = requireExactModelConfig(record.model, `/agents/${index}.model`, artifacts);
  requireExpectedModel(model, agentKind, catalogGroup, mainModel, artifacts, index);
  return {
    id: requireString(record.id, `/agents/${index}.id`, artifacts),
    nodeType: "agent",
    label: requireString(record.label, `/agents/${index}.label`, artifacts),
    role,
    agentKind,
    executionOrder,
    catalogGroup,
    model,
    status: requireAgentStatus(record.status, `/agents/${index}.status`, artifacts),
    specArtifactIds: requireStringArray(record.specArtifactIds, `/agents/${index}.specArtifactIds`, artifacts),
    skillArtifactIds: requireStringArray(record.skillArtifactIds, `/agents/${index}.skillArtifactIds`, artifacts),
    scriptArtifactIds: requireStringArray(record.scriptArtifactIds, `/agents/${index}.scriptArtifactIds`, artifacts),
    capabilityIds: requireStringArray(record.capabilityIds, `/agents/${index}.capabilityIds`, artifacts),
    createdAt: requireString(record.createdAt, `/agents/${index}.createdAt`, artifacts),
    updatedAt: requireString(record.updatedAt, `/agents/${index}.updatedAt`, artifacts),
  };
}

function requireSpecsArray(value: unknown, agents: HarnessBlueprint["agents"], artifacts: SpecArtifact[]): BlueprintSpec[] {
  if (!Array.isArray(value)) {
    throw new PlannerGenerationError("Planner section is missing specs.", artifacts);
  }
  if (value.length !== agents.length) {
    throw new PlannerGenerationError("Planner specs must mirror the planner agent execution order one-to-one.", artifacts);
  }
  return value.map((item, index) => requireSpecNode(item, index, agents, artifacts));
}

function requireSpecNode(value: unknown, index: number, agents: HarnessBlueprint["agents"], artifacts: SpecArtifact[]): BlueprintSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PlannerGenerationError(`Planner specs/${index} must be an object.`, artifacts);
  }
  const record = value as Record<string, unknown>;
  const agent = agents[index];
  if (!agent) {
    throw new PlannerGenerationError(`Planner specs/${index} must map to an agent.`, artifacts);
  }
  const agentId = requireString(record.agentId, `/specs/${index}.agentId`, artifacts);
  if (agentId !== agent.id) {
    throw new PlannerGenerationError(`Planner specs/${index}.agentId must match /agents/${index}.id.`, artifacts);
  }
  return {
    id: requireString(record.id, `/specs/${index}.id`, artifacts),
    nodeType: "spec",
    specType: "agent",
    agentId,
    title: requireString(record.title, `/specs/${index}.title`, artifacts),
    summary: requireString(record.summary, `/specs/${index}.summary`, artifacts),
    artifactId: requireString(record.artifactId, `/specs/${index}.artifactId`, artifacts),
    specArtifactIds: requireStringArray(record.specArtifactIds, `/specs/${index}.specArtifactIds`, artifacts),
    compileStatus: requireCompileStatus(record.compileStatus, `/specs/${index}.compileStatus`, artifacts),
    compiledPath: requireOptionalString(record.compiledPath, `/specs/${index}.compiledPath`, artifacts),
    stdout: requireOptionalString(record.stdout, `/specs/${index}.stdout`, artifacts),
    stderr: requireOptionalString(record.stderr, `/specs/${index}.stderr`, artifacts),
  };
}

function requireCapabilitiesArray(value: unknown, policy: CapabilityPolicy, artifacts: SpecArtifact[]): CapabilityNode[] {
  if (!Array.isArray(value)) {
    throw new PlannerGenerationError("Planner section is missing capabilities.", artifacts);
  }
  return value.map((item, index) => requireCapabilityNode(item, index, policy, artifacts));
}

function requireCapabilityNode(
  value: unknown,
  index: number,
  policy: CapabilityPolicy,
  artifacts: SpecArtifact[],
): CapabilityNode {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PlannerGenerationError(`Planner capabilities/${index} must be an object.`, artifacts);
  }
  const record = value as Record<string, unknown>;
  return {
    id: requireString(record.id, `/capabilities/${index}.id`, artifacts),
    nodeType: "capability",
    label: requireString(record.label, `/capabilities/${index}.label`, artifacts),
    summary: requireString(record.summary, `/capabilities/${index}.summary`, artifacts),
    capabilityType: requireCapabilityKind(record.capabilityType, `/capabilities/${index}.capabilityType`, artifacts),
    source: requireCapabilitySource(record.source, `/capabilities/${index}.source`, artifacts),
    status: requireCapabilityStatus(record.status, `/capabilities/${index}.status`, artifacts),
    specArtifactIds: requireStringArray(record.specArtifactIds, `/capabilities/${index}.specArtifactIds`, artifacts),
    policyFlags: requirePolicyFlags(record.policyFlags, policy, `/capabilities/${index}.policyFlags`, artifacts),
    registryKey: requireOptionalString(record.registryKey, `/capabilities/${index}.registryKey`, artifacts),
    resolutionReason: requireOptionalString(record.resolutionReason, `/capabilities/${index}.resolutionReason`, artifacts),
    resolverName: requireOptionalString(record.resolverName, `/capabilities/${index}.resolverName`, artifacts),
    createdAt: requireString(record.createdAt, `/capabilities/${index}.createdAt`, artifacts),
    updatedAt: requireString(record.updatedAt, `/capabilities/${index}.updatedAt`, artifacts),
  };
}

function requireEdgesArray(value: unknown, allowedNodeIds: string[], artifacts: SpecArtifact[]): HarnessEdge[] {
  if (!Array.isArray(value)) {
    throw new PlannerGenerationError("Planner section is missing edges.", artifacts);
  }
  return value.map((item, index) => requireEdgeNode(item, index, allowedNodeIds, artifacts));
}

function requireEdgeNode(value: unknown, index: number, allowedNodeIds: string[], artifacts: SpecArtifact[]): HarnessEdge {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PlannerGenerationError(`Planner edges/${index} must be an object.`, artifacts);
  }
  const record = value as Record<string, unknown>;
  const source = requireString(record.source, `/edges/${index}.source`, artifacts);
  const target = requireString(record.target, `/edges/${index}.target`, artifacts);
  if (!allowedNodeIds.includes(source)) {
    throw new PlannerGenerationError(`Planner edges/${index}.source must reference a known node id.`, artifacts);
  }
  if (!allowedNodeIds.includes(target)) {
    throw new PlannerGenerationError(`Planner edges/${index}.target must reference a known node id.`, artifacts);
  }
  return {
    id: requireString(record.id, `/edges/${index}.id`, artifacts),
    source,
    target,
    relation: requireAllowedEdgeRelation(requireString(record.relation, `/edges/${index}.relation`, artifacts), index, artifacts),
    label: typeof record.label === "string" ? record.label : undefined,
  };
}

function requireModelConfig(value: unknown, pathLabel: string, artifacts: SpecArtifact[]): ModelConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PlannerGenerationError(`Planner ${pathLabel} must be an object.`, artifacts);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.provider !== "string" || typeof record.model !== "string") {
    throw new PlannerGenerationError(`Planner ${pathLabel} is missing provider or model.`, artifacts);
  }
  if (typeof record.temperature !== "number" || typeof record.maxTokens !== "number") {
    throw new PlannerGenerationError(`Planner ${pathLabel} is missing temperature or maxTokens.`, artifacts);
  }
  return {
    provider: record.provider,
    model: record.model,
    baseURL: typeof record.baseURL === "string" ? record.baseURL : undefined,
    credentialRef: typeof record.credentialRef === "string" ? record.credentialRef : undefined,
    temperature: record.temperature,
    maxTokens: record.maxTokens,
  };
}

function requireCatalogRole(value: string, index: number, artifacts: SpecArtifact[]): string {
  const catalog = findAgencyAgentByRole(value);
  if (!catalog) {
    throw new PlannerGenerationError(`Planner /agents/${index}.role must exist in the agency-agents catalog.`, artifacts);
  }
  return value;
}

function requireCatalogGroup(value: string, role: string, index: number, artifacts: SpecArtifact[]): string {
  const catalog = findAgencyAgentByRole(role);
  if (!catalog) {
    throw new PlannerGenerationError(`Planner /agents/${index}.role must exist in the agency-agents catalog.`, artifacts);
  }
  if (catalog.group !== value) {
    throw new PlannerGenerationError(`Planner /agents/${index}.catalogGroup must match the agency-agents catalog for ${role}.`, artifacts);
  }
  return value;
}

function requireAgentKind(value: unknown, pathLabel: string, artifacts: SpecArtifact[]): AgentKind {
  if (value === "dispatcher" || value === "expert" || value === "coding") {
    return value;
  }
  throw new PlannerGenerationError(`Planner ${pathLabel} must be dispatcher, expert, or coding.`, artifacts);
}

function requireExecutionOrder(value: unknown, pathLabel: string, artifacts: SpecArtifact[]): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new PlannerGenerationError(`Planner ${pathLabel} must be a non-negative integer.`, artifacts);
  }
  return value;
}

function requireExactModelConfig(value: unknown, pathLabel: string, artifacts: SpecArtifact[]): ModelConfig {
  return requireModelConfig(value, pathLabel, artifacts);
}

function materializeAgentNodeFromCatalog(
  catalogEntry: NonNullable<ReturnType<typeof findAgencyAgentByRole>>,
  executionOrder: number,
  input: PlannerInput,
): HarnessBlueprint["agents"][number] {
  const createdAt = nowIso();
  const agentKind: AgentKind = catalogEntry.dispatcher ? "dispatcher" : "expert";
  const agent = {
    id: normalizeAgentId(catalogEntry.role),
    nodeType: "agent" as const,
    label: catalogEntry.name,
    role: catalogEntry.role,
    agentKind,
    executionOrder,
    catalogGroup: catalogEntry.group,
    model: input.mainModel,
    status: "idle" as const,
    specArtifactIds: [],
    skillArtifactIds: [],
    scriptArtifactIds: [],
    capabilityIds: [],
    createdAt,
    updatedAt: createdAt,
  };
  return agent;
}

function normalizeAgentId(role: string): string {
  return `agent-${role.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase()}`;
}

function requireExpectedModel(
  value: ModelConfig,
  agentKind: AgentKind,
  catalogGroup: string,
  mainModel: ModelConfig,
  artifacts: SpecArtifact[],
  index: number,
): void {
  if (agentKind === "dispatcher") {
    if (!modelConfigsMatch(value, mainModel)) {
      throw new PlannerGenerationError(`Planner /agents/${index}.model must match the main model source for dispatcher agents.`, artifacts);
    }
    return;
  }
  if (agentKind === "coding") {
    return;
  }
  if (catalogGroup === "engineering") {
    if (!modelConfigsMatch(value, mainModel)) {
      throw new PlannerGenerationError(`Planner /agents/${index}.model must remain the main model in the planner output.`, artifacts);
    }
    return;
  }
  if (!modelConfigsMatch(value, mainModel)) {
    throw new PlannerGenerationError(`Planner /agents/${index}.model must match the main model source for expert agents.`, artifacts);
  }
}

function validateAgentSequence(agents: HarnessBlueprint["agents"], selectedPlanningAgentRole: string, artifacts: SpecArtifact[]): void {
  if (agents.length < 2) {
    throw new PlannerGenerationError("Planner agents must contain a dispatcher and at least one expert.", artifacts);
  }

  const dispatcher = agents[0];
  if (dispatcher.agentKind !== "dispatcher") {
    throw new PlannerGenerationError("Planner agents[0].agentKind must be dispatcher.", artifacts);
  }

  const dispatcherCatalog = findAgencyAgentByRole(dispatcher.role);
  if (!dispatcherCatalog?.dispatcher) {
    throw new PlannerGenerationError("Planner dispatcher must resolve to the dispatcher entry in the agency-agents catalog.", artifacts);
  }

  if (agents[1].role !== selectedPlanningAgentRole) {
    throw new PlannerGenerationError("Planner agents[1].role must match the dispatcher-selected planning agent role.", artifacts);
  }
  const expertRoleSet = new Set<string>();
  const executionOrders = new Set<number>();
  for (let index = 1; index < agents.length; index += 1) {
    const agent = agents[index];
    if (agent.agentKind !== "expert" && agent.agentKind !== "coding") {
      throw new PlannerGenerationError(`Planner agents[${index}].agentKind must be expert or coding.`, artifacts);
    }
    if (agent.role === selectedPlanningAgentRole) {
      throw new PlannerGenerationError(`Planner agents[${index}].role cannot duplicate the planning agent role.`, artifacts);
    }
    if (findAgencyAgentByRole(agent.role)?.dispatcher) {
      throw new PlannerGenerationError(`Planner agents[${index}].role cannot reuse the dispatcher catalog entry.`, artifacts);
    }
    if (expertRoleSet.has(agent.role)) {
      throw new PlannerGenerationError(`Planner agents[${index}].role must be unique across expert agents.`, artifacts);
    }
    expertRoleSet.add(agent.role);
  }

  for (const agent of agents) {
    if (executionOrders.has(agent.executionOrder)) {
      throw new PlannerGenerationError("Planner agent executionOrder values must be unique.", artifacts);
    }
    executionOrders.add(agent.executionOrder);
  }

  const sortedOrders = Array.from(executionOrders).sort((left, right) => left - right);
  for (let index = 1; index < sortedOrders.length; index += 1) {
    if (sortedOrders[index] <= sortedOrders[index - 1]) {
      throw new PlannerGenerationError("Planner agent executionOrder values must be strictly increasing.", artifacts);
    }
  }
}

function modelConfigsMatch(left: ModelConfig, right: ModelConfig): boolean {
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    left.baseURL === right.baseURL &&
    left.credentialRef === right.credentialRef &&
    left.temperature === right.temperature &&
    left.maxTokens === right.maxTokens
  );
}

function requireAllowedEdgeRelation(value: string, index: number, artifacts: SpecArtifact[]): HarnessEdge["relation"] {
  const allowed = ["contains", "defines", "delegates_to", "feeds", "depends_on", "requires", "missing"] as const;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new PlannerGenerationError(`Planner /edges/${index}.relation must be one of ${allowed.join(", ")}.`, artifacts);
  }
  return value as HarnessEdge["relation"];
}

function requireStringArray(value: unknown, pathLabel: string, artifacts: SpecArtifact[]): string[] {
  if (!Array.isArray(value)) {
    throw new PlannerGenerationError(`Planner ${pathLabel} must be an array.`, artifacts);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new PlannerGenerationError(`Planner ${pathLabel}/${index} must be a non-empty string.`, artifacts);
    }
    return item.trim();
  });
}

function requireOptionalString(value: unknown, pathLabel: string, artifacts: SpecArtifact[]): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new PlannerGenerationError(`Planner ${pathLabel} must be a string when provided.`, artifacts);
  }
  return value;
}

function requirePolicyFlags(value: unknown, fallback: CapabilityPolicy, pathLabel: string, artifacts: SpecArtifact[]): CapabilityPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PlannerGenerationError(`Planner ${pathLabel} must be an object.`, artifacts);
  }
  const record = value as Record<string, unknown>;
  const flags = {
    allowGithubSearch: record.allowGithubSearch,
    allowAutoGenerateSkill: record.allowAutoGenerateSkill,
    allowAutoGenerateScript: record.allowAutoGenerateScript,
  };
  if (typeof flags.allowGithubSearch !== "boolean" || typeof flags.allowAutoGenerateSkill !== "boolean" || typeof flags.allowAutoGenerateScript !== "boolean") {
    throw new PlannerGenerationError(`Planner ${pathLabel} must contain boolean allowGithubSearch, allowAutoGenerateSkill, and allowAutoGenerateScript.`, artifacts);
  }
  const parsed = {
    allowGithubSearch: flags.allowGithubSearch,
    allowAutoGenerateSkill: flags.allowAutoGenerateSkill,
    allowAutoGenerateScript: flags.allowAutoGenerateScript,
  };
  if (
    parsed.allowGithubSearch !== fallback.allowGithubSearch ||
    parsed.allowAutoGenerateSkill !== fallback.allowAutoGenerateSkill ||
    parsed.allowAutoGenerateScript !== fallback.allowAutoGenerateScript
  ) {
    throw new PlannerGenerationError(`Planner ${pathLabel} must match the requested capability policy.`, artifacts);
  }
  return parsed;
}

function requireHarnessStatus(value: unknown, artifacts: SpecArtifact[]): BlueprintHarnessNode["status"] {
  if (value === "draft" || value === "draft_ready" || value === "dirty" || value === "building" || value === "ready" || value === "failed") {
    return value;
  }
  throw new PlannerGenerationError("Planner /harness.status must be one of draft, draft_ready, dirty, building, ready, failed.", artifacts);
}

function requireAgentStatus(value: unknown, pathLabel: string, artifacts: SpecArtifact[]): HarnessBlueprint["agents"][number]["status"] {
  if (value === "idle" || value === "queued" || value === "ready" || value === "running" || value === "completed" || value === "blocked" || value === "failed") {
    return value;
  }
  throw new PlannerGenerationError(`Planner ${pathLabel} must be one of idle, queued, ready, running, completed, blocked, failed.`, artifacts);
}

function requireCompileStatus(value: unknown, pathLabel: string, artifacts: SpecArtifact[]): BlueprintSpec["compileStatus"] {
  if (value === "pending" || value === "success" || value === "failure") {
    return value;
  }
  throw new PlannerGenerationError(`Planner ${pathLabel} must be pending, success, or failure.`, artifacts);
}

function requireCapabilityKind(value: unknown, pathLabel: string, artifacts: SpecArtifact[]): CapabilityNode["capabilityType"] {
  if (value === "skill" || value === "script" || value === "tool") {
    return value;
  }
  throw new PlannerGenerationError(`Planner ${pathLabel} must be tool, skill, or script.`, artifacts);
}

function requireCapabilitySource(value: unknown, pathLabel: string, artifacts: SpecArtifact[]): CapabilityNode["source"] {
  if (value === "builtin" || value === "local" || value === "github" || value === "generated" || value === "unresolved") {
    return value;
  }
  throw new PlannerGenerationError(`Planner ${pathLabel} must be builtin, local, github, generated, or unresolved.`, artifacts);
}

function requireCapabilityStatus(value: unknown, pathLabel: string, artifacts: SpecArtifact[]): CapabilityNode["status"] {
  if (value === "unresolved" || value === "resolved" || value === "missing" || value === "ready" || value === "blocked" || value === "failed") {
    return value;
  }
  throw new PlannerGenerationError(`Planner ${pathLabel} must be unresolved, resolved, missing, ready, blocked, or failed.`, artifacts);
}

function makePromptArtifact(sourceTemplateId: string, goal: string, prompt: string): SpecArtifact {
  const createdAt = new Date().toISOString();
  return {
    id: makeId("artifact"),
    specType: "planner.prompt",
    title: `Planner Prompt: ${sourceTemplateId}`,
    kind: "planner",
    artifactType: "prompt",
    content: prompt,
    contentHash: hash16(prompt),
    sourceTemplateId,
    compiledFrom: [goal],
    ownerType: "planner",
    sourceText: prompt,
    compileStatus: "not-applicable",
    createdAt,
    updatedAt: createdAt,
  };
}

function makeSchemaArtifact(goal: string): SpecArtifact {
  const createdAt = new Date().toISOString();
  const schema = fs.readFileSync(path.join(MODULE_DIR, "../../../shared/schemas/harness-blueprint.schema.json"), "utf8");
  return {
    id: makeId("artifact"),
    specType: "planner.schema",
    title: "Planner Schema",
    kind: "planner",
    artifactType: "report",
    content: schema,
    contentHash: hash16(schema),
    sourceTemplateId: "planner.schema",
    compiledFrom: [goal],
    ownerType: "planner",
    sourceText: schema,
    compileStatus: "not-applicable",
    createdAt,
    updatedAt: createdAt,
  };
}

function makePlannerRawArtifact(
  sourceTemplateId: string,
  title: string,
  goal: string,
  llmResponse: { rawText: string; rawPayload: unknown; model: string },
  sectionTag: string,
): SpecArtifact {
  const createdAt = new Date().toISOString();
  const rawText = llmResponse.rawText;
  return {
    id: makeId("artifact"),
    specType: "planner.raw",
    title,
    kind: "planner",
    artifactType: "raw",
    content: rawText,
    contentHash: hash16(rawText),
    sourceTemplateId,
    compiledFrom: [goal, llmResponse.model, sectionTag],
    ownerType: "planner",
    sourceText: rawText,
    compileStatus: "not-applicable",
    createdAt,
    updatedAt: createdAt,
  };
}

function attachPlannerArtifacts(error: unknown, artifacts: SpecArtifact[]): PlannerGenerationError {
  if (error instanceof PlannerGenerationError) {
    return new PlannerGenerationError(error.message, mergeArtifacts(error.artifacts, artifacts));
  }
  return new PlannerGenerationError(error instanceof Error ? error.message : String(error), artifacts);
}

function mergeArtifacts(existing: SpecArtifact[], incoming: SpecArtifact[]): SpecArtifact[] {
  const byId = new Map<string, SpecArtifact>();
  for (const artifact of existing) {
    byId.set(artifact.id, artifact);
  }
  for (const artifact of incoming) {
    byId.set(artifact.id, artifact);
  }
  return Array.from(byId.values());
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
  const createdAt = new Date().toISOString();
  return {
    id: makeId("artifact"),
    specType,
    title,
    kind: "planner",
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
