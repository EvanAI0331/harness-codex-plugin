import type { CapabilityKind, CapabilityNode, CapabilitySource } from "shared/types";

export type { CapabilityKind, CapabilityNode, CapabilitySource } from "shared/types";

export interface CapabilityRegistryEntry {
  type: CapabilityKind;
  source: CapabilitySource;
  label: string;
  summary: string;
  aliases?: string[];
}

export interface CapabilityResolutionResult {
  capability: CapabilityNode;
  artifacts: import("shared/types").SpecArtifact[];
}

export interface ExternalSearchRequest {
  label: string;
  kind: CapabilityKind;
  goal: string;
  query?: string;
  mode?: "web" | "code";
}

export interface ExternalSearchResult {
  found: boolean;
  source?: string;
  summary?: string;
  label?: string;
  stdout?: string;
  stderr?: string;
  backend?: string;
  query?: string;
  mode?: "web" | "code" | "repo";
}

export interface CapabilityExternalSearchAdapter {
  search(request: ExternalSearchRequest): Promise<ExternalSearchResult>;
}

export interface GitHubSearchRequest {
  label: string;
  query: string;
  mode?: "repo" | "code";
  limit?: number;
}

export interface GitHubSearchResult extends ExternalSearchResult {
  resultCount?: number;
}

export interface CapabilityGitHubSearchAdapter {
  search(request: GitHubSearchRequest): Promise<GitHubSearchResult>;
}

export interface CapabilityGenerationAdapter {
  generate(request: { capability: CapabilityNode; goal: string }): Promise<{ sourceText: string; stdout: string; stderr: string }>;
}

export type CapabilityGithubSearchAdapter = CapabilityGitHubSearchAdapter;
