import type { RuntimeToolAdapter, RuntimeToolRequest, RuntimeToolResult } from "@/lib/runtime/types";
import { isDemoMode, MockAgentReachAdapter } from "@/lib/demo-mode";
import {
  getGitHubSearchRestrictionReason,
  isAgentReachExternalSearchCapability,
  isAgentReachGitHubSearchCapability,
} from "@/lib/capabilities/agent-reach";

export class AgentReachRuntimeToolAdapter implements RuntimeToolAdapter {
  async invoke(request: RuntimeToolRequest): Promise<RuntimeToolResult> {
    if (isDemoMode()) {
      return new MockAgentReachAdapter().invoke(request);
    }

    const query = normalizeQuery(request.query);
    if (query.length === 0) {
      return {
        success: false,
        toolName: request.capability.label,
        query,
        summary: "Agent Reach query is required.",
        stderr: "agent_reach_query_required",
        error: "agent_reach_query_required",
      };
    }

    if (isAgentReachGitHubSearchCapability(request.capability.label)) {
      const restrictionReason = getGitHubSearchRestrictionReason(request.capability.label, query);
      if (restrictionReason) {
        return {
          success: false,
          toolName: request.capability.label,
          query,
          summary: restrictionReason,
          stderr: "github_search_restricted_to_asset_lookup",
          error: "github_search_restricted_to_asset_lookup",
        };
      }

      const result = await searchGitHub({
        label: request.capability.label,
        query,
        mode: inferGitHubMode(request.capability.label, query),
        limit: 10,
      });

      if (!result.found) {
        return {
          success: false,
          toolName: request.capability.label,
          query,
          backend: result.backend,
          mode: result.mode,
          summary: result.summary ?? "Agent Reach GitHub search failed.",
          stdout: result.stdout,
          stderr: result.stderr,
          error: result.stderr || result.summary || "agent_reach_github_search_failed",
        };
      }

      return {
        success: true,
        toolName: request.capability.label,
        query,
        backend: result.backend,
        mode: result.mode,
        summary: result.summary ?? "Agent Reach GitHub search completed.",
        stdout: result.stdout,
        stderr: result.stderr,
      };
    }

    if (!isAgentReachExternalSearchCapability(request.capability.label)) {
      return {
        success: false,
        toolName: request.capability.label,
        query,
        summary: `Unsupported Agent Reach capability: ${request.capability.label}`,
        stderr: `unsupported_agent_reach_capability:${request.capability.label}`,
        error: "unsupported_agent_reach_capability",
      };
    }

    const result = await searchExternal({
      label: request.capability.label,
      kind: request.capability.capabilityType,
      goal: request.harness.intake.goal,
      query,
    });

    if (!result.found) {
      return {
        success: false,
        toolName: request.capability.label,
        query,
        backend: result.backend,
        mode: result.mode,
        summary: result.summary ?? "Agent Reach external search failed.",
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.stderr || result.summary || "agent_reach_external_search_failed",
      };
    }

    return {
      success: true,
      toolName: request.capability.label,
      query,
      backend: result.backend,
      mode: result.mode,
      summary: result.summary ?? "Agent Reach external search completed.",
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}

function normalizeQuery(value?: string | null): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  return normalized;
}

function inferGitHubMode(label: string, query: string): "repo" | "code" {
  const haystack = `${label} ${query}`.toLowerCase();
  if (haystack.includes("code") || haystack.includes("snippet") || haystack.includes("implementation") || haystack.includes("file")) {
    return "code";
  }
  return "repo";
}

async function searchExternal(request: import("@/lib/capabilities/types").ExternalSearchRequest) {
  const modulePath = "@/lib/capabilities/" + "agent-reach-search";
  const { searchAgentReachExternal } = await import(modulePath);
  return searchAgentReachExternal(request);
}

async function searchGitHub(request: import("@/lib/capabilities/types").GitHubSearchRequest) {
  const modulePath = "@/lib/capabilities/" + "agent-reach-search";
  const { searchAgentReachGitHub } = await import(modulePath);
  return searchAgentReachGitHub(request);
}
