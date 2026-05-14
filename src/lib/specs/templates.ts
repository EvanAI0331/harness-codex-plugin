import manifest from "shared/specs/harness/manifest.json";
import roleSpec from "shared/specs/harness/role.spec.json";
import executionSpec from "shared/specs/harness/execution.spec.json";
import outputSpec from "shared/specs/harness/output.spec.json";

export const harnessSpecManifest = manifest;

export const harnessSpecTemplates = {
  role: roleSpec,
  execution: executionSpec,
  output: outputSpec,
} as const;
