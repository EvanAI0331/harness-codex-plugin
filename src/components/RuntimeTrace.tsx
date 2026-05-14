"use client";

import { useHarnessStore } from "@/store/useHarnessStore";
import type { HarnessEvent } from "shared/types";

interface RuntimeTraceProps {
  compact?: boolean;
  runId?: string;
}

export default function RuntimeTrace({ compact = false, runId }: RuntimeTraceProps) {
  const events = useHarnessStore((state) => state.events);
  const runtimeEvents = events.filter((event) => isRuntimeEvent(event) && matchesRunId(event, runId));

  if (compact) {
    return <RuntimeList events={runtimeEvents} />;
  }

  return (
    <section className="rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,19,33,.9),rgba(7,12,22,.9))] shadow-2xl shadow-black/20">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <div>
          <h2 className="text-[12px] font-semibold text-slate-100">Runtime Trace</h2>
          <p className="mt-0.5 text-[10px] text-slate-400">node.running · runtime.tool.completed · node.output · contract.validated</p>
        </div>
        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-300">
          {runtimeEvents.length} steps
        </span>
      </div>
      <div className="max-h-48 overflow-y-auto px-3 py-2">
        <RuntimeList events={runtimeEvents} />
      </div>
    </section>
  );
}

function RuntimeList({ events }: { events: HarnessEvent[] }) {
  if (events.length === 0) {
    return <p className="text-[10px] text-slate-400">No runtime events yet.</p>;
  }

  return (
    <div className="space-y-3">
      {events.map((event) => {
        const payload = event.payload as Record<string, unknown>;
        return (
        <article key={event.id} className="rounded-[16px] border border-white/10 bg-white/[0.03] px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-slate-400">
              <span className="font-semibold text-emerald-300">{String(payload.nodeName ?? event.kind)}</span>
              <span>·</span>
              <span>{String(payload.capabilityLabel ?? payload.action ?? event.kind)}</span>
              <span>·</span>
              <span>{runtimeStatus(event)}</span>
              {payload.runId ? (
                <>
                  <span>·</span>
                  <span>{String(payload.runId)}</span>
                </>
              ) : null}
              <span>·</span>
              <span>{new Date(event.createdAt).toLocaleTimeString()}</span>
            </div>
            <div className="mt-1 text-[10px] leading-4 text-slate-100">{String(payload.summary ?? event.message)}</div>
          </article>
        );
      })}
    </div>
  );
}

function isRuntimeEvent(event: HarnessEvent): boolean {
  return event.channel === "runtime" || event.kind.startsWith("node.") || event.kind.startsWith("runtime.");
}

function matchesRunId(event: HarnessEvent, runId?: string): boolean {
  if (!runId) {
    return true;
  }

  const payload = event.payload as Record<string, unknown>;
  return typeof payload.runId === "string" && payload.runId === runId;
}

function runtimeStatus(event: HarnessEvent): string {
  if (event.kind === "runtime.tool.failed") return "failed";
  if (event.kind === "runtime.tool.completed") return "completed";
  if (event.kind === "task.output.failed") return "failed";
  if (event.kind === "task.output.started" || event.kind === "task.output.chunk") return "running";
  if (event.kind === "task.output.completed") return "completed";
  if (event.kind === "task.output.generated") return "completed";
  if (event.kind === "run.failed") return "failed";
  if (event.kind === "run.completed") return "completed";
  if (event.kind === "node.failed") return "failed";
  if (event.kind === "node.completed") return "completed";
  if (event.kind === "node.running" || event.kind === "runtime.started" || event.kind === "runtime.requested") return "running";
  if (event.kind === "runtime.failed") return "failed";
  if (event.kind === "runtime.completed") return "completed";
  return event.phase;
}
