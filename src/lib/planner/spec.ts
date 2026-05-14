import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const specPath = path.join(MODULE_DIR, "../../../shared/specs/planner/blueprint.spec.json");

export function loadPlannerBlueprintSpec(): string {
  return fs.readFileSync(specPath, "utf8");
}

export function loadPlannerBlueprintSpecObject(): Record<string, unknown> {
  return JSON.parse(loadPlannerBlueprintSpec()) as Record<string, unknown>;
}
