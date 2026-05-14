import type { CompiledSpecPack, HarnessBlueprint, RequirementIntake } from "shared/types";

export function validateCompiledSpecPack(_pack: CompiledSpecPack, _blueprint: HarnessBlueprint, _intake: RequirementIntake): { ok: boolean; issues: string[] } {
  throw new Error("Legacy spec pack validator is disabled. Use the SpecX contract compile chain.");
}
