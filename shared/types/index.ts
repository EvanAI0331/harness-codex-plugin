export type HarnessStatus = "draft" | "draft_ready" | "dirty" | "building" | "ready" | "failed";
export type RunStatus = "idle" | "running" | "paused" | "completed" | "failed" | "cancelled";

export type NodeType = "harness" | "agent" | "spec" | "capability";

export type EventChannel = "system" | "build" | "runtime";

export type EventPhase = "intake" | "planning" | "compose" | "resolve" | "spec-compile" | "script-authoring" | "assemble" | "build" | "runtime" | "task-output";

export interface ModelConfig {
  provider: string;
  model: string;
  baseURL?: string;
  credentialRef?: string;
  temperature: number;
  maxTokens: number;
}

export interface CapabilityPolicy {
  allowGithubSearch: boolean;
  allowAutoGenerateSkill: boolean;
  allowAutoGenerateScript: boolean;
}

export interface RequirementIntake {
  goal: string;
  mainModel: ModelConfig;
  auxiliaryModel: ModelConfig;
  codingAgentModel: ModelConfig;
  capabilityPolicy: CapabilityPolicy;
}

export interface PlannerInput extends RequirementIntake {}

export type PlannerSegment = "dispatch" | "framework" | "experts" | "specs" | "capabilities" | "edges" | "deliverable";

export interface PlannerProgressUpdate {
  segment: PlannerSegment;
  status: "started" | "completed";
  summary?: string;
  selectedPlanningAgentRole?: string;
  inputRequirements?: string[];
  artifactCount?: number;
}

export interface SpecArtifact {
  id: string;
  specType:
    | "role"
    | "execution"
    | "output"
    | "skill.source"
    | "skill.compiled"
    | "script.source"
    | "script.compiled"
    | "requirement"
    | "planner.spec"
    | "planner.dispatch"
    | "planner.overview"
    | "planner.agents"
    | "planner.specs"
    | "planner.capabilities"
    | "planner.edges"
    | "planner.prompt"
  | "planner.schema"
  | "planner.raw"
  | "planner.blueprint"
  | "run.output"
  | "run.report"
  | "run.prompt"
  | "run.schema"
  | "run.raw"
  | "task.instance"
  | "agent.plan"
  | "agent.output"
  | "tool.result"
  | "script.execution"
  | "final.deliverable"
  | "final.report"
  | "capability.resolution"
  | "spec.contract.source"
  | "spec.contract.compiled"
  | "spec.contract.backtest"
  | "spec.source"
  | "spec.compiled";
  title: string;
  kind: "role" | "execution" | "output" | "skill" | "script" | "requirement" | "planner" | "spec" | "capability" | "contract" | "run";
  artifactType: "source" | "compiled" | "raw" | "prompt" | "plan" | "report" | "contract" | "backtest";
  content: string;
  contentJson?: unknown;
  contentHash: string;
  sourceTemplateId: string;
  compiledFrom: string[];
  ownerType: "harness" | "agent" | "capability" | "planner" | "system" | "run";
  ownerId?: string;
  sourceText?: string;
  compileStatus?: "pending" | "success" | "failure" | "not-applicable";
  backtestStatus?: "pending" | "success" | "failure" | "not-applicable";
  compiledPath?: string;
  compiledPayload?: string;
  stdout?: string;
  stderr?: string;
  backtestPayload?: string;
  backtestStdout?: string;
  backtestStderr?: string;
  schemaName?: string;
  compilerName?: string;
  contractVersion?: string;
  runtimeBinding?: RuntimeContractBinding;
  createdAt: string;
  updatedAt: string;
}

export interface AgentNode {
  id: string;
  nodeType: "agent";
  label: string;
  role: string;
  agentKind: "dispatcher" | "expert" | "coding";
  executionOrder: number;
  catalogGroup: string;
  model: ModelConfig;
  status: "idle" | "queued" | "ready" | "running" | "completed" | "blocked" | "failed";
  specArtifactIds: string[];
  skillArtifactIds: string[];
  scriptArtifactIds: string[];
  capabilityIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type CapabilityKind = "tool" | "skill" | "script";
export type CapabilitySource = "builtin" | "local" | "github" | "generated" | "unresolved";
export type CapabilityStatus = "unresolved" | "resolved" | "missing" | "ready" | "blocked" | "failed";

export interface CapabilityNode {
  id: string;
  nodeType: "capability";
  label: string;
  summary: string;
  capabilityType: CapabilityKind;
  source: CapabilitySource;
  status: CapabilityStatus;
  specArtifactIds: string[];
  policyFlags: CapabilityPolicy;
  registryKey?: string;
  resolutionReason?: string;
  resolverName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeContractBinding {
  contractArtifactId: string;
  sourceArtifactId: string;
  compiledArtifactId: string;
  backtestArtifactId?: string;
  contractVersion: string;
  entry: boolean;
  dependencyIds: string[];
  requiredCapabilities: string[];
  requiredArtifacts: string[];
  outputFields: string[];
  runtimeOrder: number;
  sourceHash: string;
  compiledHash?: string;
  backtestStatus: "pending" | "success" | "failure";
}

export interface HarnessEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  relation: string;
}

export interface BlueprintSpec {
  id: string;
  nodeType: "spec";
  specType: "agent";
  agentId: string;
  title: string;
  summary: string;
  artifactId: string;
  specArtifactIds: string[];
  compileStatus?: "pending" | "success" | "failure";
  compiledPath?: string;
  stdout?: string;
  stderr?: string;
}

export interface BlueprintHarnessNode {
  id: string;
  nodeType: "harness";
  label: string;
  summary: string;
  status: HarnessStatus;
}

export interface HarnessBlueprint {
  summary: string;
  harness: BlueprintHarnessNode;
  agents: AgentNode[];
  specs: BlueprintSpec[];
  capabilities: CapabilityNode[];
  edges: HarnessEdge[];
}

export interface HarnessEvent {
  id: string;
  harnessId: string;
  channel: EventChannel;
  phase: EventPhase;
  kind: string;
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface Harness {
  id: string;
  name: string;
  status: HarnessStatus;
  intake: RequirementIntake;
  blueprint: HarnessBlueprint | null;
  specArtifacts: SpecArtifact[];
  agentNodes: AgentNode[];
  capabilityNodes: CapabilityNode[];
  edges: HarnessEdge[];
  createdAt: string;
  updatedAt: string;
  events: HarnessEvent[];
}

export interface CreateHarnessRequest {
  name?: string;
  goal: string;
  mainModel: ModelConfig;
  auxiliaryModel: ModelConfig;
  codingAgentModel: ModelConfig;
  capabilityPolicy: CapabilityPolicy;
}

export interface BuildHarnessRequest extends Partial<CreateHarnessRequest> {
  mode?: "scaffold" | "compile";
}

export interface RunParameter {
  key: string;
  value: string;
}

export interface RunPolicy {
  allowGithubImport: boolean;
  allowScriptGeneration: boolean;
  humanApprovalRequired: boolean;
}

export interface RunHarnessRequest {
  taskInstruction: string;
  parameters: RunParameter[];
  policy: RunPolicy;
}

export interface RunSession {
  id: string;
  harnessId: string;
  status: RunStatus;
  taskInstruction: string;
  parameters: RunParameter[];
  policy: RunPolicy;
  outputArtifactIds: string[];
  reportArtifactId?: string;
  outputSummary?: string;
  outputStatus?: "pending" | "success" | "failure";
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactReference {
  id: string;
  runId: string;
  harnessId: string;
  nodeId?: string | null;
  type: string;
  title: string;
  summary: string;
  createdAt: string;
}

export interface RunArtifact extends ArtifactReference {
  contentJson: unknown;
  contentText: string;
}

export interface TaskAgentAssignment {
  agentId: string;
  agentRole: string;
  objective: string;
  expectedArtifacts: string[];
  dependencies: string[];
  capabilityFocus: string[];
  handoffFrom?: string[];
}

export interface TaskDeliverableContract {
  artifactType: "final.deliverable";
  ownerAgentId: string;
  ownerAgentRole: string;
  title: string;
  format: string;
  summary: string;
  requiredFields: string[];
}

export interface TaskInstance {
  id: string;
  runId: string;
  harnessId: string;
  instruction: string;
  taskInstruction: string;
  goal: string;
  constraints: string[];
  successCriteria: string[];
  perAgentAssignments: TaskAgentAssignment[];
  finalDeliverable: TaskDeliverableContract;
  planningSummary: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentCapabilitySelection {
  capabilityId?: string;
  capabilityType: "tool" | "skill" | "script" | "none";
  capabilityLabel?: string;
  query?: string;
  reason: string;
}

export interface AgentRuntimeDecision {
  actionDecision: "tool" | "skill" | "script" | "compose" | "handoff";
  capabilitySelection: AgentCapabilitySelection;
  expectedArtifactSchema: {
    type: string;
    title: string;
    requiredFields: string[];
    description: string;
  };
  handoffSummary: string;
  taskSummary: string;
  upstreamArtifactIds: string[];
  outputFocus: string[];
  agentOutputDraft: {
    title: string;
    artifactType: "agent.output" | "final.deliverable";
    contentText: string;
    contentJson: Record<string, unknown>;
    summary: string;
  };
}

export interface PlannerAdapter {
  plan(input: PlannerInput, hooks?: PlannerProgressHooks): Promise<PlannerPlanResult>;
}

export interface PlannerProgressHooks {
  onProgress?: (update: PlannerProgressUpdate) => void;
}

export interface CompiledSpecPack {
  role: SpecArtifact;
  execution: SpecArtifact;
  output: SpecArtifact;
}

export interface SpecxContractPack {
  source: SpecArtifact;
  compiled: SpecArtifact;
  backtest: SpecArtifact;
}

export interface PlannerPlanResult {
  blueprint: HarnessBlueprint;
  artifacts: SpecArtifact[];
  rawResponseArtifactId: string;
  rawResponseArtifactIds?: string[];
}

export interface PlannerPromptArtifacts {
  prompt: SpecArtifact;
  schema: SpecArtifact;
}

export interface PlannerLLMConfig {
  provider: string;
  model: string;
  baseURL?: string;
  credentialRef?: string;
  temperature: number;
  maxTokens: number;
}
