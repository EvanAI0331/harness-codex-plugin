import type { CSSProperties } from "react";
import type { Harness, HarnessBlueprint, SpecArtifact } from "shared/types";

export type NodeType = "harness" | "agent" | "spec" | "capability";

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  status?: string;
  data: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export function buildHarnessGraphModel(harness: Harness, selectedNodeId: string | null = null): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const blueprint = harness.blueprint;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  nodes.push({
    id: harness.id,
    type: "harness",
    label: harness.name,
    status: harness.status,
    data: {
      kind: "harness",
      selected: selectedNodeId === harness.id,
      harnessId: harness.id,
      intake: harness.intake,
      status: harness.status,
      summary: blueprint?.summary ?? harness.name,
      artifactCount: harness.specArtifacts.length,
    },
    position: { x: 56, y: 160 },
  });

  if (!blueprint) {
    return { nodes, edges };
  }

  blueprint.capabilities.forEach((capability, index) => {
    nodes.push({
      id: capability.id,
      type: "capability",
      label: capability.label,
      status: capability.status,
      data: {
        kind: "capability",
        selected: selectedNodeId === capability.id,
        capabilityType: capability.capabilityType,
        source: capability.source,
        status: capability.status,
        summary: capability.summary,
        registryKey: capability.registryKey,
        resolutionReason: capability.resolutionReason,
        resolverName: capability.resolverName,
        policyFlags: capability.policyFlags,
        specArtifactIds: capability.specArtifactIds,
        artifacts: capability.specArtifactIds,
      },
      position: { x: 300 + (index % 3) * 240, y: 24 + Math.floor(index / 3) * 130 },
    });
  });

  blueprint.agents.forEach((agent, index) => {
    const sourceArtifact = findArtifact(harness.specArtifacts, agent.id, "spec.contract.source");
    const compiledArtifact = findArtifact(harness.specArtifacts, agent.id, "spec.contract.compiled");
    const backtestArtifact = findArtifact(harness.specArtifacts, agent.id, "spec.contract.backtest");
    const skillArtifact = findArtifact(harness.specArtifacts, agent.id, "skill.compiled");
    const scriptArtifact = findArtifact(harness.specArtifacts, agent.id, "script.compiled");
    nodes.push({
      id: agent.id,
      type: "agent",
      label: agent.label,
      status: agent.status,
      data: {
        kind: "agent",
        selected: selectedNodeId === agent.id,
        role: agent.role,
        model: agent.model,
        status: agent.status,
        deps: agent.capabilityIds,
        requiredCapabilities: agent.capabilityIds,
        dependencyIds: agent.capabilityIds,
        capabilityIds: agent.capabilityIds,
        specArtifactIds: agent.specArtifactIds,
        skillArtifactIds: agent.skillArtifactIds,
        scriptArtifactIds: agent.scriptArtifactIds,
        sourceArtifact: summarizeArtifact(sourceArtifact),
        compiledArtifact: summarizeArtifact(compiledArtifact),
        backtestArtifact: summarizeArtifact(backtestArtifact),
        skillArtifact: summarizeArtifact(skillArtifact),
        scriptArtifact: summarizeArtifact(scriptArtifact),
        latestOutput: summarizeArtifact(scriptArtifact ?? skillArtifact ?? compiledArtifact ?? backtestArtifact ?? sourceArtifact),
      },
      position: { x: 300 + index * 270, y: 280 },
    });
  });

  blueprint.specs.forEach((spec, index) => {
    const sourceArtifact = findArtifact(harness.specArtifacts, spec.agentId, "spec.contract.source");
    const compiledArtifact = findArtifact(harness.specArtifacts, spec.agentId, "spec.contract.compiled");
    const backtestArtifact = findArtifact(harness.specArtifacts, spec.agentId, "spec.contract.backtest");
    const latestArtifact = compiledArtifact ?? backtestArtifact ?? sourceArtifact;
    const status = spec.compileStatus ?? compiledArtifact?.compileStatus ?? backtestArtifact?.backtestStatus ?? "pending";
    nodes.push({
      id: spec.id,
      type: "spec",
      label: spec.title,
      status,
      data: {
        kind: "spec",
        selected: selectedNodeId === spec.id,
        specType: spec.specType,
        agentId: spec.agentId,
        artifactId: spec.artifactId,
        status,
        compileStatus: status,
        backtestStatus: backtestArtifact?.backtestStatus,
        summary: spec.summary,
        contractSummary: spec.summary,
        source: summarizeArtifact(sourceArtifact),
        compileOutput: {
          stdout: compiledArtifact?.stdout ?? spec.stdout ?? "",
          stderr: compiledArtifact?.stderr ?? spec.stderr ?? "",
        },
        compiledPath: spec.compiledPath ?? compiledArtifact?.compiledPath,
        stdout: spec.stdout ?? compiledArtifact?.stdout,
        stderr: spec.stderr ?? compiledArtifact?.stderr,
        sourceArtifact: summarizeArtifact(sourceArtifact),
        compiledArtifact: summarizeArtifact(compiledArtifact),
        backtestArtifact: summarizeArtifact(backtestArtifact),
        runtimeBinding: latestArtifact?.runtimeBinding ?? sourceArtifact?.runtimeBinding ?? null,
      },
      position: { x: 300 + index * 300, y: 540 },
    });
  });

  blueprint.edges.forEach((edge) => {
    edges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label ?? edge.relation,
    });
  });

  return { nodes, edges };
}

function findArtifact(artifacts: SpecArtifact[], ownerId: string, specType: SpecArtifact["specType"]): SpecArtifact | undefined {
  return [...artifacts].reverse().find((artifact) => artifact.ownerId === ownerId && artifact.specType === specType);
}

function summarizeArtifact(artifact: SpecArtifact | undefined): Record<string, unknown> | null {
  if (!artifact) {
    return null;
  }

  return {
    id: artifact.id,
    specType: artifact.specType,
    artifactType: artifact.artifactType,
    compileStatus: artifact.compileStatus,
    backtestStatus: artifact.backtestStatus,
    compiledPath: artifact.compiledPath,
    stdout: artifact.stdout,
    stderr: artifact.stderr,
    content: artifact.content,
    contractVersion: artifact.contractVersion,
    runtimeBinding: artifact.runtimeBinding,
  };
}

export function getNodeBorderColor(nodeType: NodeType, status?: string): string {
  if (status === "failed") {
    return "#f87171";
  }
  if (status === "running") {
    return "#f59e0b";
  }
  if (status === "completed" || status === "ready" || status === "resolved" || status === "success") {
    return "#4ade80";
  }
  switch (nodeType) {
    case "harness":
      return "#60a5fa";
    case "agent":
      return "#c084fc";
    case "spec":
      return "#fb923c";
    case "capability":
      return "#34d399";
    default:
      return "#94a3b8";
  }
}

export function getNodeStyles(nodeType: NodeType, status?: string): CSSProperties {
  return {
    border: `1px solid ${getNodeBorderColor(nodeType, status)}`,
    borderRadius: 16,
    background:
      nodeType === "harness"
        ? "linear-gradient(180deg, rgba(18, 34, 56, 0.96), rgba(12, 19, 33, 0.96))"
        : "linear-gradient(180deg, rgba(12, 16, 24, 0.96), rgba(8, 12, 20, 0.92))",
    color: "#f8fbff",
    width: 230,
    padding: 14,
    boxShadow: "0 20px 40px rgba(0,0,0,0.22)",
  };
}
