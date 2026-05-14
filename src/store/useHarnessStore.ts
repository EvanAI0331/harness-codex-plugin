"use client";

import { create } from "zustand";
import type { AgentNode, CapabilityNode, Harness, HarnessEvent } from "shared/types";
import { buildHarnessGraphModel, type GraphEdge, type GraphNode } from "@/lib/harness-graph";

interface HarnessState {
  harness: Harness | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  events: HarnessEvent[];
  selectedNodeId: string | null;
  loading: boolean;
  error: string | null;
  hydrateHarness: (harness: Harness) => void;
  appendEvent: (event: HarnessEvent) => void;
  setSelectedNodeId: (nodeId: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  patchNodeStatus: (nodeId: string, status: string, dataPatch?: Record<string, unknown>) => void;
}

function mergeEvents(current: HarnessEvent[], incoming: HarnessEvent): HarnessEvent[] {
  const byId = new Map(current.map((event) => [event.id, event] as const));
  byId.set(incoming.id, incoming);
  return Array.from(byId.values()).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function updateGraphNode(
  nodes: GraphNode[],
  nodeId: string,
  status: string,
  dataPatch: Record<string, unknown> = {},
): GraphNode[] {
  return nodes.map((node) => {
    if (node.id !== nodeId) {
      return node;
    }

    const existingChunks = Array.isArray(node.data.outputChunks) ? (node.data.outputChunks as string[]) : [];
    const resetOutput = dataPatch.resetOutput === true;
    const nextChunks = typeof dataPatch.outputChunk === "string" ? [...(resetOutput ? [] : existingChunks), dataPatch.outputChunk] : resetOutput ? [] : existingChunks;
    const mergedData: Record<string, unknown> = {
      ...node.data,
      status,
      ...(resetOutput ? { outputChunks: [], latestOutput: "" } : {}),
      ...(typeof dataPatch.outputChunk === "string" ? { outputChunks: nextChunks, latestOutput: nextChunks.join("\n\n") } : {}),
      ...dataPatch,
    };

    return {
      ...node,
      status,
      data: mergedData,
    };
  });
}

function isAgentStatus(status: string): status is AgentNode["status"] {
  return status === "idle" || status === "queued" || status === "ready" || status === "running" || status === "completed" || status === "blocked" || status === "failed";
}

function isCapabilityStatus(status: string): status is CapabilityNode["status"] {
  return status === "unresolved" || status === "resolved" || status === "missing" || status === "ready" || status === "blocked" || status === "failed";
}

export const useHarnessStore = create<HarnessState>((set, get) => ({
  harness: null,
  nodes: [],
  edges: [],
  events: [],
  selectedNodeId: null,
  loading: false,
  error: null,
  hydrateHarness: (harness) =>
    set({
      harness,
      ...buildHarnessGraphModel(harness, get().selectedNodeId),
      events: harness.events,
      error: null,
    }),
  appendEvent: (event) =>
    set((state) => ({
      events: mergeEvents(state.events, event),
    })),
  setSelectedNodeId: (nodeId) => set({ selectedNodeId: nodeId }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  patchNodeStatus: (nodeId, status, dataPatch) =>
    set((state) => ({
      nodes: updateGraphNode(state.nodes, nodeId, status, dataPatch),
      harness: state.harness
        ? {
            ...state.harness,
            agentNodes: state.harness.agentNodes.map((node) =>
              node.id === nodeId && isAgentStatus(status)
                ? { ...node, status, updatedAt: new Date().toISOString() }
                : node,
            ),
            capabilityNodes: state.harness.capabilityNodes.map((node) =>
              node.id === nodeId && isCapabilityStatus(status)
                ? { ...node, status, updatedAt: new Date().toISOString() }
                : node,
            ),
            blueprint: state.harness.blueprint
              ? {
                  ...state.harness.blueprint,
                  agents: state.harness.blueprint.agents.map((node) =>
                    node.id === nodeId && isAgentStatus(status) ? { ...node, status } : node,
                  ),
                  capabilities: state.harness.blueprint.capabilities.map((node) =>
                    node.id === nodeId && isCapabilityStatus(status) ? { ...node, status } : node,
                  ),
                }
              : state.harness.blueprint,
          }
        : state.harness,
    })),
}));
