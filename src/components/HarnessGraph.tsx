"use client";

import { useMemo } from "react";
import ReactFlow, { Background, Controls, Handle, MiniMap, Position, ReactFlowProvider, type NodeProps } from "reactflow";
import { useHarnessStore } from "@/store/useHarnessStore";
import type { GraphEdge, GraphNode } from "@/lib/harness-graph";
import { getNodeBorderColor, getNodeStyles } from "@/lib/harness-graph";

export default function HarnessGraph() {
  const nodes = useHarnessStore((state) => state.nodes);
  const edges = useHarnessStore((state) => state.edges);
  const selectedNodeId = useHarnessStore((state) => state.selectedNodeId);
  const setSelectedNodeId = useHarnessStore((state) => state.setSelectedNodeId);

  const rfNodes = useMemo(
    () =>
      nodes.map((node) => ({
        id: node.id,
        type: node.type,
        data: {
          ...node.data,
          label: node.label,
          status: node.status,
          selected: node.id === selectedNodeId,
        },
        position: node.position,
        style: {
          ...getNodeStyles(node.type, node.status),
          boxShadow:
            node.id === selectedNodeId
              ? `0 0 0 1px ${getNodeBorderColor(node.type, node.status)}, 0 0 0 6px rgba(96, 165, 250, 0.14), 0 20px 40px rgba(0,0,0,0.3)`
              : getNodeStyles(node.type, node.status).boxShadow,
        },
      })),
    [nodes, selectedNodeId],
  );

  const rfEdges = useMemo(
    () =>
      edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        style: { stroke: "#60a5fa", strokeWidth: 1.5 },
        labelStyle: { fill: "#cbd5e1", fontSize: 11 },
      })),
    [edges],
  );

  const nodeTypes = useMemo(
    () => ({
      harness: HarnessFlowNode,
      agent: HarnessFlowNode,
      spec: HarnessFlowNode,
      capability: HarnessFlowNode,
    }),
    [],
  );

  return (
    <div className="h-[360px] min-h-[300px] rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,16,28,.9),rgba(7,12,22,.92))] shadow-2xl shadow-black/20">
      <ReactFlowProvider>
        <ReactFlow
          style={{ width: "100%", height: "100%" }}
          fitViewOptions={{ padding: 0.16 }}
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
          onPaneClick={() => setSelectedNodeId(null)}
        >
          <Background gap={22} size={1} color="rgba(148, 163, 184, 0.18)" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

function HarnessFlowNode({ data }: NodeProps<Record<string, unknown>>) {
  const label = String(data.label ?? "Node");
  const status = String(data.status ?? "idle");
  const kind = String(data.kind ?? "spec");

  return (
      <div className="flex min-w-[180px] flex-col gap-1.5 rounded-[18px] border border-white/10 bg-slate-950/90 p-3 text-slate-100 shadow-2xl shadow-black/20 backdrop-blur">
        <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-sky-400" />
        <div className="flex items-center justify-between gap-3">
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-300">
          {kind}
        </span>
        <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold" style={{ color: statusColor(status) }}>
          {status}
        </span>
      </div>
      <div className="text-[10px] font-semibold leading-4">{label}</div>
      <div className="text-[9px] leading-4 text-slate-300">{String(data.summary ?? "")}</div>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-sky-400" />
    </div>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case "running":
      return "#f59e0b";
    case "failed":
      return "#f87171";
    case "completed":
    case "ready":
    case "resolved":
    case "success":
      return "#4ade80";
    default:
      return "#93c5fd";
  }
}
