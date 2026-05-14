import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const specDir = path.join(MODULE_DIR, "../../../shared/specs/script_authoring");

export function loadScriptAuthoringManifest(): string {
  return fs.readFileSync(path.join(specDir, "manifest.json"), "utf8");
}

export function loadScriptAuthoringRoleSpec(): string {
  return fs.readFileSync(path.join(specDir, "role.spec.json"), "utf8");
}

export function loadScriptAuthoringExecutionSpec(): string {
  return fs.readFileSync(path.join(specDir, "execution.spec.json"), "utf8");
}

export function loadScriptAuthoringOutputSpec(): string {
  return fs.readFileSync(path.join(specDir, "output.spec.json"), "utf8");
}
