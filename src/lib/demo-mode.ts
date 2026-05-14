import type { LLMAdapter, LLMJsonRequest, LLMJsonResponse } from "@/lib/llm/types";
import type { CapabilityGitHubSearchAdapter, GitHubSearchRequest, GitHubSearchResult } from "@/lib/capabilities/types";
import type { SpecCompilerAdapter, SpecCompileResult } from "@/lib/specx/types";
import type { RuntimeToolAdapter, RuntimeToolRequest, RuntimeToolResult } from "@/lib/runtime/types";
import { readEnvValue } from "@/lib/env";
import { OpenAICompatibleLLMAdapter } from "@/lib/llm/openai-compatible-adapter";
import { LocalSpecCompilerAdapter } from "@/lib/specx/local-compiler-adapter";
import { AgentReachGitHubSearchAdapter } from "@/lib/capabilities/github-search-adapter";
import { loadAgencyAgentCatalog, selectAgencyAgentsForGoal, selectAgencyExpertsForGoal, type AgencyAgentCatalogEntry } from "@/lib/agency-agents/catalog";

export function isDemoMode(): boolean {
  const raw = readEnvValue("DEMO_MODE") ?? process.env.DEMO_MODE ?? "";
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

export function createLLMAdapter(): LLMAdapter {
  return isDemoMode() ? new MockLLMAdapter() : new OpenAICompatibleLLMAdapter();
}

export function createSpecCompilerAdapter(): SpecCompilerAdapter {
  return isDemoMode() ? new MockSpecCompilerAdapter() : new LocalSpecCompilerAdapter();
}

export function createGitHubSearchAdapter(): CapabilityGitHubSearchAdapter {
  return isDemoMode() ? new MockGitHubSearchAdapter() : new AgentReachGitHubSearchAdapter();
}

export function createRuntimeToolAdapter(): RuntimeToolAdapter {
  if (isDemoMode()) {
    return new MockAgentReachAdapter();
  }

  return {
    async invoke(request: RuntimeToolRequest): Promise<RuntimeToolResult> {
      const { AgentReachRuntimeToolAdapter } = await import("@/lib/runtime/agent-reach-tool-adapter");
      return new AgentReachRuntimeToolAdapter().invoke(request);
    },
  };
}

export class MockLLMAdapter implements LLMAdapter {
  async generateJson(request: LLMJsonRequest): Promise<LLMJsonResponse> {
    const requestedAt = new Date().toISOString();
    const rawPayload = buildMockPayload(request);
    return {
      rawText: JSON.stringify(rawPayload, null, 2),
      rawPayload,
      model: request.config.model,
      provider: request.config.provider,
      requestedAt,
      respondedAt: requestedAt,
    };
  }
}

export class MockSpecCompilerAdapter implements SpecCompilerAdapter {
  async compile(source: string): Promise<SpecCompileResult> {
    return {
      success: true,
      compiledPath: "mock://spec-compiler",
      compiledPayload: source,
      stdout: "",
      stderr: "",
    };
  }
}

export class MockGitHubSearchAdapter implements CapabilityGitHubSearchAdapter {
  async search(request: GitHubSearchRequest): Promise<GitHubSearchResult> {
    return {
      found: true,
      source: "mock",
      summary: `Mock GitHub search result for ${request.query}`,
      label: request.label,
      backend: "mock",
      query: request.query,
      mode: request.mode,
      resultCount: 0,
    };
  }
}

export class MockAgentReachAdapter implements RuntimeToolAdapter {
  async invoke(request: RuntimeToolRequest): Promise<RuntimeToolResult> {
    return {
      success: true,
      toolName: request.capability.label,
      query: request.query,
      backend: "mock",
      mode: "repo",
      summary: `Mock agent reach result for ${request.capability.label}`,
      stdout: JSON.stringify({ mock: true, label: request.capability.label, query: request.query }, null, 2),
      stderr: "",
    };
  }
}

function buildMockPayload(request: LLMJsonRequest): Record<string, unknown> {
  const parsedUser = parseJsonObject(request.userPrompt);
  const goal = stringValue(parsedUser.goal, "Demo goal");
  const harnessId = stringValue(parsedUser.harnessId, "harness-demo");
  const requestedAt = new Date().toISOString();
  const dispatcherRole = getDispatcherRole();
  const experts = selectAgencyExpertsForGoal(goal);
  const planningAgentRole = getPlanningAgentRole(goal);

  switch (request.schemaName) {
    case "PlannerDispatch":
      return {
        summary: `Demo dispatch selected ${planningAgentRole}.`,
        selectedPlanningAgentRole: planningAgentRole,
      };
    case "PlannerFramework":
      return {
        summary: `Demo framework for ${goal}.`,
        harness: {
          id: harnessId,
          nodeType: "harness",
          label: goal.slice(0, 80) || "Harness Demo",
          summary: goal,
          status: "draft_ready",
        },
      };
    case "PlannerExpertRoster":
      return {
        selectedExpertRoles: experts
          .map((expert) => expert.role)
          .filter((role) => role !== planningAgentRole)
          .slice(0, 6),
      };
    case "PlannerSpecs": {
      const parsedAgents = parsePromptJsonArray(request.systemPrompt, "Agents:");
      const agents = parsedAgents.length > 0 ? parsedAgents : selectAgencyAgentsForGoal(goal).slice(0, 7);
      return {
        specs: agents.map((agent, index) => {
          const normalizedAgent = normalizeDemoAgent(agent);
          return {
            id: `spec-${slugify(normalizedAgent.role)}-${index + 1}`,
          nodeType: "spec",
          specType: "agent",
            agentId: normalizedAgent.id,
            title: `${normalizedAgent.label} Spec`,
            summary: `${normalizedAgent.label} handles ${normalizedAgent.role}.`,
            artifactId: `spec.${slugify(normalizedAgent.id)}.contract`,
            specArtifactIds: [],
            compileStatus: "pending",
          };
        }),
      };
    }
    case "PlannerCapabilities":
      return {
        capabilities: [
          {
            id: "capability-demo-tool",
            nodeType: "capability",
            label: "Demo Tool",
            summary: `Demo capability for ${goal}.`,
            capabilityType: "tool",
            source: "builtin",
            status: "resolved",
            specArtifactIds: [],
            policyFlags: parsedUser.capabilityPolicy ?? {
              allowGithubSearch: false,
              allowAutoGenerateSkill: false,
              allowAutoGenerateScript: false,
            },
            registryKey: "demo-tool",
            resolverName: "demo-mode",
            createdAt: requestedAt,
            updatedAt: requestedAt,
          },
        ],
      };
    case "PlannerEdges": {
      const parsedAgents = parsePromptJsonArray(request.systemPrompt, "Agents:");
      const agents = parsedAgents.length > 0 ? parsedAgents : selectAgencyAgentsForGoal(goal).slice(0, 7);
      const edges = agents.map((agent, index) => {
        const normalizedAgent = normalizeDemoAgent(agent);
        return {
          id: `edge-${index + 1}`,
          source: harnessId,
          target: normalizedAgent.id,
          relation: "contains",
          label: "contains",
        };
      });
      return {
        edges:
          edges.length > 0
            ? edges
            : [{ id: "edge-1", source: harnessId, target: normalizeAgentId(dispatcherRole), relation: "contains", label: "contains" }],
      };
    }
    case "TaskInstanceGoalDraft":
      return {
        goal: goal || `Demo task goal for ${stringValue(parsedUser.taskInstruction, "demo task")}`,
      };
    case "TaskInstanceCriteriaDraft":
      return {
        constraints: [`Respect the demo goal: ${goal}`],
        successCriteria: [`Produce a task result for ${goal}`],
      };
    case "TaskInstanceAssignmentDraft":
      return {
        objective: `Execute the assignment for ${stringValue(parsedUser.agentId, "agent-demo")}.`,
        expectedArtifacts: ["agent.output"],
        capabilityFocus: ["tool"],
      };
    case "TaskInstanceDeliverableDraft": {
      const assignments = Array.isArray(parsedUser.assignments) ? parsedUser.assignments : [];
      const owner = (assignments[0] as Record<string, unknown> | undefined) ?? {};
      return {
        finalDeliverable: {
          artifactType: "final.deliverable",
          ownerAgentId: stringValue(owner.agentId, normalizeAgentId(dispatcherRole)),
          ownerAgentRole: stringValue(owner.agentRole, dispatcherRole),
          title: `${goal || "Demo"} Deliverable`,
          format: "markdown",
          summary: `Demo final deliverable for ${goal}.`,
          requiredFields: ["summary"],
        },
      };
    }
    case "AgentRuntimeDecision": {
      const contentFields = extractMockOutputContractFields(request.systemPrompt);
      const contentJson = Object.fromEntries(
        contentFields.map((field) => [field, `Demo ${field} for ${stringValue(parsedUser.agentRole, "agent")}.`]),
      );
      return {
        actionDecision: "compose",
        capabilitySelection: {
          capabilityType: "none",
          reason: "demo_mode_compose",
        },
        expectedArtifactSchema: {
          type: "object",
          title: "Demo Agent Output",
          requiredFields: ["summary"],
          description: "Demo mode output schema.",
        },
        handoffSummary: `Demo handoff for ${stringValue(parsedUser.agentRole, "agent")}.`,
        taskSummary: `Demo runtime execution for ${goal}.`,
        upstreamArtifactIds: [],
        outputFocus: contentFields,
        agentOutputDraft: {
          title: "Demo Agent Output",
          artifactType: "agent.output",
          contentText: `Demo agent output for ${goal || "the requested task"}.`,
          contentJson,
          summary: `Demo agent output for ${goal || "the requested task"}.`,
        },
      };
    }
    case "ScriptAuthoringOutput":
      return {
        summary: `Demo script plan for ${goal}.`,
        skill: {
          title: "Repository Audit Skill",
          fileName: "demo-skill.js",
          sourceText: [
            "# Skill",
            "",
            "Repository Audit Skill",
            "",
            "## Purpose",
            "Summarize repository structure, runtime boundaries, and artifact-driven execution state.",
            "",
            "## Inputs",
            "- `HARNESS_RUNTIME_INPUT_JSON`",
            "- `HARNESS_RUNTIME_TASK_INSTANCE_JSON`",
            "",
            "## Outputs",
            "- A JSON object with `summary`, `findings`, and `nextSteps`.",
            "",
            "## Constraints",
            "- Keep outputs concise and grounded in the provided task instance.",
            "- Do not claim success without real artifacts.",
            "",
            "## Validation",
            "- Source contains all required headings.",
            "- Result is a structured JSON object.",
            "- The harness runtime can persist the output as an artifact.",
            "",
          ].join("\n"),
        },
        script: {
          title: "Demo Script",
          fileName: "demo-script.mjs",
          entrypoint: "run",
          sourceText: "export function run() { return { summary: \"demo script\" }; }",
        },
        artifacts: {
          skillSourceTemplateId: "demo.skill.template",
          scriptSourceTemplateId: "demo.script.template",
        },
        validation: {
          includesSkill: true,
          includesScript: true,
          executable: true,
          persistable: true,
        },
      };
    case "RunTaskOutput":
      return {
        runId: stringValue(parsedUser.runId, "run-demo"),
        harnessId: stringValue(parsedUser.harnessId, harnessId),
        taskInstruction: stringValue(parsedUser.taskInstruction, goal),
        title: `Demo Report for ${goal}`,
        summary: `Demo final report for ${goal}.`,
        status: "success",
        reportMarkdown: `# Demo Report\n\n${goal}\n`,
        sections: [
          {
            title: "Summary",
            bullets: [`Goal: ${goal}`, "Demo mode active"],
          },
        ],
        evidence: [
          {
            nodeId: "demo-node",
            nodeName: "Demo Node",
            action: "compose",
            summary: "Demo evidence",
            timestamp: requestedAt,
          },
        ],
        deliverables: [`Demo deliverable for ${goal}`],
        risks: ["Demo mode uses mock outputs."],
        nextSteps: ["Run the real workflow with live credentials."],
      };
    default:
      return {
        ok: true,
        schemaName: request.schemaName,
      };
  }
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore parse errors and fall back to defaults.
  }
  return {};
}

function parsePromptJsonArray(prompt: string, label: string): Record<string, unknown>[] {
  const raw = extractPromptSection(prompt, label, ["Selected planning agent role:", "Canonical agent roles:", "Agent catalog:"]);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
  } catch {
    return [];
  }
}

function normalizeDemoAgent(agent: Record<string, unknown> | AgencyAgentCatalogEntry): { id: string; role: string; label: string } {
  if ("dispatcher" in agent) {
    const catalog = agent as AgencyAgentCatalogEntry;
    return {
      id: normalizeAgentId(catalog.role),
      role: catalog.role,
      label: catalog.name,
    };
  }
  const record = agent as Record<string, unknown>;
  const role = stringValue(record.role, "agent");
  const label = stringValue(record.label, stringValue(record.name, "Agent"));
  const id = stringValue(record.id, normalizeAgentId(role));
  return { id, role, label };
}

function extractPromptSection(prompt: string, startLabel: string, endLabels: string[]): string {
  const startIndex = prompt.indexOf(startLabel);
  if (startIndex < 0) {
    return "";
  }
  const afterStart = prompt.slice(startIndex + startLabel.length).trimStart();
  const endIndexCandidates = endLabels
    .map((label) => afterStart.indexOf(label))
    .filter((index) => index >= 0);
  const endIndex = endIndexCandidates.length > 0 ? Math.min(...endIndexCandidates) : afterStart.length;
  return afterStart.slice(0, endIndex).trim();
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function extractMockOutputContractFields(prompt: string): string[] {
  const raw = extractPromptSection(prompt, "Compiled output contract:", ["Upstream artifacts:"]);
  try {
    const parsed = JSON.parse(raw) as { contentFields?: unknown };
    if (Array.isArray(parsed.contentFields)) {
      const fields = parsed.contentFields.map((item) => String(item)).filter(Boolean);
      if (fields.length > 0) {
        return fields;
      }
    }
  } catch {
    // Keep demo mode deterministic if the prompt section is absent.
  }
  return ["roleDeliverable", "roleFindings", "roleHandoff"];
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

function normalizeAgentId(role: string): string {
  return `agent-${slugify(role)}`;
}

function getDispatcherRole(): string {
  const dispatcher = loadAgencyAgentCatalog().find((entry) => entry.dispatcher);
  return dispatcher?.role ?? "dispatcher";
}

function getPlanningAgentRole(goal: string): string {
  const expert = selectAgencyExpertsForGoal(goal)[0];
  if (expert) {
    return expert.role;
  }

  const fallback = loadAgencyAgentCatalog().find((entry) => !entry.dispatcher);
  return fallback?.role ?? "engineering-senior-developer";
}
