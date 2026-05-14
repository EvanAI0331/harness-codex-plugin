import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(MODULE_DIR, "../../../shared/schemas/harness-blueprint.schema.json");

export function loadPlannerSchema(): string {
  return fs.readFileSync(schemaPath, "utf8");
}

export function loadPlannerSchemaObject(): Record<string, unknown> {
  return JSON.parse(loadPlannerSchema()) as Record<string, unknown>;
}
