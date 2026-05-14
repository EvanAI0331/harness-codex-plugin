import type { AgentNode, CapabilityNode, Harness, HarnessBlueprint } from "shared/types";
import { makeId } from "@/lib/id";
import { nowIso } from "@/lib/time";
import { isAgentReachExternalSearchCapability, isAgentReachGitHubSearchCapability } from "@/lib/capabilities/agent-reach";

export interface ComposerOutcome {
  harness: Harness;
}

export class ComposerService {
  compose(harness: Harness, blueprint: HarnessBlueprint): ComposerOutcome {
    const universalCapabilities = makeAgentReachCapabilities(blueprint.capabilities);
    const frameworkCapabilities = makeFrameworkAuthoringCapabilities(blueprint.capabilities);
    const capabilityNodes = mergeCapabilities(blueprint.capabilities, [...universalCapabilities, ...frameworkCapabilities]);
    const composedAgents = blueprint.agents.map((agent) => normalizeAgent(agent, harness.intake.codingAgentModel, universalCapabilities, frameworkCapabilities));
    const runtimeEdges = buildRuntimeEdges(harness.id, composedAgents, universalCapabilities, frameworkCapabilities);
    const mergedEdges = mergeEdges(blueprint.edges, runtimeEdges);
    const composedSpecs = blueprint.specs.map((spec) => ({
      ...spec,
      compileStatus: spec.compileStatus ?? "pending",
      specArtifactIds: Array.from(new Set(spec.specArtifactIds ?? [])),
    }));

    return {
      harness: {
        ...harness,
        status: "building",
        blueprint: {
          ...blueprint,
          agents: composedAgents,
          specs: composedSpecs,
          capabilities: capabilityNodes,
          edges: mergedEdges,
        },
        agentNodes: composedAgents,
        capabilityNodes: capabilityNodes.map((capability) => ({
          ...capability,
          specArtifactIds: Array.from(new Set(capability.specArtifactIds ?? [])),
        })),
        edges: mergedEdges,
        updatedAt: nowIso(),
      },
    };
  }
}

function normalizeAgent(
  agent: AgentNode,
  codingAgentModel: import("shared/types").ModelConfig,
  agentReachCapabilities: CapabilityNode[],
  frameworkCapabilities: CapabilityNode[],
): AgentNode {
  const authoringCapabilities = agent.catalogGroup === "engineering" ? frameworkCapabilities : [];
  const capabilityIds = Array.from(new Set([...(agent.capabilityIds ?? []), ...agentReachCapabilities.map((capability) => capability.id)]));
  const mergedCapabilityIds = Array.from(new Set([...capabilityIds, ...authoringCapabilities.map((capability) => capability.id)]));
  return {
    ...agent,
    model: agent.catalogGroup === "engineering" ? codingAgentModel : agent.model,
    status: agent.status === "failed" ? "failed" : "queued",
    specArtifactIds: Array.from(new Set(agent.specArtifactIds ?? [])),
    skillArtifactIds: Array.from(new Set(agent.skillArtifactIds ?? [])),
    scriptArtifactIds: Array.from(new Set(agent.scriptArtifactIds ?? [])),
    capabilityIds: mergedCapabilityIds,
    updatedAt: nowIso(),
  };
}

function buildRuntimeEdges(
  harnessId: string,
  agents: AgentNode[],
  agentReachCapabilities: CapabilityNode[],
  frameworkCapabilities: CapabilityNode[],
): HarnessBlueprint["edges"] {
  const edges: HarnessBlueprint["edges"] = [];
  if (agents.length === 0) {
    return edges;
  }

  edges.push({
    id: makeId("edge"),
    source: harnessId,
    target: agents[0].id,
    relation: "delegates_to",
    label: "harness -> entry agent",
  });

  for (let index = 1; index < agents.length; index += 1) {
    const previous = agents[index - 1];
    const current = agents[index];
    edges.push({
      id: makeId("edge"),
      source: previous.id,
      target: current.id,
      relation: "depends_on",
      label: `${current.label} depends on ${previous.label}`,
    });
  }

  for (const agent of agents) {
    for (const capability of agentReachCapabilities) {
      edges.push({
        id: makeId("edge"),
        source: agent.id,
        target: capability.id,
        relation: "requires",
        label: `${agent.label} requires ${capability.label}`,
      });
    }
    if (agent.catalogGroup === "engineering") {
      for (const capability of frameworkCapabilities) {
        edges.push({
          id: makeId("edge"),
          source: agent.id,
          target: capability.id,
          relation: "requires",
          label: `${agent.label} requires ${capability.label}`,
        });
      }
    }
  }

  return edges;
}

function mergeEdges(existing: HarnessBlueprint["edges"], incoming: HarnessBlueprint["edges"]): HarnessBlueprint["edges"] {
  const key = (edge: HarnessBlueprint["edges"][number]) => `${edge.source}::${edge.target}::${edge.relation}`;
  const byKey = new Map(existing.map((edge) => [key(edge), edge] as const));
  for (const edge of incoming) {
    byKey.set(key(edge), edge);
  }
  return Array.from(byKey.values());
}

function mergeCapabilities(capabilities: CapabilityNode[], injected: CapabilityNode[]): CapabilityNode[] {
  const byId = new Map(capabilities.map((capability) => [capability.id, capability] as const));
  for (const capability of injected) {
    byId.set(capability.id, capability);
  }
  return Array.from(byId.values());
}

function makeAgentReachCapabilities(capabilities: CapabilityNode[]): CapabilityNode[] {
  const createdAt = nowIso();
  const specs = [
    {
      label: "Agent Reach GitHub Search",
      summary: "GitHub repository and code search via Agent Reach and Jina Reader.",
      registryKey: "Agent Reach GitHub Search",
      resolutionReason: "universal_agent_reach_github_search",
      predicate: isAgentReachGitHubSearchCapability,
    },
    {
      label: "Agent Reach External Search",
      summary: "External web and code search via Agent Reach and Exa MCP.",
      registryKey: "Agent Reach External Search",
      resolutionReason: "universal_agent_reach_external_search",
      predicate: isAgentReachExternalSearchCapability,
    },
  ] as const;

  return specs.map((spec) => {
    const existing = capabilities.find((capability) => spec.predicate(capability.label));
    if (existing) {
      return {
        ...existing,
        policyFlags: {
          allowGithubSearch: true,
          allowAutoGenerateSkill: true,
          allowAutoGenerateScript: true,
        },
      };
    }

    return {
      id: makeId("capability"),
      nodeType: "capability",
      label: spec.label,
      summary: spec.summary,
      capabilityType: "tool",
      source: "builtin",
      status: "unresolved",
      specArtifactIds: [],
      policyFlags: {
        allowGithubSearch: true,
        allowAutoGenerateSkill: true,
        allowAutoGenerateScript: true,
      },
      registryKey: spec.registryKey,
      resolutionReason: spec.resolutionReason,
      resolverName: "composer",
      createdAt,
      updatedAt: createdAt,
    };
  });
}

function makeFrameworkAuthoringCapabilities(capabilities: CapabilityNode[]): CapabilityNode[] {
  const createdAt = nowIso();
  const specs = [
    {
      label: "Skill Generation",
      summary: "Generate validated skill files for framework nodes.",
      registryKey: "Skill Generation",
      resolutionReason: "script_authoring_skill_generation",
    },
    {
      label: "Script Generation",
      summary: "Generate executable scripts for framework nodes.",
      registryKey: "Script Generation",
      resolutionReason: "script_authoring_script_generation",
    },
  ] as const;

  return specs.map((spec) => {
    const existing = capabilities.find((capability) => capability.label === spec.label);
    if (existing) {
      return {
        ...existing,
        policyFlags: {
          allowGithubSearch: true,
          allowAutoGenerateSkill: true,
          allowAutoGenerateScript: true,
        },
      };
    }

    return {
      id: makeId("capability"),
      nodeType: "capability",
      label: spec.label,
      summary: spec.summary,
      capabilityType: spec.label === "Skill Generation" ? "skill" : "script",
      source: "unresolved",
      status: "unresolved",
      specArtifactIds: [],
      policyFlags: {
        allowGithubSearch: true,
        allowAutoGenerateSkill: true,
        allowAutoGenerateScript: true,
      },
      registryKey: spec.registryKey,
      resolutionReason: spec.resolutionReason,
      resolverName: "composer",
      createdAt,
      updatedAt: createdAt,
    };
  });
}
