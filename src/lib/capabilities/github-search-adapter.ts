import type { CapabilityGitHubSearchAdapter, GitHubSearchRequest, GitHubSearchResult } from "@/lib/capabilities/types";
import { getGitHubSearchRestrictionReason } from "@/lib/capabilities/agent-reach";

const DEFAULT_JINA_BASE = "https://r.jina.ai/github.com";
const DEFAULT_FETCH_TIMEOUT_MS = 15000;

export class AgentReachGitHubSearchAdapter implements CapabilityGitHubSearchAdapter {
  async search(request: GitHubSearchRequest): Promise<GitHubSearchResult> {
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
    const mode = request.mode ?? inferMode(request.label, query);
    const backend = `agent-reach+exa -> jina-reader:${mode}`;

    try {
      const directRepo = parseGitHubRepoReference(query);
      const discovery = directRepo ? null : await searchExternal({
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

function normalizeQuery(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : "GitHub search";
}

function inferMode(label: string, query: string): "repo" | "code" {
  const haystack = `${label} ${query}`.toLowerCase();
  if (haystack.includes("code") || haystack.includes("snippet") || haystack.includes("implementation") || haystack.includes("file")) {
    return "code";
  }
  return "repo";
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

async function searchExternal(request: import("@/lib/capabilities/types").ExternalSearchRequest) {
  const { AgentReachExternalSearchAdapter } = await import("@/lib/capabilities/agent-reach-external-search-adapter");
  return new AgentReachExternalSearchAdapter().search(request);
}
