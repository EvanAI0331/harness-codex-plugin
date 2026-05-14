import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const specPath = path.join(MODULE_DIR, "../../../shared/specs/run/task-output.spec.json");

export function loadRunOutputSpec(): string {
  return fs.readFileSync(specPath, "utf8");
}

export function loadRunOutputSpecObject(): Record<string, unknown> {
  return JSON.parse(loadRunOutputSpec()) as Record<string, unknown>;
}
