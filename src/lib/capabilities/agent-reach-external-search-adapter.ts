import { spawnSync } from "node:child_process";
import type {
  CapabilityExternalSearchAdapter,
  ExternalSearchRequest,
  ExternalSearchResult,
} from "@/lib/capabilities/types";

export class AgentReachExternalSearchAdapter implements CapabilityExternalSearchAdapter {
  async search(request: ExternalSearchRequest): Promise<ExternalSearchResult> {
    const backend = "agent-reach+exa";
    const query = normalizeQuery(request.query || request.goal || request.label);
    const mode = inferMode(request.label, query);
    const call = buildCall(mode, query);
    const mcporter = resolveMcporterCmd();
    const envCheck = this.checkEnvironment();

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

  private checkEnvironment(): { available: boolean; message: string; stdout: string; stderr: string } {
    const mcporter = resolveMcporterCmd();

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
