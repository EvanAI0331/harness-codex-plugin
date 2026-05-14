import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { SpecCompileResult, SpecCompilerAdapter } from "@/lib/specx/types";
import { canonicalizeSpecxContractPayload, validateSpecxContractPayload } from "@/lib/specx/contract";

export class LocalSpecCompilerAdapter implements SpecCompilerAdapter {
  async compile(source: string): Promise<SpecCompileResult> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch (error) {
      return {
        success: false,
        stdout: "",
        stderr: `contract source is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const canonical = canonicalizeSpecxContractPayload(parsed);
    const validation = validateSpecxContractPayload(canonical);
    if (!validation.ok) {
      return {
        success: false,
        stdout: "",
        stderr: validation.errors.join("; "),
      };
    }

    const compiledPayload = JSON.stringify(canonical, null, 2);
    const hash = createHash("sha256").update(compiledPayload).digest("hex").slice(0, 16);
    const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../data/specx/compiled");
    fs.mkdirSync(outDir, { recursive: true });
    const compiledPath = path.join(outDir, `${hash}.json`);
    fs.writeFileSync(compiledPath, compiledPayload, "utf8");

    return {
      success: true,
      compiledPath,
      compiledPayload,
      stdout: `specx-compiled:${compiledPath}`,
      stderr: "",
    };
  }
}
