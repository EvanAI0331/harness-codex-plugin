import type { Harness } from "shared/types";
import { nowIso } from "@/lib/time";

export interface AssembleOutcome {
  harness: Harness;
}

export class AssemblerService {
  finalize(harness: Harness): AssembleOutcome {
    const hasFailure = harness.agentNodes.some((agent) => {
      const latestSpecContract = findLatestArtifact(harness.specArtifacts, agent.id, "spec.contract.compiled");
      const latestSpecBacktest = findLatestArtifact(harness.specArtifacts, agent.id, "spec.contract.backtest");
      const latestSkillCompiled = findLatestArtifact(harness.specArtifacts, agent.id, "skill.compiled");
      const latestScriptCompiled = findLatestArtifact(harness.specArtifacts, agent.id, "script.compiled");

      return (
        latestSpecContract?.compileStatus === "failure" ||
        latestSpecBacktest?.backtestStatus === "failure" ||
        latestSkillCompiled?.compileStatus === "failure" ||
        latestScriptCompiled?.compileStatus === "failure"
      );
    });
    const status = hasFailure ? "failed" : "ready";

    return {
      harness: {
        ...harness,
        status,
        blueprint: harness.blueprint
          ? {
              ...harness.blueprint,
              harness: {
                ...harness.blueprint.harness,
                status,
              },
            }
          : harness.blueprint,
        updatedAt: nowIso(),
      },
    };
  }
}

function findLatestArtifact(
  artifacts: Harness["specArtifacts"],
  ownerId: string,
  specType: Harness["specArtifacts"][number]["specType"],
): Harness["specArtifacts"][number] | undefined {
  return [...artifacts].reverse().find((artifact) => artifact.ownerId === ownerId && artifact.specType === specType);
}
