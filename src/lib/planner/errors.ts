import type { SpecArtifact } from "shared/types";

export class PlannerGenerationError extends Error {
  constructor(
    message: string,
    public readonly artifacts: SpecArtifact[],
  ) {
    super(message);
    this.name = "PlannerGenerationError";
  }
}
