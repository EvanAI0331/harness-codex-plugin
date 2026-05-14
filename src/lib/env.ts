import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(MODULE_DIR, "../../.env");

let cachedMtimeMs = 0;
let cachedEnv: Record<string, string> = {};

export function readEnvValue(primaryKey: string, fallbackKey?: string): string | undefined {
  const fileEnv = readEnvFile();
  const runtimePrimary = process.env[primaryKey];
  if (typeof runtimePrimary === "string" && runtimePrimary.trim().length > 0) {
    return runtimePrimary;
  }

  const primaryValue = fileEnv[primaryKey];
  if (typeof primaryValue === "string" && primaryValue.trim().length > 0) {
    return primaryValue;
  }

  if (!fallbackKey) {
    return undefined;
  }

  const runtimeFallback = process.env[fallbackKey];
  if (typeof runtimeFallback === "string" && runtimeFallback.trim().length > 0) {
    return runtimeFallback;
  }

  const fallbackValue = fileEnv[fallbackKey];
  return typeof fallbackValue === "string" && fallbackValue.trim().length > 0 ? fallbackValue : undefined;
}

export function readMergedEnv(): Record<string, string> {
  return {
    ...readEnvFile(),
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
  };
}

export function readLLMSettings(): {
  provider: string;
  model: string;
  baseURL: string;
  credentialRef: string;
  temperature: number;
  maxTokens: number;
} {
  return {
    provider: readEnvValue("DEFAULT_LLM_PROVIDER", "LLM_PROVIDER") ?? "openai_compatible",
    model: readEnvValue("DEFAULT_LLM_MODEL", "LLM_MODEL") ?? "qwen3.6-plus",
    baseURL: readEnvValue("DEFAULT_LLM_BASE_URL", "LLM_BASE_URL") ?? "https://api.openai.com/v1",
    credentialRef: readEnvValue("DEFAULT_LLM_CREDENTIAL_REF", "LLM_CREDENTIAL_REF") ?? "OPENAI_MAIN",
    temperature: readNumberEnvValue("DEFAULT_LLM_TEMPERATURE", "LLM_TEMPERATURE", 0.2),
    maxTokens: readNumberEnvValue("DEFAULT_LLM_MAX_TOKENS", "LLM_MAX_TOKENS", 4096),
  };
}

export function readDatabasePath(): string {
  return readEnvValue("DATABASE_PATH") ?? "./data/harness.sqlite";
}

export function readArtifactDir(): string {
  return readEnvValue("ARTIFACT_DIR") ?? "./artifacts";
}

export function readEnvFile(): Record<string, string> {
  try {
    const stat = fs.statSync(ENV_PATH);
    if (stat.mtimeMs === cachedMtimeMs) {
      return { ...cachedEnv };
    }
    const content = fs.readFileSync(ENV_PATH, "utf8");
    cachedEnv = parseEnv(content);
    cachedMtimeMs = stat.mtimeMs;
    return { ...cachedEnv };
  } catch {
    cachedEnv = {};
    cachedMtimeMs = 0;
    return {};
  }
}

export async function writeEnvFile(updates: Record<string, string | null | undefined>): Promise<Record<string, string>> {
  const current = readEnvFile();
  const next = { ...current };
  for (const [key, value] of Object.entries(updates)) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (normalized.length === 0) {
      delete next[key];
      continue;
    }
    next[key] = normalized;
  }

  const content = Object.keys(next)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${key}=${serializeEnvValue(next[key] ?? "")}`)
    .join("\n");

  await fs.promises.writeFile(ENV_PATH, `${content}\n`, "utf8");
  cachedEnv = { ...next };
  cachedMtimeMs = fs.statSync(ENV_PATH).mtimeMs;
  return { ...next };
}

function parseEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (!key) {
      continue;
    }

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }
  return env;
}

function serializeEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function readNumberEnvValue(primaryKey: string, fallbackKey: string | undefined, fallback: number): number {
  const raw = readEnvValue(primaryKey, fallbackKey);
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}
