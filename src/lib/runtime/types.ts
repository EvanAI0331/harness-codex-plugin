import type {
  AgentNode,
  ArtifactReference,
  CapabilityNode,
  Harness,
  RuntimeContractBinding,
  HarnessEvent,
  RunArtifact,
  RunPolicy,
  SpecArtifact,
  TaskInstance,
  AgentRuntimeDecision,
} from "shared/types";
import type { RunOutputGenerationOutcome } from "@/lib/run-output/types";

export interface RuntimeExecutionStep {
  nodeId: string;
  nodeName: string;
  action: string;
  status: "running" | "completed" | "failed";
  summary: string;
  timestamp: string;
}

export interface RuntimeStepRequest {
  harness: Harness;
  agent: AgentNode;
  availableCapabilities: CapabilityNode[];
  dependencyStatuses: Array<{ nodeId: string; status: AgentNode["status"] }>;
  binding: RuntimeContractBinding;
  outputContract?: unknown;
  contractArtifact?: SpecArtifact;
  taskInstance: TaskInstance;
  runPolicy: RunPolicy;
  runtimeEvents: HarnessEvent[];
  runtimeSteps: RuntimeExecutionStep[];
  upstreamArtifacts: RunArtifact[];
  artifactRefs?: ArtifactReference[];
  runId?: string;
  taskInstruction?: string;
}

export interface RuntimeStepResult {
  success: boolean;
  action: string;
  summary: string;
  decision?: AgentRuntimeDecision;
  error?: string;
  toolCalls?: Array<{
    capabilityId?: string;
    capabilityLabel?: string;
    toolName: string;
    query: string;
    backend?: string;
    mode?: string;
    summary: string;
    stdout?: string;
    stderr?: string;
  }>;
  artifacts?: SpecArtifact[];
  runOutput?: RunOutputGenerationOutcome;
}

export interface RuntimeExecutorAdapter {
  execute(request: RuntimeStepRequest): Promise<RuntimeStepResult>;
}

export interface RuntimeToolRequest {
  harness: Harness;
  agent: AgentNode;
  capability: CapabilityNode;
  query: string;
  runId?: string;
  taskInstruction?: string;
}

export interface RuntimeToolResult {
  success: boolean;
  toolName: string;
  query: string;
  backend?: string;
  mode?: string;
  summary: string;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export interface RuntimeToolAdapter {
  invoke(request: RuntimeToolRequest): Promise<RuntimeToolResult>;
}
