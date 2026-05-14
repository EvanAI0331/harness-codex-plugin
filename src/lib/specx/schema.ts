import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(MODULE_DIR, "../../../shared/schemas/specx-contract.schema.json");
const specPath = path.join(MODULE_DIR, "../../../shared/specs/specx/harness-contract.spec.json");

export function loadSpecxContractSchema(): string {
  return fs.readFileSync(schemaPath, "utf8");
}

export function loadSpecxContractSchemaObject(): Record<string, unknown> {
  return JSON.parse(loadSpecxContractSchema()) as Record<string, unknown>;
}

export function loadSpecxContractSpec(): string {
  return fs.readFileSync(specPath, "utf8");
}

export function loadSpecxContractSpecObject(): Record<string, unknown> {
  return JSON.parse(loadSpecxContractSpec()) as Record<string, unknown>;
}
