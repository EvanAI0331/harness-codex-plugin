import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(MODULE_DIR, "../../../shared/schemas/run-task-output.schema.json");

export function loadRunOutputSchema(): string {
  return fs.readFileSync(schemaPath, "utf8");
}

export function loadRunOutputSchemaObject(): Record<string, unknown> {
  return JSON.parse(loadRunOutputSchema()) as Record<string, unknown>;
}
