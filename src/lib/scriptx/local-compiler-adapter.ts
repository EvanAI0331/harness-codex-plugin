import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ScriptCompilerAdapter, ScriptCompilerResult } from "@/lib/scriptx/types";
import type { AgentNode, Harness } from "shared/types";

export class LocalScriptCompilerAdapter implements ScriptCompilerAdapter {
  async compileSkill(args: { harness: Harness; agent: AgentNode; source: string; fileName: string }): Promise<ScriptCompilerResult> {
    const outPath = resolveOutputPath(args.harness.id, args.agent.id, "skill", args.fileName);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const validation = validateSkillSource(args.source);
    if (!validation.success) {
      return {
        success: false,
        compiledPath: outPath,
        compiledPayload: undefined,
        stdout: "",
        stderr: validation.stderr,
      };
    }
    fs.writeFileSync(outPath, args.source, "utf8");
    return {
      success: true,
      compiledPath: outPath,
      compiledPayload: args.source,
      stdout: "skill file written",
      stderr: "",
    };
  }

  async compileScript(args: { harness: Harness; agent: AgentNode; source: string; fileName: string }): Promise<ScriptCompilerResult> {
    const outPath = resolveOutputPath(args.harness.id, args.agent.id, "script", args.fileName);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, args.source, "utf8");
    const check = spawnSync(process.execPath, ["--check", outPath], { encoding: "utf8" });
    if (check.status !== 0) {
      return {
        success: false,
        compiledPath: outPath,
        compiledPayload: undefined,
        stdout: check.stdout || "",
        stderr: check.stderr || "node --check failed",
      };
    }
    return {
      success: true,
      compiledPath: outPath,
      compiledPayload: args.source,
      stdout: check.stdout || "script syntax verified",
      stderr: check.stderr || "",
    };
  }
}

function validateSkillSource(source: string): { success: boolean; stderr: string } {
  const requiredHeadings = ["# Skill", "## Purpose", "## Inputs", "## Outputs", "## Constraints", "## Validation"];
  const missing = requiredHeadings.filter((heading) => !source.includes(heading));
  if (missing.length > 0) {
    return {
      success: false,
      stderr: `skill source is missing required sections: ${missing.join(", ")}`,
    };
  }

  if (source.trim().length === 0) {
    return {
      success: false,
      stderr: "skill source is empty",
    };
  }

  return {
    success: true,
    stderr: "",
  };
}

function resolveOutputPath(harnessId: string, agentId: string, kind: "skill" | "script", fileName: string): string {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../data/frameworks");
  return path.join(root, harnessId, agentId, kind, path.basename(fileName));
}
