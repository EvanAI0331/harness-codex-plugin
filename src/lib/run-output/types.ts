import type { ArtifactReference, Harness, HarnessEvent, RunArtifact, SpecArtifact, TaskInstance } from "shared/types";

export interface RunOutputEvidence {
  nodeId: string;
  nodeName: string;
  action: string;
  summary: string;
  timestamp: string;
}

export interface RunOutputSection {
  title: string;
  bullets: string[];
}

export interface RunOutputResult {
  runId: string;
  harnessId: string;
  taskInstruction: string;
  title: string;
  summary: string;
  status: "success" | "partial" | "failed";
  reportMarkdown: string;
  sections: RunOutputSection[];
  evidence: RunOutputEvidence[];
  deliverables: string[];
  risks: string[];
  nextSteps: string[];
}

export interface RunOutputArtifacts {
  markdown: SpecArtifact;
  json: SpecArtifact;
  prompt: SpecArtifact;
  schema: SpecArtifact;
  raw: SpecArtifact;
}

export interface RunOutputGenerationInput {
  harness: Harness;
  runId: string;
  taskInstruction: string;
  taskInstance: TaskInstance;
  finalDeliverable: RunArtifact;
  runtimeEvents: HarnessEvent[];
  runtimeSteps: Array<{
    nodeId: string;
    nodeName: string;
    action: string;
    status: "completed" | "failed" | "running";
    summary: string;
    timestamp: string;
  }>;
  artifactRefs?: ArtifactReference[];
}

export interface RunOutputGenerationOutcome {
  result: RunOutputResult;
  artifacts: SpecArtifact[];
  artifactMap: RunOutputArtifacts;
  events: HarnessEvent[];
}
