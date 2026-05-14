import { spawnSync } from "node:child_process";
import type { CapabilityNode, CapabilityPolicy, Harness, HarnessBlueprint, HarnessEvent, SpecArtifact } from "shared/types";
import { makeId } from "@/lib/id";
import { nowIso } from "@/lib/time";
import { hash16 } from "@/lib/specs/spec-hash";
import { readEnvValue } from "@/lib/env";
import { findBuiltinCapability, findLocalCapability } from "@/lib/capabilities/registry";
import type {
  CapabilityExternalSearchAdapter,
  CapabilityGenerationAdapter,
  CapabilityGitHubSearchAdapter,
  CapabilityResolutionResult,
} from "@/lib/capabilities/types";
import { LocalCapabilityGenerationAdapter } from "@/lib/capabilities/local-generation-adapter";
import { createGitHubSearchAdapter, isDemoMode } from "@/lib/demo-mode";
import {
  getGitHubSearchRestrictionReason,
  isAgentReachExternalSearchCapability,
  isAgentReachGitHubSearchCapability,
} from "@/lib/capabilities/agent-reach";

export interface CapabilityResolverAdapters {
  externalSearch: CapabilityExternalSearchAdapter;
  githubSearch: CapabilityGitHubSearchAdapter;
  generator: CapabilityGenerationAdapter;
}

export interface CapabilityResolutionOutcome {
  blueprint: HarnessBlueprint;
  artifacts: SpecArtifact[];
  events: HarnessEvent[];
  steps: CapabilityResolutionStep[];
}

export interface CapabilityResolutionStep {
  capability: CapabilityNode;
  artifacts: SpecArtifact[];
  events: HarnessEvent[];
}

export class CapabilityResolverService {
  constructor(private readonly adapters: CapabilityResolverAdapters) {}

  async resolve(input: {
    harness: Harness;
    blueprint: HarnessBlueprint;
    onStep?: (snapshot: HarnessBlueprint, step: CapabilityResolutionStep) => Promise<void> | void;
  }): Promise<CapabilityResolutionOutcome> {
    const artifacts: SpecArtifact[] = [];
    const events: HarnessEvent[] = [];
    const steps: CapabilityResolutionStep[] = [];
    const capabilities: CapabilityNode[] = [];
    let blueprintSnapshot = input.blueprint;

    for (const capability of input.blueprint.capabilities) {
      const resolved = await this.resolveCapability(input.harness, capability);
      artifacts.push(...resolved.artifacts);
      events.push(...resolved.events);
      steps.push(resolved);
      capabilities.push(resolved.capability);
      blueprintSnapshot = {
        ...blueprintSnapshot,
        capabilities: capabilities.slice(),
      };
      await input.onStep?.(blueprintSnapshot, resolved);
    }

    return {
      blueprint: {
        ...blueprintSnapshot,
        capabilities,
      },
      artifacts,
      events,
      steps,
    };
  }

  private async resolveCapability(
    harness: Harness,
    capability: CapabilityNode,
  ): Promise<CapabilityResolutionResult & { events: HarnessEvent[] }> {
    const artifacts: SpecArtifact[] = [];
    const events: HarnessEvent[] = [];
    const now = nowIso();
    const goal = harness.intake.goal;

    if (capability.status === "resolved" && capability.source !== "unresolved" && capability.specArtifactIds.length > 0) {
      return {
        capability,
        artifacts,
        events,
      };
    }

    const builtin = findBuiltinCapability(capability.label, capability.capabilityType);
    if (builtin) {
      if (isAgentReachExternalSearchCapability(builtin.label)) {
        if (!isEnvFlagEnabled("AGENT_REACH_ENABLED")) {
          events.push(
            buildEvent(harness.id, "resolve", "capability.resolution.blocked", `${capability.label} blocked because Agent Reach is disabled.`, {
              capabilityId: capability.id,
              reason: "agent_reach_disabled",
              source: builtin.source,
              registryKey: builtin.label,
            }),
          );
          return {
            capability: {
              ...capability,
              source: "builtin",
              status: "missing",
              registryKey: builtin.label,
              resolutionReason: "agent_reach_disabled",
              resolverName: "agent-reach-external-search-adapter",
              specArtifactIds: [],
              updatedAt: now,
            },
            artifacts,
            events,
          };
        }
        const result = await this.adapters.externalSearch.search({
          label: capability.label,
          kind: capability.capabilityType,
          goal,
          query: goal,
        });
        if (!result.found) {
          events.push(
            buildEvent(harness.id, "resolve", "capability.missing", `${capability.label} could not be verified by Agent Reach external search.`, {
              capabilityId: capability.id,
              source: builtin.source,
              registryKey: builtin.label,
              backend: result.backend ?? "agent-reach+exa",
              stderr: result.stderr ?? "",
              stdout: result.stdout ?? "",
            }),
          );
          return {
            capability: {
              ...capability,
              source: "builtin",
              status: "missing",
              registryKey: builtin.label,
              resolutionReason: "agent_reach_external_search_unavailable",
              resolverName: "agent-reach-external-search-adapter",
              specArtifactIds: [],
              updatedAt: now,
            },
            artifacts,
            events,
          };
        }

        const artifact = makeAgentReachSearchArtifact(harness.id, capability, builtin.label, result, "agent-reach.external-search");
        artifacts.push(artifact);
        events.push(
          buildEvent(harness.id, "resolve", "capability.resolved", `${capability.label} resolved through Agent Reach external search.`, {
            capabilityId: capability.id,
            source: builtin.source,
            registryKey: builtin.label,
            artifactId: artifact.id,
            backend: result.backend,
          }),
        );
        return {
          capability: {
            ...capability,
            source: "builtin",
            status: "resolved",
            registryKey: builtin.label,
            resolutionReason: "resolved_through_agent_reach_external_search",
            resolverName: "agent-reach-external-search-adapter",
            specArtifactIds: [artifact.id],
            updatedAt: now,
          },
          artifacts,
          events,
        };
      }

      if (isAgentReachGitHubSearchCapability(builtin.label)) {
        if (!isEnvFlagEnabled("GITHUB_SEARCH_ENABLED")) {
          events.push(
            buildEvent(harness.id, "resolve", "capability.resolution.blocked", `${capability.label} blocked because GitHub search is disabled.`, {
              capabilityId: capability.id,
              reason: "github_search_disabled",
              source: builtin.source,
              registryKey: builtin.label,
            }),
          );
          return {
            capability: {
              ...capability,
              source: "builtin",
              status: "missing",
              registryKey: builtin.label,
              resolutionReason: "github_search_disabled",
              resolverName: "agent-reach-github-search-adapter",
              specArtifactIds: [],
              updatedAt: now,
            },
            artifacts,
            events,
          };
        }
        const githubAssetQuery = buildGitHubAssetLookupQuery(capability);
        const restrictionReason = getGitHubSearchRestrictionReason(capability.label, githubAssetQuery);
        if (restrictionReason) {
          events.push(
            buildEvent(harness.id, "resolve", "capability.missing", `${capability.label} cannot use GitHub search for general information search.`, {
              capabilityId: capability.id,
              source: builtin.source,
              registryKey: builtin.label,
              stderr: restrictionReason,
            }),
          );
          return {
            capability: {
              ...capability,
              source: "builtin",
              status: "missing",
              registryKey: builtin.label,
              resolutionReason: "github_search_restricted_to_asset_lookup",
              resolverName: "agent-reach-github-search-adapter",
              specArtifactIds: [],
              updatedAt: now,
            },
            artifacts,
            events,
          };
        }

        const result = await this.adapters.githubSearch.search({
          label: capability.label,
          query: githubAssetQuery,
          mode: "repo",
          limit: 10,
        });
        if (!result.found) {
          events.push(
            buildEvent(harness.id, "resolve", "capability.missing", `${capability.label} could not be verified by Agent Reach GitHub search.`, {
              capabilityId: capability.id,
              source: builtin.source,
              registryKey: builtin.label,
              backend: result.backend ?? "gh-cli:repo",
              stderr: result.stderr ?? "",
              stdout: result.stdout ?? "",
            }),
          );
          return {
            capability: {
              ...capability,
              source: "builtin",
              status: "missing",
              registryKey: builtin.label,
              resolutionReason: "agent_reach_github_search_unavailable",
              resolverName: "agent-reach-github-search-adapter",
              specArtifactIds: [],
              updatedAt: now,
            },
            artifacts,
            events,
          };
        }

        const artifact = makeAgentReachSearchArtifact(harness.id, capability, builtin.label, result, "agent-reach.github-search");
        artifacts.push(artifact);
        events.push(
          buildEvent(harness.id, "resolve", "capability.resolved", `${capability.label} resolved through Agent Reach GitHub search.`, {
            capabilityId: capability.id,
            source: builtin.source,
            registryKey: builtin.label,
            artifactId: artifact.id,
            backend: result.backend,
          }),
        );
        return {
          capability: {
            ...capability,
            source: "builtin",
            status: "resolved",
            registryKey: builtin.label,
            resolutionReason: "resolved_through_agent_reach_github_search",
            resolverName: "agent-reach-github-search-adapter",
            specArtifactIds: [artifact.id],
            updatedAt: now,
          },
          artifacts,
          events,
        };
      }

      const artifact = makeCapabilityArtifact(harness.id, capability, builtin.summary, builtin.source, builtin.label);
      artifacts.push(artifact);
      events.push(buildEvent(harness.id, "resolve", "capability.resolved", `${capability.label} resolved from builtin registry.`, {
        capabilityId: capability.id,
        source: builtin.source,
        registryKey: builtin.label,
        artifactId: artifact.id,
      }));
      return {
        capability: {
          ...capability,
          source: builtin.source,
          status: "resolved",
          registryKey: builtin.label,
          resolutionReason: "resolved_from_builtin_registry",
          resolverName: "builtin-registry",
          specArtifactIds: [artifact.id],
          updatedAt: now,
        },
        artifacts,
        events,
      };
    }

    const local = findLocalCapability(capability.label, capability.capabilityType);
    if (local) {
      const artifact = makeCapabilityArtifact(harness.id, capability, local.summary, local.source, local.label);
      artifacts.push(artifact);
      events.push(buildEvent(harness.id, "resolve", "capability.resolved", `${capability.label} resolved from local registry.`, {
        capabilityId: capability.id,
        source: local.source,
        registryKey: local.label,
        artifactId: artifact.id,
      }));
      return {
        capability: {
          ...capability,
          source: local.source,
          status: "resolved",
          registryKey: local.label,
          resolutionReason: "resolved_from_local_registry",
          resolverName: "local-registry",
          specArtifactIds: [artifact.id],
          updatedAt: now,
        },
        artifacts,
        events,
      };
    }

    if (capability.policyFlags.allowGithubSearch) {
      const githubAssetQuery = buildGitHubAssetLookupQuery(capability);
      const restrictionReason = getGitHubSearchRestrictionReason(capability.label, githubAssetQuery);
      if (restrictionReason) {
        events.push(
          buildEvent(harness.id, "resolve", "capability.missing", `${capability.label} cannot use GitHub search for general information search.`, {
            capabilityId: capability.id,
            source: "builtin",
            stderr: restrictionReason,
          }),
        );
        return {
          capability: {
            ...capability,
            source: "builtin",
            status: "missing",
            registryKey: capability.label,
            resolutionReason: "github_search_restricted_to_asset_lookup",
            resolverName: "capability-resolver",
            specArtifactIds: [],
            updatedAt: now,
          },
          artifacts,
          events,
        };
      }

      const result = await this.adapters.githubSearch.search({
        label: capability.label,
        query: githubAssetQuery,
        mode: "repo",
        limit: 10,
      });
      if (result.found) {
        const artifact = makeAgentReachSearchArtifact(harness.id, capability, result.label ?? capability.label, result, "agent-reach.github-search");
        artifacts.push(artifact);
        events.push(buildEvent(harness.id, "resolve", "capability.resolved", `${capability.label} resolved through Agent Reach GitHub search.`, {
          capabilityId: capability.id,
          source: "builtin",
          registryKey: result.label ?? capability.label,
          artifactId: artifact.id,
          backend: result.backend,
        }));
        return {
          capability: {
            ...capability,
            source: "builtin",
            status: "resolved",
            registryKey: result.label ?? capability.label,
            resolutionReason: "resolved_from_agent_reach_github_search",
            resolverName: "agent-reach-github-search-adapter",
            specArtifactIds: [artifact.id],
            updatedAt: now,
          },
          artifacts,
          events,
        };
      }
      events.push(buildEvent(harness.id, "resolve", "capability.missing", `${capability.label} missing after Agent Reach GitHub search.`, {
        capabilityId: capability.id,
        source: "builtin",
      }));
    }

    const canGenerate =
      (capability.capabilityType === "skill" && capability.policyFlags.allowAutoGenerateSkill) ||
      (capability.capabilityType === "script" && capability.policyFlags.allowAutoGenerateScript);

    if (canGenerate) {
      const generated = await this.adapters.generator.generate({
        capability,
        goal,
      });
      const artifact = makeCapabilityArtifact(harness.id, capability, generated.sourceText, "generated", capability.label);
      artifact.stdout = generated.stdout;
      artifact.stderr = generated.stderr;
      artifacts.push(artifact);
      const eventKind = capability.capabilityType === "script" ? "script.generated" : "capability.resolved";
      events.push(
        buildEvent(harness.id, "resolve", eventKind, `${capability.label} generated from capability policy.`, {
          capabilityId: capability.id,
          source: "generated",
          artifactId: artifact.id,
        }),
      );
      return {
        capability: {
          ...capability,
          source: "generated",
          status: "resolved",
          registryKey: capability.label,
          resolutionReason: "generated_from_policy",
          resolverName: "local-generation-adapter",
          specArtifactIds: [artifact.id],
          updatedAt: now,
        },
        artifacts,
        events,
      };
    }

    events.push(buildEvent(harness.id, "resolve", "capability.missing", `${capability.label} remains unresolved.`, {
      capabilityId: capability.id,
      source: "unresolved",
    }));

    return {
      capability: {
        ...capability,
        source: "unresolved",
        status: "unresolved",
        registryKey: capability.label,
        resolutionReason: "no_registry_match_and_policy_disallows_generation",
        resolverName: "capability-resolver",
        specArtifactIds: [],
        updatedAt: now,
      },
      artifacts,
      events,
    };
  }
}

export function makeDefaultCapabilityResolver(): CapabilityResolverService {
  return new CapabilityResolverService({
    externalSearch: createLazyExternalSearchAdapter(),
    githubSearch: createLazyGitHubSearchAdapter(),
    generator: new LocalCapabilityGenerationAdapter(),
  });
}

function createLazyExternalSearchAdapter(): CapabilityExternalSearchAdapter {
  return {
    async search(request) {
      if (isDemoMode()) {
        return {
          found: true,
          source: "mock",
          summary: `Mock external search result for ${request.query ?? request.label}`,
          label: request.label,
          backend: "mock",
          query: request.query ?? request.label,
          mode: request.kind === "tool" ? "web" : "code",
        };
      }
      return searchAgentReachExternal(request);
    },
  };
}

function createLazyGitHubSearchAdapter(): CapabilityGitHubSearchAdapter {
  if (isDemoMode()) {
    return createGitHubSearchAdapter();
  }

  return {
    async search(request) {
      return searchAgentReachGitHub(request);
    },
  };
}

async function searchAgentReachExternal(request: import("@/lib/capabilities/types").ExternalSearchRequest): Promise<import("@/lib/capabilities/types").ExternalSearchResult> {
  const backend = "agent-reach+exa";
  const query = normalizeQuery(request.query || request.goal || request.label);
  const mode = inferMode(request.label, query);
  const call = buildCall(mode, query);
  const mcporter = resolveMcporterCmd();
  const envCheck = checkEnvironment(mcporter);

  if (!envCheck.available) {
    return {
      found: false,
      label: request.label,
      summary: envCheck.message,
      backend,
      query,
      mode,
      stdout: envCheck.stdout,
      stderr: envCheck.stderr,
      source: "agent-reach",
    };
  }

  const executed = spawnSync(mcporter, ["call", call], {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const stdout = (executed.stdout || "").trim();
  const stderr = (executed.stderr || "").trim();
  if (executed.status !== 0 || !stdout) {
    return {
      found: false,
      label: request.label,
      summary: stderr || `Agent Reach external search failed for ${mode} query.`,
      backend,
      query,
      mode,
      stdout,
      stderr,
      source: "agent-reach",
    };
  }

  return {
    found: true,
    label: request.label,
    summary: summarize(stdout),
    backend,
    query,
    mode,
    stdout,
    stderr,
    source: "agent-reach",
  };
}

async function searchAgentReachGitHub(request: import("@/lib/capabilities/types").GitHubSearchRequest): Promise<import("@/lib/capabilities/types").GitHubSearchResult> {
  const query = normalizeQuery(request.query || request.label);
  const restrictionReason = getGitHubSearchRestrictionReason(request.label, query);
  if (restrictionReason) {
    return {
      found: false,
      label: request.label,
      summary: restrictionReason,
      backend: `agent-reach+exa -> jina-reader:repo`,
      query,
      mode: request.mode ?? "repo",
      stdout: "",
      stderr: "github_search_restricted_to_asset_lookup",
      source: "agent-reach",
    };
  }

  const mode = request.mode ?? inferGitHubMode(request.label, query);
  const backend = `agent-reach+exa -> jina-reader:${mode}`;

  try {
    const directRepo = parseGitHubRepoReference(query);
    const discovery = directRepo
      ? null
      : await searchAgentReachExternal({
          label: request.label,
          kind: "tool",
          goal: `GitHub repository search for ${query}`,
          query: buildDiscoveryQuery(query, mode),
          mode: "code",
        });

    const repo = directRepo ?? extractRepositoryFromText(discovery?.stdout ?? discovery?.summary ?? "");
    if (!repo) {
      return {
        found: false,
        label: request.label,
        summary: discovery
          ? `Agent Reach external search did not identify a GitHub repository for: ${query}`
          : `Unable to resolve GitHub repository for: ${query}`,
        backend,
        query,
        mode,
        stdout: discovery?.stdout ?? "",
        stderr: discovery?.stderr ?? "no_repository_candidate",
        source: "agent-reach",
      };
    }

    const repoUrl = `${DEFAULT_JINA_BASE}/${repo.owner}/${repo.repo}`;
    const repoPage = await fetchWithTimeout(repoUrl, DEFAULT_FETCH_TIMEOUT_MS);
    const repoText = (await repoPage.text()).trim();

    if (!repoPage.ok || !repoText) {
      return {
        found: false,
        label: request.label,
        summary: `Jina Reader could not read GitHub repository page for ${repo.owner}/${repo.repo}.`,
        backend,
        query,
        mode,
        stdout: discovery?.stdout ? `${discovery.stdout}\n\n${repoText}` : repoText,
        stderr: repoPage.ok ? "empty_repo_page" : `Jina Reader HTTP ${repoPage.status}`,
        source: "agent-reach",
      };
    }

    const discoveryText = discovery?.stdout?.trim() || discovery?.summary?.trim() || "";
    return {
      found: true,
      label: request.label,
      summary: summarizeResults(mode, query, repo, repoText, discoveryText),
      backend,
      query,
      mode,
      resultCount: 1,
      stdout: [discoveryText, repoText].filter(Boolean).join("\n\n---\n\n"),
      stderr: discovery?.stderr ?? "",
      source: "agent-reach",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      found: false,
      label: request.label,
      summary: `GitHub search failed for ${query}: ${message}`,
      backend,
      query,
      mode,
      stdout: "",
      stderr: message,
      source: "agent-reach",
    };
  }
}

const DEFAULT_JINA_BASE = "https://r.jina.ai/github.com";
const DEFAULT_FETCH_TIMEOUT_MS = 15000;

function checkEnvironment(mcporter: string): { available: boolean; message: string; stdout: string; stderr: string } {
  if (!isExecutableAvailable(mcporter)) {
    return {
      available: false,
      message: "Agent Reach external search requires mcporter in PATH. Run: npm install -g mcporter",
      stdout: "",
      stderr: "mcporter not found",
    };
  }

  const configList = spawnSync(mcporter, ["config", "list"], {
    encoding: "utf-8",
    maxBuffer: 4 * 1024 * 1024,
  });
  const stdout = (configList.stdout || "").trim();
  const stderr = (configList.stderr || "").trim();
  if (configList.status !== 0) {
    return {
      available: false,
      message: "Agent Reach external search could not read mcporter config.",
      stdout,
      stderr: stderr || "mcporter config list failed",
    };
  }
  if (!/exa/i.test(stdout)) {
    return {
      available: false,
      message: "Agent Reach external search requires Exa in mcporter. Run: mcporter config add exa https://mcp.exa.ai/mcp",
      stdout,
      stderr: "exa MCP not configured",
    };
  }
  return {
    available: true,
    message: "Agent Reach external search is configured.",
    stdout,
    stderr,
  };
}

function isExecutableAvailable(command: string): boolean {
  const result = spawnSync(command, ["--help"], {
    encoding: "utf-8",
    timeout: 1500,
    maxBuffer: 1024 * 1024,
  });
  return result.error == null && result.status !== null;
}

function inferMode(label: string, query: string): "web" | "code" {
  const haystack = `${label} ${query}`.toLowerCase();
  if (haystack.includes("code") || haystack.includes("github") || haystack.includes("repo")) {
    return "code";
  }
  return "web";
}

function inferGitHubMode(label: string, query: string): "repo" | "code" {
  const haystack = `${label} ${query}`.toLowerCase();
  if (haystack.includes("code") || haystack.includes("snippet") || haystack.includes("implementation") || haystack.includes("file")) {
    return "code";
  }
  return "repo";
}

function buildCall(mode: "web" | "code", query: string): string {
  const escapedQuery = JSON.stringify(query);
  if (mode === "code") {
    return `exa.web_search_exa(query: ${escapedQuery}, numResults: 8, includeDomains: ["github.com"])`;
  }
  return `exa.web_search_exa(query: ${escapedQuery}, numResults: 5)`;
}

function normalizeQuery(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : "Agent Reach external search";
}

function summarize(stdout: string): string {
  const firstBlock = stdout.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  return firstBlock.length > 240 ? `${firstBlock.slice(0, 237)}...` : firstBlock;
}

function resolveMcporterCmd(): string {
  return process.env.AGENT_REACH_MCPORTER_CMD?.trim() || "mcporter";
}

function isEnvFlagEnabled(key: string): boolean {
  const raw = readEnvValue(key) ?? "";
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function buildDiscoveryQuery(query: string, mode: "repo" | "code"): string {
  return mode === "code" ? `${query} github repository code` : `${query} github repository`;
}

function parseGitHubRepoReference(value: string): { owner: string; repo: string } | null {
  const normalized = value.trim().replace(/^https?:\/\//, "").replace(/^github\.com\//, "");
  const match = normalized.match(/^github\.com\/([^/]+)\/([^/]+)(?:\/.*)?$/i) ?? normalized.match(/^([^/\s]+)\/([^/\s]+)$/i);
  if (!match) {
    return null;
  }

  const owner = match[1]?.trim();
  const repo = match[2]?.replace(/\.git$/i, "").trim();
  if (!owner || !repo) {
    return null;
  }

  return { owner, repo };
}

function extractRepositoryFromText(text: string): { owner: string; repo: string } | null {
  const candidates = new Map<string, { owner: string; repo: string }>();
  const stripped = stripAnsi(text);

  const urlRegex = /https?:\/\/github\.com\/([^/\s]+)\/([^/\s"')\]]+)(?:\/[^\s"')\]]*)?/gi;
  for (const match of stripped.matchAll(urlRegex)) {
    const owner = match[1]?.trim();
    const repo = match[2]?.replace(/\.git$/i, "").trim();
    if (owner && repo) {
      candidates.set(`${owner}/${repo}`, { owner, repo });
    }
  }

  const repoRefRegex = /github\.com\/([^/\s]+)\/([^/\s"')\]]+)(?:\/[^\s"')\]]*)?/gi;
  for (const match of stripped.matchAll(repoRefRegex)) {
    const owner = match[1]?.trim();
    const repo = match[2]?.replace(/\.git$/i, "").trim();
    if (owner && repo) {
      candidates.set(`${owner}/${repo}`, { owner, repo });
    }
  }

  if (candidates.size > 0) {
    return candidates.values().next().value ?? null;
  }

  const lineMatches = stripped
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => line.match(/(?:^|\s)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\s|$)/g) ?? []);

  for (const match of lineMatches) {
    const repoMatch = match.trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
    if (!repoMatch) {
      continue;
    }
    const owner = repoMatch[1]?.trim();
    const repo = repoMatch[2]?.replace(/\.git$/i, "").trim();
    if (owner && repo) {
      return { owner, repo };
    }
  }

  return null;
}

function summarizeResults(
  mode: "repo" | "code",
  query: string,
  repo: { owner: string; repo: string },
  repoText: string,
  discoveryText: string,
): string {
  const repoPath = `${repo.owner}/${repo.repo}`;
  const firstLine = repoText.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  const discovery = discoveryText ? ` Discovered via Agent Reach external search.` : "";
  const modeLabel = mode === "code" ? "code" : "repo";
  return [`GitHub ${modeLabel} lookup for "${query}" resolved ${repoPath}.${discovery}`, firstLine].filter(Boolean).join(" ");
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "text/plain",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function makeCapabilityArtifact(
  harnessId: string,
  capability: CapabilityNode,
  content: string,
  source: string,
  registryKey: string,
): SpecArtifact {
  const createdAt = nowIso();
  return {
    id: makeId("artifact"),
    specType: "capability.resolution",
    title: `${capability.label} Resolution`,
    kind: "capability",
    artifactType: "report",
    content,
    contentHash: hash16(`${source}:${registryKey}:${content}`),
    sourceTemplateId: `capability.${capability.capabilityType}`,
    compiledFrom: [harnessId, capability.id],
    ownerType: "capability",
    ownerId: capability.id,
    sourceText: content,
    compileStatus: "not-applicable",
    createdAt,
    updatedAt: createdAt,
  };
}

function makeAgentReachSearchArtifact(
  harnessId: string,
  capability: CapabilityNode,
  registryKey: string,
  result: { backend?: string; query?: string; label?: string; summary?: string; stdout?: string; stderr?: string; mode?: string; resultCount?: number },
  sourceTemplateId: string,
): SpecArtifact {
  const createdAt = nowIso();
  const content = JSON.stringify(
    {
      backend:
        result.backend ??
        (sourceTemplateId === "agent-reach.github-search" ? "gh-cli:repo" : "agent-reach+exa"),
      query: result.query ?? "",
      label: result.label ?? capability.label,
      summary: result.summary ?? "",
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      mode: result.mode ?? "",
      resultCount: result.resultCount ?? 0,
    },
    null,
    2,
  );
  return {
    id: makeId("artifact"),
    specType: "capability.resolution",
    title: `${capability.label} Resolution`,
    kind: "capability",
    artifactType: "contract",
    content,
    contentHash: hash16(`agent-reach:${registryKey}:${content}`),
    sourceTemplateId,
    compiledFrom: [harnessId, capability.id],
    ownerType: "capability",
    ownerId: capability.id,
    sourceText: content,
    compileStatus: "success",
    backtestStatus: "success",
    compilerName: sourceTemplateId === "agent-reach.github-search" ? "agent-reach-github-search-adapter" : "agent-reach-external-search-adapter",
    contractVersion: sourceTemplateId === "agent-reach.github-search" ? "agent-reach-github-search-v1" : "agent-reach-external-search-v1",
    createdAt,
    updatedAt: createdAt,
  };
}

function buildGitHubAssetLookupQuery(capability: CapabilityNode): string {
  const base = [capability.registryKey, capability.label]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
  return `${base} skill tool library repository`.trim();
}

function buildEvent(
  harnessId: string,
  phase: HarnessEvent["phase"],
  kind: string,
  message: string,
  payload: Record<string, unknown>,
): HarnessEvent {
  return {
    id: makeId("event"),
    harnessId,
    channel: "system",
    phase,
    kind,
    message,
    payload,
    createdAt: nowIso(),
  };
}
