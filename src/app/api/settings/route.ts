import { NextResponse } from "next/server";
import { readMergedEnv, writeEnvFile } from "@/lib/env";

export async function GET() {
  const env = readMergedEnv();
  return NextResponse.json({
    DEFAULT_LLM_PROVIDER: env.DEFAULT_LLM_PROVIDER ?? env.LLM_PROVIDER ?? "openai_compatible",
    DEFAULT_LLM_MODEL: env.DEFAULT_LLM_MODEL ?? env.LLM_MODEL ?? "qwen3.6-plus",
    DEFAULT_LLM_BASE_URL: env.DEFAULT_LLM_BASE_URL ?? env.LLM_BASE_URL ?? "https://api.openai.com/v1",
    DEFAULT_LLM_CREDENTIAL_REF: env.DEFAULT_LLM_CREDENTIAL_REF ?? env.LLM_CREDENTIAL_REF ?? "OPENAI_MAIN",
    DEFAULT_LLM_TEMPERATURE: env.DEFAULT_LLM_TEMPERATURE ?? env.LLM_TEMPERATURE ?? "0.2",
    DEFAULT_LLM_MAX_TOKENS: env.DEFAULT_LLM_MAX_TOKENS ?? env.LLM_MAX_TOKENS ?? "4096",
    LLM_REQUEST_TIMEOUT_MS: env.LLM_REQUEST_TIMEOUT_MS ?? "120000",
    GITHUB_SEARCH_ENABLED: env.GITHUB_SEARCH_ENABLED ?? "false",
    GITHUB_USERNAME: env.GITHUB_USERNAME ?? "",
    GITHUB_PASSWORD_SET: Boolean(env.GITHUB_PASSWORD && env.GITHUB_PASSWORD.trim().length > 0),
    AGENT_REACH_ENABLED: env.AGENT_REACH_ENABLED ?? "false",
    DEMO_MODE: env.DEMO_MODE ?? "false",
    SPECX_MODE: env.SPECX_MODE ?? "local",
  });
}

export async function PATCH(request: Request) {
  if (process.env.NODE_ENV === "production" && process.env.LOCAL_SETTINGS_WRITE_ENABLED !== "true") {
    return NextResponse.json({ error: "Settings write is disabled in production", code: "settings_write_disabled" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body.", code: "invalid_json" }, { status: 400 });
  }

  const nextEnv = await writeEnvFile({
    DEFAULT_LLM_PROVIDER: stringOrEmpty(body.DEFAULT_LLM_PROVIDER ?? body.LLM_PROVIDER),
    DEFAULT_LLM_MODEL: stringOrEmpty(body.DEFAULT_LLM_MODEL ?? body.LLM_MODEL),
    DEFAULT_LLM_BASE_URL: stringOrEmpty(body.DEFAULT_LLM_BASE_URL ?? body.LLM_BASE_URL),
    DEFAULT_LLM_CREDENTIAL_REF: stringOrEmpty(body.DEFAULT_LLM_CREDENTIAL_REF ?? body.LLM_CREDENTIAL_REF),
    DEFAULT_LLM_TEMPERATURE: stringOrEmpty(body.DEFAULT_LLM_TEMPERATURE ?? body.LLM_TEMPERATURE),
    DEFAULT_LLM_MAX_TOKENS: stringOrEmpty(body.DEFAULT_LLM_MAX_TOKENS ?? body.LLM_MAX_TOKENS),
    LLM_REQUEST_TIMEOUT_MS: stringOrEmpty(body.LLM_REQUEST_TIMEOUT_MS),
    GITHUB_USERNAME: stringOrEmpty(body.GITHUB_USERNAME),
    GITHUB_PASSWORD: stringOrEmpty(body.GITHUB_PASSWORD),
    AGENT_REACH_ENABLED: stringOrEmpty(body.AGENT_REACH_ENABLED),
    GITHUB_SEARCH_ENABLED: stringOrEmpty(body.GITHUB_SEARCH_ENABLED),
    DEMO_MODE: stringOrEmpty(body.DEMO_MODE),
    SPECX_MODE: stringOrEmpty(body.SPECX_MODE),
    LLM_PROVIDER: null,
    LLM_MODEL: null,
    LLM_BASE_URL: null,
    LLM_CREDENTIAL_REF: null,
    LLM_TEMPERATURE: null,
    LLM_MAX_TOKENS: null,
  });

  syncProcessEnv(nextEnv);

  return NextResponse.json({
    ok: true,
    settings: {
      DEFAULT_LLM_PROVIDER: nextEnv.DEFAULT_LLM_PROVIDER ?? "",
      DEFAULT_LLM_MODEL: nextEnv.DEFAULT_LLM_MODEL ?? "",
      DEFAULT_LLM_BASE_URL: nextEnv.DEFAULT_LLM_BASE_URL ?? "",
      DEFAULT_LLM_CREDENTIAL_REF: nextEnv.DEFAULT_LLM_CREDENTIAL_REF ?? "",
      DEFAULT_LLM_TEMPERATURE: nextEnv.DEFAULT_LLM_TEMPERATURE ?? "",
      DEFAULT_LLM_MAX_TOKENS: nextEnv.DEFAULT_LLM_MAX_TOKENS ?? "",
      LLM_REQUEST_TIMEOUT_MS: nextEnv.LLM_REQUEST_TIMEOUT_MS ?? "",
      GITHUB_SEARCH_ENABLED: nextEnv.GITHUB_SEARCH_ENABLED ?? "",
      GITHUB_USERNAME: nextEnv.GITHUB_USERNAME ?? "",
      GITHUB_PASSWORD_SET: Boolean(nextEnv.GITHUB_PASSWORD && nextEnv.GITHUB_PASSWORD.trim().length > 0),
      AGENT_REACH_ENABLED: nextEnv.AGENT_REACH_ENABLED ?? "",
      DEMO_MODE: nextEnv.DEMO_MODE ?? "",
      SPECX_MODE: nextEnv.SPECX_MODE ?? "",
    },
  });
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function syncProcessEnv(env: Record<string, string>): void {
  for (const key of [
    "DEFAULT_LLM_PROVIDER",
    "DEFAULT_LLM_MODEL",
    "DEFAULT_LLM_BASE_URL",
    "DEFAULT_LLM_CREDENTIAL_REF",
    "DEFAULT_LLM_TEMPERATURE",
    "DEFAULT_LLM_MAX_TOKENS",
    "LLM_REQUEST_TIMEOUT_MS",
    "LLM_PROVIDER",
    "LLM_MODEL",
    "LLM_BASE_URL",
    "LLM_CREDENTIAL_REF",
    "LLM_TEMPERATURE",
    "LLM_MAX_TOKENS",
    "GITHUB_USERNAME",
    "GITHUB_PASSWORD",
    "AGENT_REACH_ENABLED",
    "GITHUB_SEARCH_ENABLED",
    "DEMO_MODE",
    "SPECX_MODE",
  ]) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
}
