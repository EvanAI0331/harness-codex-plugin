import type { CapabilityGenerationAdapter } from "@/lib/capabilities/types";

export class LocalCapabilityGenerationAdapter implements CapabilityGenerationAdapter {
  async generate(request: { capability: import("shared/types").CapabilityNode; goal: string }) {
    const sourceText = [
      `# Generated Capability`,
      `label: ${request.capability.label}`,
      `type: ${request.capability.capabilityType}`,
      `goal: ${request.goal}`,
      `summary: ${request.capability.summary}`,
      `source: generated`,
    ].join("\n");

    return {
      sourceText,
      stdout: "generated capability source locally",
      stderr: "",
    };
  }
}
