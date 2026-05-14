import type { Harness, HarnessEvent, SpecArtifact } from "shared/types";

export interface SpecSourceResult {
  source: string;
  artifact: SpecArtifact;
}

export interface SpecCompileResult {
  success: boolean;
  compiledPath?: string;
  compiledPayload?: string;
  stdout: string;
  stderr: string;
}

export interface SpecBacktestResult {
  success: boolean;
  payload: string;
  stdout: string;
  stderr: string;
}

export interface SpecCompilerAdapter {
  compile(source: string): Promise<SpecCompileResult>;
}

export interface SpecBacktestAdapter {
  backtest(args: {
    source: string;
    compiled: string;
    harness: Harness;
    agent: import("shared/types").AgentNode;
  }): Promise<SpecBacktestResult>;
}

export interface SpecxGenerationResult {
  sourceArtifact: SpecArtifact;
  compiledArtifact: SpecArtifact;
  events: HarnessEvent[];
}

export interface SpecxService {
  generateSpecSourceForAgent(agent: import("shared/types").AgentNode, harness: Harness): Promise<SpecArtifact>;
  generateAndCompileForAgent(agent: import("shared/types").AgentNode, harness: Harness): Promise<{
    artifacts: SpecArtifact[];
    events: HarnessEvent[];
  }>;
  completeThreeLayerSpecsForAgent(agent: import("shared/types").AgentNode, harness: Harness): {
    artifacts: SpecArtifact[];
    events: HarnessEvent[];
  };
  compileSpec(source: string): Promise<SpecCompileResult>;
}
