import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(MODULE_DIR, "../../../shared/schemas/script-authoring.schema.json");

export function loadScriptAuthoringSchema(): string {
  return fs.readFileSync(schemaPath, "utf8");
}

export function loadScriptAuthoringSchemaObject(): object {
  return JSON.parse(loadScriptAuthoringSchema()) as object;
}
