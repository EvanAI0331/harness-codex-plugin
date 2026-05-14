import type { AgentNode, Harness, HarnessEvent, ModelConfig, SpecArtifact, RuntimeContractBinding } from "shared/types";

export interface ScriptAuthoringRequest {
  harness: Harness;
  agent: AgentNode;
  binding: RuntimeContractBinding;
}

export interface ScriptAuthoringRepairRequest extends ScriptAuthoringRequest {
  model: ModelConfig;
  failedPlan: ScriptAuthoringPlan;
  failedKind: "skill" | "script";
  compilerError: string;
  failingSource: string;
}

export interface ScriptAuthoringPlan {
  summary: string;
  skill: {
    title: string;
    fileName: string;
    sourceText: string;
  };
  script: {
    title: string;
    fileName: string;
    entrypoint: string;
    sourceText: string;
  };
  artifacts: {
    skillSourceTemplateId: string;
    scriptSourceTemplateId: string;
  };
  validation: {
    includesSkill: true;
    includesScript: true;
    executable: true;
    persistable: true;
  };
}

export interface ScriptAuthoringGenerationResponse {
  plan: ScriptAuthoringPlan;
  rawText: string;
  rawPayload: unknown;
  model: string;
  provider: string;
}

export interface ScriptCompilerResult {
  success: boolean;
  compiledPath?: string;
  compiledPayload?: string;
  stdout: string;
  stderr: string;
}

export interface ScriptAuthoringAdapter {
  generate(request: ScriptAuthoringRequest & { model: ModelConfig }): Promise<ScriptAuthoringGenerationResponse>;
  repair?(request: ScriptAuthoringRepairRequest): Promise<ScriptAuthoringGenerationResponse>;
}

export interface ScriptCompilerAdapter {
  compileSkill(args: {
    harness: Harness;
    agent: AgentNode;
    source: string;
    fileName: string;
  }): Promise<ScriptCompilerResult>;
  compileScript(args: {
    harness: Harness;
    agent: AgentNode;
    source: string;
    fileName: string;
  }): Promise<ScriptCompilerResult>;
}

export interface ScriptxGenerationOutcome {
  artifacts: SpecArtifact[];
  events: HarnessEvent[];
}
