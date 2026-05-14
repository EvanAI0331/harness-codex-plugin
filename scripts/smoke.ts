import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

type JsonRecord = Record<string, unknown>;

const PORT = Number(process.env.SMOKE_PORT ?? 3107);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const WORKSPACE_TMP = path.join(process.cwd(), "tmp", "smoke");
const DB_PATH = path.join(WORKSPACE_TMP, "harness.sqlite");
const ARTIFACT_DIR = path.join(WORKSPACE_TMP, "artifacts");
const SERVER_COMMAND = process.env.SMOKE_SERVER_COMMAND === "start" ? "start" : "dev";

async function main(): Promise<void> {
  cleanupWorkspace();
  const server = spawn(
    "npm",
    ["run", SERVER_COMMAND, "--", "--hostname", "127.0.0.1", "--port", String(PORT)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CI: "1",
        DEMO_MODE: "true",
        DATABASE_PATH: relativeWorkspacePath(DB_PATH),
        ARTIFACT_DIR: relativeWorkspacePath(ARTIFACT_DIR),
        DEFAULT_LLM_PROVIDER: "openai_compatible",
        DEFAULT_LLM_MODEL: "qwen3.6-plus",
        DEFAULT_LLM_BASE_URL: "https://api.openai.com/v1",
        DEFAULT_LLM_CREDENTIAL_REF: "OPENAI_MAIN",
        DEFAULT_LLM_TEMPERATURE: "0.2",
        DEFAULT_LLM_MAX_TOKENS: "4096",
        LLM_REQUEST_TIMEOUT_MS: "120000",
        OPENAI_MAIN_API_KEY: "demo-openai-key",
        AGENT_REACH_ENABLED: "false",
        AGENT_REACH_MCPORTER_CMD: "mcporter",
        GITHUB_SEARCH_ENABLED: "false",
        SPECX_MODE: "mock",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    },
  );

  const logs: string[] = [];
  server.stdout.on("data", (chunk) => {
    logs.push(chunk.toString("utf8"));
  });
  server.stderr.on("data", (chunk) => {
    logs.push(chunk.toString("utf8"));
  });

  try {
    await waitForServer();
    const settings = await fetchJson(`${BASE_URL}/api/settings`);
    assertNonEmpty(settings.DEFAULT_LLM_PROVIDER, "settings provider is non-empty");
    assertNonEmpty(settings.DEFAULT_LLM_MODEL, "settings model is non-empty");
    assert(!Object.prototype.hasOwnProperty.call(settings, "GITHUB_PASSWORD"), "settings API does not return GitHub password");
    for (const forbiddenSecretKey of ["OPENAI_API_KEY", "OPENAI_MAIN_API_KEY", "ANTHROPIC_API_KEY", "GITHUB_PASSWORD"]) {
      assert(!Object.prototype.hasOwnProperty.call(settings, forbiddenSecretKey), `settings API does not return ${forbiddenSecretKey}`);
    }
    const goal = "Audit a repository, explain its architecture, verify execution boundaries, and summarize artifact-driven runtime readiness.";
    const harness = await postJson<HarnessRecord>(`${BASE_URL}/api/harness/create`, {
      name: "Repository Audit Harness",
      goal,
      mainModel: modelConfigFromSettings(settings),
      auxiliaryModel: auxiliaryModelFromSettings(settings),
      codingAgentModel: codingModelFromSettings(settings),
      capabilityPolicy: {
        allowGithubSearch: true,
        allowAutoGenerateSkill: true,
        allowAutoGenerateScript: true,
      },
    });

    assert(typeof harness.id === "string", "create API returned harness id");
    assert(fs.existsSync(DB_PATH), "sqlite database file exists");
    console.log(`[smoke] create API ok -> ${harness.id}`);

    const build = await postJson<HarnessRecord>(`${BASE_URL}/api/harness/${String(harness.id)}/build`, {
      goal,
      mainModel: modelConfigFromSettings(settings),
      auxiliaryModel: auxiliaryModelFromSettings(settings),
      codingAgentModel: codingModelFromSettings(settings),
      capabilityPolicy: {
        allowGithubSearch: true,
        allowAutoGenerateSkill: true,
        allowAutoGenerateScript: true,
      },
    });

    assert(typeof build.status === "string", "build API returned harness status");
    console.log(`[smoke] build API ok -> ${String(build.status)}`);

    const run = await postJson<RunStartRecord>(`${BASE_URL}/api/harness/${String(harness.id)}/run`, {
      taskInstruction: "Audit the repository architecture and summarize runtime readiness with concrete deliverables.",
      parameters: [
        { key: "demo", value: "true" },
      ],
      policy: {
        allowGithubImport: false,
        allowScriptGeneration: true,
        humanApprovalRequired: false,
      },
    });

    assert(typeof run.run?.id === "string", "run API returned run id");
    const runId = String(run.run.id);
    console.log(`[smoke] run API ok -> ${runId}`);

    const output = await waitForFinalOutput(runId);
    assert(output.status === "completed" || output.run?.status === "completed", "output API reports completed run");
    assert(output.finalDeliverable, "final deliverable exists");
    console.log(`[smoke] output API ok -> ${String(output.finalDeliverable.id)}`);

    await waitForRunPage(runId);

    const artifacts = await fetchJson(`${BASE_URL}/api/runs/${runId}/artifacts`);
    assert(Array.isArray(artifacts.artifacts), "artifacts API returned list");
    assert(artifacts.artifacts.length > 0, "artifacts API returned non-empty artifacts");
    console.log(`[smoke] artifacts API ok -> ${artifacts.artifacts.length} artifacts`);

    console.log("[smoke] PASS");
  } catch (error) {
    console.error("[smoke] FAIL");
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    if (logs.length > 0) {
      console.error("[smoke] server logs:");
      console.error(logs.join(""));
    }
    process.exitCode = 1;
  } finally {
    await stopServer(server);
  }
}

function cleanupWorkspace(): void {
  fs.rmSync(WORKSPACE_TMP, { recursive: true, force: true });
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
}

async function waitForServer(timeoutMs = 120000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${BASE_URL}/api/settings`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the server is ready.
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for dev server at ${BASE_URL}`);
}

async function waitForFinalOutput(runId: string, timeoutMs = 120000): Promise<RunOutputRecord> {
  const startedAt = Date.now();
  let lastStatus = "not requested";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const output = await fetchJson<RunOutputRecord>(`${BASE_URL}/api/runs/${runId}/output`);
      lastStatus = String(output.status ?? output.run?.status ?? "response_without_status");
      if (output.finalDeliverable) {
        return output;
      }
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : String(error);
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for final deliverable for run ${runId}: ${lastStatus}`);
}

async function waitForRunPage(runId: string, timeoutMs = 30000): Promise<void> {
  const startedAt = Date.now();
  let lastStatus = "not requested";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${BASE_URL}/runs/${runId}`);
      lastStatus = `${response.status} ${response.statusText}`;
      if (response.ok) {
        return;
      }
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : String(error);
    }
    await sleep(1000);
  }
  throw new Error(`/runs/${runId} page did not become available: ${lastStatus}`);
}

async function fetchJson<T extends JsonRecord>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

async function postJson<T extends JsonRecord>(url: string, body: JsonRecord): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

function modelConfigFromSettings(settings: JsonRecord): JsonRecord {
  return {
    provider: String(settings.DEFAULT_LLM_PROVIDER ?? "openai_compatible"),
    model: String(settings.DEFAULT_LLM_MODEL ?? "qwen3.6-plus"),
    baseURL: String(settings.DEFAULT_LLM_BASE_URL ?? "https://api.openai.com/v1"),
    credentialRef: String(settings.DEFAULT_LLM_CREDENTIAL_REF ?? "OPENAI_MAIN"),
    temperature: Number(settings.DEFAULT_LLM_TEMPERATURE ?? 0.2),
    maxTokens: Number(settings.DEFAULT_LLM_MAX_TOKENS ?? 4096),
  };
}

function auxiliaryModelFromSettings(settings: JsonRecord): JsonRecord {
  return {
    ...modelConfigFromSettings(settings),
    temperature: 0.1,
    maxTokens: 2048,
  };
}

function codingModelFromSettings(settings: JsonRecord): JsonRecord {
  return {
    ...modelConfigFromSettings(settings),
    model: "qwen3-coder-plus",
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

interface HarnessRecord extends JsonRecord {
  id: string;
  intake?: {
    goal?: string;
  };
}

interface RunStartRecord extends JsonRecord {
  run: {
    id: string;
  };
}

interface RunOutputRecord extends JsonRecord {
  status?: string;
  run?: {
    status?: string;
  };
  finalDeliverable?: {
    id: string;
  } | null;
}

function assertNonEmpty(value: unknown, message: string): asserts value {
  assert(typeof value === "string" && value.trim().length > 0, message);
}

function relativeWorkspacePath(absolutePath: string): string {
  return path.relative(process.cwd(), absolutePath) || ".";
}

async function onceExit(child: ReturnType<typeof spawn>): Promise<void> {
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
  });
}

async function stopServer(child: ReturnType<typeof spawn>): Promise<void> {
  signalServer(child, "SIGTERM");
  await Promise.race([onceExit(child), sleep(5000)]);
  if (child.exitCode === null) {
    signalServer(child, "SIGKILL");
    await Promise.race([onceExit(child), sleep(5000)]);
  }
}

function signalServer(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  if (child.exitCode !== null) {
    return;
  }
  try {
    if (process.platform !== "win32" && child.pid) {
      process.kill(-child.pid, signal);
      return;
    }
    child.kill(signal);
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : undefined;
    if (code !== "ESRCH") {
      throw error;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main();
