import { spawnSync } from "node:child_process";
import type { CapabilityKind } from "shared/types";
import type { ExternalSearchRequest, ExternalSearchResult, GitHubSearchRequest, GitHubSearchResult } from "@/lib/capabilities/types";
import { getGitHubSearchRestrictionReason, normalizeGitHubSearchQuery } from "@/lib/capabilities/agent-reach";

export async function searchAgentReachExternal(request: ExternalSearchRequest): Promise<ExternalSearchResult> {
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

export async function searchAgentReachGitHub(request: GitHubSearchRequest): Promise<GitHubSearchResult> {
  const query = normalizeQuery(request.query || request.label);
  const restrictionReason = getGitHubSearchRestrictionReason(request.label, query);
  if (restrictionReason) {
    return {
      found: false,
      label: request.label,
      summary: restrictionReason,
      backend: "agent-reach+exa -> jina-reader:repo",
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
          kind: "tool" as CapabilityKind,
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
  const normalized = normalizeGitHubSearchQuery(value);
  return normalized.length > 0 ? normalized : "Agent Reach external search";
}

function summarize(stdout: string): string {
  const firstBlock = stdout.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  return firstBlock.length > 240 ? `${firstBlock.slice(0, 237)}...` : firstBlock;
}

function resolveMcporterCmd(): string {
  return process.env.AGENT_REACH_MCPORTER_CMD?.trim() || "mcporter";
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
