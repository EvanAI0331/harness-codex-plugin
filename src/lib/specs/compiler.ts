import type { CompiledSpecPack, HarnessBlueprint, RequirementIntake } from "shared/types";

export function compileHarnessSpecs(_blueprint: HarnessBlueprint, _intake: RequirementIntake): CompiledSpecPack {
  throw new Error("Legacy spec pack compiler is disabled. Use the SpecX contract compile chain.");
}
