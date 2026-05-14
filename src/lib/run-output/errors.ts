export class RunOutputGenerationError extends Error {
  constructor(
    message: string,
    public readonly artifacts: Array<{ id: string; title: string; specType: string }>,
  ) {
    super(message);
    this.name = "RunOutputGenerationError";
  }
}
