import type { AgentNode, Harness, HarnessEvent, SpecArtifact } from "shared/types";
import { makeId } from "@/lib/id";
import { nowIso } from "@/lib/time";
import type { SpecxGenerationOutcome, SpecxService } from "@/lib/specx/service";
import { validateAgentThreeLayerSpecs } from "@/lib/specx/controlled-checks";

export interface SpecxRepairAgentOutcome {
  harness: Harness;
  artifacts: SpecArtifact[];
  events: HarnessEvent[];
  repaired: boolean;
  failed: boolean;
  failureMessage?: string;
}

export class SpecxRepairAgent {
  constructor(
    private readonly specxService: SpecxService,
    private readonly mergeArtifacts: (harness: Harness, artifacts: SpecArtifact[]) => Harness,
  ) {}

  async repairAgentSpecs(args: {
    harness: Harness;
    agent: AgentNode;
    issues: string[];
    maxAttempts?: number;
  }): Promise<SpecxRepairAgentOutcome> {
    const maxAttempts = args.maxAttempts ?? 2;
    const events: HarnessEvent[] = [];
    const artifacts: SpecArtifact[] = [];
    let current = args.harness;

    events.push(makeRepairEvent(current.id, "spec.repair.started", `${args.agent.label} SpecX repair agent started.`, {
      agentId: args.agent.id,
      issues: args.issues,
      maxAttempts,
    }));

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      events.push(makeRepairEvent(current.id, "spec.repair.attempt.started", `${args.agent.label} SpecX repair attempt ${attempt}/${maxAttempts} started.`, {
        agentId: args.agent.id,
        attempt,
        maxAttempts,
      }));

      const outcome = await this.specxService.generateAndCompileForAgent(args.agent, current);
      artifacts.push(...outcome.artifacts);
      events.push(...outcome.events);
      current = this.mergeArtifacts(current, outcome.artifacts);

      const remainingIssues = validateAgentThreeLayerSpecs(current, args.agent);
      if (remainingIssues.length === 0 && !hasFailedSpecArtifact(outcome)) {
        events.push(makeRepairEvent(current.id, "spec.repair.completed", `${args.agent.label} SpecX repair agent completed.`, {
          agentId: args.agent.id,
          attempt,
          artifactIds: outcome.artifacts.map((artifact) => artifact.id),
        }));
        return {
          harness: current,
          artifacts,
          events,
          repaired: true,
          failed: false,
        };
      }

      events.push(makeRepairEvent(current.id, "spec.repair.attempt.failed", `${args.agent.label} SpecX repair attempt ${attempt}/${maxAttempts} did not satisfy the three-layer contract.`, {
        agentId: args.agent.id,
        attempt,
        maxAttempts,
        issues: remainingIssues,
        failedArtifactIds: outcome.artifacts.filter(isFailedSpecArtifact).map((artifact) => artifact.id),
      }));
    }

    events.push(makeRepairEvent(current.id, "spec.repair.completion.started", `${args.agent.label} SpecX repair agent started field completion from verified contract.`, {
      agentId: args.agent.id,
    }));
    try {
      const completion = this.specxService.completeThreeLayerSpecsForAgent(args.agent, current);
      artifacts.push(...completion.artifacts);
      events.push(...completion.events);
      current = this.mergeArtifacts(current, completion.artifacts);
      const completionIssues = validateAgentThreeLayerSpecs(current, args.agent);
      if (completionIssues.length === 0) {
        events.push(makeRepairEvent(current.id, "spec.repair.completion.completed", `${args.agent.label} SpecX repair agent completed missing fields from verified contract.`, {
          agentId: args.agent.id,
          artifactIds: completion.artifacts.map((artifact) => artifact.id),
        }));
        return {
          harness: current,
          artifacts,
          events,
          repaired: true,
          failed: false,
        };
      }
      events.push(makeRepairEvent(current.id, "spec.repair.completion.failed", `${args.agent.label} SpecX repair agent field completion did not satisfy the three-layer contract.`, {
        agentId: args.agent.id,
        issues: completionIssues,
      }));
    } catch (error) {
      events.push(makeRepairEvent(current.id, "spec.repair.completion.failed", `${args.agent.label} SpecX repair agent could not complete fields from contract.`, {
        agentId: args.agent.id,
        error: error instanceof Error ? error.message : String(error),
      }));
    }

    const finalIssues = validateAgentThreeLayerSpecs(current, args.agent);
    events.push(makeRepairEvent(current.id, "spec.repair.failed", `${args.agent.label} SpecX repair agent exhausted all attempts.`, {
      agentId: args.agent.id,
      issues: finalIssues,
    }));
    return {
      harness: current,
      artifacts,
      events,
      repaired: false,
      failed: true,
      failureMessage: `${args.agent.label} three-layer specs invalid after repair: ${finalIssues.join("; ")}`,
    };
  }
}

function hasFailedSpecArtifact(outcome: SpecxGenerationOutcome): boolean {
  return outcome.artifacts.some(isFailedSpecArtifact);
}

function isFailedSpecArtifact(artifact: SpecArtifact): boolean {
  return (
    (artifact.specType === "spec.contract.compiled" && artifact.compileStatus === "failure") ||
    (artifact.specType === "spec.contract.backtest" && artifact.backtestStatus === "failure")
  );
}

function makeRepairEvent(
  harnessId: string,
  kind: string,
  message: string,
  payload: Record<string, unknown>,
): HarnessEvent {
  return {
    id: makeId("event"),
    harnessId,
    channel: "build",
    phase: "spec-compile",
    kind,
    message,
    payload,
    createdAt: nowIso(),
  };
}
