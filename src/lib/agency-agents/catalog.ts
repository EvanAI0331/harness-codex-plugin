import catalog from "shared/registries/agency-agents/catalog.json";
import type { CapabilityKind } from "shared/types";

export interface AgencyAgentCatalogEntry {
  role: string;
  name: string;
  description: string;
  group: string;
  path: string;
  tags: string[];
  dispatcher: boolean;
}

type CatalogEntry = AgencyAgentCatalogEntry;

const CATALOG = catalog as CatalogEntry[];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function loadAgencyAgentCatalog(): AgencyAgentCatalogEntry[] {
  return CATALOG;
}

export function selectAgencyAgentsForGoal(goal: string): AgencyAgentCatalogEntry[] {
  const goalTokens = new Set(words(goal));
  const scored = CATALOG.filter((entry) => entry.role !== "README")
    .map((entry) => ({
      entry,
      score: scoreEntry(entry, goalTokens),
    }))
    .sort((left, right) => {
      if (left.entry.dispatcher !== right.entry.dispatcher) {
        return left.entry.dispatcher ? -1 : 1;
      }
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      const groupCompare = left.entry.group.localeCompare(right.entry.group);
      if (groupCompare !== 0) {
        return groupCompare;
      }
      return left.entry.role.localeCompare(right.entry.role);
    });

  const selected: AgencyAgentCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const item of scored) {
    if (seen.has(item.entry.role)) {
      continue;
    }
    if (!item.entry.dispatcher && !isRelevantGroup(item.entry.group, goalTokens, item.score)) {
      continue;
    }
    selected.push(item.entry);
    seen.add(item.entry.role);
  }

  if (!selected.some((entry) => entry.dispatcher)) {
    const dispatcher = CATALOG.find((entry) => entry.dispatcher);
    if (dispatcher) {
      selected.unshift(dispatcher);
    }
  }

  return selected;
}

export function selectAgencyExpertsForGoal(goal: string): AgencyAgentCatalogEntry[] {
  return selectAgencyAgentsForGoal(goal).filter((entry) => !entry.dispatcher);
}

export function findAgencyAgentByRole(role: string): AgencyAgentCatalogEntry | undefined {
  return CATALOG.find((entry) => entry.role === role);
}

function scoreEntry(entry: AgencyAgentCatalogEntry, goalTokens: Set<string>): number {
  const tokens = new Set([...entry.tags, ...words(entry.description), ...words(entry.name), entry.group]);
  let score = 0;
  for (const token of tokens) {
    if (goalTokens.has(token)) {
      score += 3;
    }
  }

  const groupBoosts: Record<string, number> = {
    specialized: 6,
    engineering: 5,
    "project-management": 4,
    testing: 4,
    product: 3,
    design: 2,
    academic: 1,
    support: 1,
  };
  score += groupBoosts[entry.group] ?? 0;

  if (entry.role.includes("architect")) {
    score += 2;
  }
  if (entry.role.includes("orchestrator")) {
    score += 5;
  }
  if (entry.role.includes("writer") || entry.role.includes("generator")) {
    score += 2;
  }

  return score;
}

function isRelevantGroup(group: string, goalTokens: Set<string>, score: number): boolean {
  if (score > 0) {
    return true;
  }
  return goalTokens.size > 0 && ["engineering", "project-management", "testing", "specialized", "product", "design"].includes(group);
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}
