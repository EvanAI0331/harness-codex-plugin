const EXTERNAL_SEARCH_LABELS = new Set([
  "agent reach external search",
  "external search",
  "web search",
  "internet search",
]);

const GITHUB_SEARCH_LABELS = new Set([
  "agent reach github search",
  "github search",
  "repo search",
  "repository search",
  "code search",
  "skill search",
  "tool search",
  "github repo search",
]);

const GITHUB_SEARCH_ASSET_CUES = [
  "skill",
  "tool",
  "library",
  "package",
  "module",
  "repository",
  "repo",
  "codebase",
  "source",
  "mcp",
  "plugin",
  "extension",
  "adapter",
  "starter",
  "template",
  "boilerplate",
  "sdk",
  "cli",
  "download",
  "install",
  "clone",
];

const GITHUB_SEARCH_INFO_CUES = [
  "what is",
  "what are",
  "who is",
  "who are",
  "why is",
  "why are",
  "how does",
  "how do",
  "how to",
  "explain",
  "meaning",
  "definition",
  "latest",
  "news",
  "compare",
  "comparison",
  "overview",
  "summary",
  "tutorial",
  "review",
  "research",
  "best",
  "recommend",
  "should i",
];

export function normalizeCapabilityLabel(value: string): string {
  return value.trim().toLowerCase();
}

export function isAgentReachExternalSearchCapability(label: string): boolean {
  return EXTERNAL_SEARCH_LABELS.has(normalizeCapabilityLabel(label));
}

export function isAgentReachGitHubSearchCapability(label: string): boolean {
  return GITHUB_SEARCH_LABELS.has(normalizeCapabilityLabel(label));
}

export function isAgentReachSearchCapability(label: string): boolean {
  return isAgentReachExternalSearchCapability(label) || isAgentReachGitHubSearchCapability(label);
}

export function normalizeGitHubSearchQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function isGitHubAssetLookupRequest(label: string, query: string): boolean {
  const normalizedQuery = normalizeGitHubSearchQuery(query);
  if (normalizedQuery.length === 0) {
    return false;
  }

  if (parseGitHubRepoReference(normalizedQuery) !== null) {
    return true;
  }

  const haystack = `${label} ${normalizedQuery}`.toLowerCase();
  const hasAssetCue = GITHUB_SEARCH_ASSET_CUES.some((cue) => haystack.includes(cue));
  const hasInfoCue = GITHUB_SEARCH_INFO_CUES.some((cue) => haystack.includes(cue));
  return hasAssetCue && !hasInfoCue;
}

export function getGitHubSearchRestrictionReason(label: string, query: string): string | null {
  const normalizedQuery = normalizeGitHubSearchQuery(query);
  if (normalizedQuery.length === 0) {
    return "GitHub Search requires a query for a skill, tool, library, or repository reference.";
  }

  if (parseGitHubRepoReference(normalizedQuery) !== null) {
    return null;
  }

  const haystack = `${label} ${normalizedQuery}`.toLowerCase();
  const hasAssetCue = GITHUB_SEARCH_ASSET_CUES.some((cue) => haystack.includes(cue));
  const hasInfoCue = GITHUB_SEARCH_INFO_CUES.some((cue) => haystack.includes(cue));

  if (!hasAssetCue || hasInfoCue) {
    return "GitHub Search is restricted to locating or downloading skills, tools, libraries, and direct repository references. It cannot be used for general information search.";
  }

  return null;
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
