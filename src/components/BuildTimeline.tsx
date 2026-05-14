"use client";

import { useHarnessStore } from "@/store/useHarnessStore";
import type { HarnessEvent } from "shared/types";

interface BuildTimelineProps {
  compact?: boolean;
}

export default function BuildTimeline({ compact = false }: BuildTimelineProps) {
  const events = useHarnessStore((state) => state.events);
  const buildEvents = events.filter(isBuildEvent);

  if (compact) {
    return <TimelineList events={buildEvents} />;
  }

  return (
    <section className="rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,19,33,.9),rgba(7,12,22,.9))] shadow-2xl shadow-black/20">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <div>
          <h2 className="text-[12px] font-semibold text-slate-100">Build Timeline</h2>
          <p className="mt-0.5 text-[10px] text-slate-400">intake → planning → compose → specx → capability → script-authoring → assembler</p>
        </div>
        <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-2 py-0.5 text-[10px] font-semibold text-sky-300">
          {buildEvents.length} steps
        </span>
      </div>
      <div className="max-h-48 overflow-y-auto px-3 py-2">
        <TimelineList events={buildEvents} />
      </div>
    </section>
  );
}

export function BuildProgressStrip({ compact = false }: { compact?: boolean }) {
  const events = useHarnessStore((state) => state.events);
  const buildEvents = events.filter(isBuildEvent);
  const progress = deriveBuildProgress(buildEvents);

  return (
    <div className={["rounded-[16px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,19,33,.9),rgba(7,12,22,.9))] shadow-2xl shadow-black/20", compact ? "px-2 py-2" : "px-3 py-2.5"].join(" ")}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-slate-500">最新进度</div>
          <div className="truncate text-[10px] font-medium text-slate-100" title={progress.text}>
            {progress.text}
          </div>
        </div>
        <div className="shrink-0 text-[10px] font-semibold text-sky-300">{progress.percent}%</div>
      </div>
      <div className={["mt-2 h-2 overflow-hidden rounded-full bg-white/5", compact ? "h-1.5" : "h-2"].join(" ")}>
        <div
          className="h-full rounded-full bg-gradient-to-r from-sky-400 via-cyan-300 to-emerald-300 transition-[width] duration-300"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
    </div>
  );
}

function TimelineList({ events }: { events: HarnessEvent[] }) {
  if (events.length === 0) {
    return <p className="text-[10px] text-slate-400">No build events yet.</p>;
  }

  return (
    <div className="space-y-3">
      {events.map((event) => (
        <article key={event.id} className="rounded-[16px] border border-white/10 bg-white/[0.03] px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-slate-400">
            <span className="font-semibold text-sky-300">{timelineService(event)}</span>
            <span>·</span>
            <span>{event.kind}</span>
            <span>·</span>
            <span>{event.phase}</span>
            <span>·</span>
            <span>{new Date(event.createdAt).toLocaleTimeString()}</span>
          </div>
          <div className="mt-1 text-[10px] leading-4 text-slate-100">{timelineSummary(event)}</div>
        </article>
      ))}
    </div>
  );
}

function isBuildEvent(event: HarnessEvent): boolean {
  return (
    event.channel === "build" ||
    event.phase === "intake" ||
    event.phase === "planning" ||
    event.phase === "compose" ||
    event.phase === "resolve" ||
    event.phase === "spec-compile" ||
    event.phase === "script-authoring" ||
    event.phase === "assemble"
  );
}

function timelineService(event: HarnessEvent): string {
  if (event.phase === "intake") return "requirement";
  if (event.phase === "planning") return "dispatcher";
  if (event.phase === "compose") return "composer";
  if (event.phase === "resolve") return "capability";
  if (event.phase === "spec-compile") return "specx";
  if (event.phase === "script-authoring") return "script-authoring";
  if (event.phase === "assemble") return "assembler";
  return event.channel;
}

function timelineSummary(event: HarnessEvent): string {
  const payload = event.payload as Record<string, unknown>;
  if (typeof payload.summary === "string") {
    return payload.summary;
  }
  if (typeof payload.stage === "string") {
    return `${event.message} (${payload.stage})`;
  }
  return event.message;
}

interface BuildProgressState {
  percent: number;
  text: string;
}

function deriveBuildProgress(events: HarnessEvent[]): BuildProgressState {
  const latestMeaningful = [...events].reverse().find((event) => event.kind !== "graph.updated");
  if (!latestMeaningful) {
    return {
      percent: 0,
      text: "No build events yet.",
    };
  }

  return {
    percent: progressPercentForEvent(latestMeaningful),
    text: `最新进度 · ${timelineService(latestMeaningful)} · ${timelineSummary(latestMeaningful)}`,
  };
}

function progressPercentForEvent(event: HarnessEvent): number {
  const payload = event.payload as Record<string, unknown>;
  const stage = typeof payload.stage === "string" ? payload.stage : "";

  switch (event.kind) {
    case "build.started":
      return 0;
    case "plan.dispatch.started":
      return 6;
    case "plan.dispatch.completed":
      return 10;
    case "plan.framework.started":
      return 14;
    case "plan.framework.completed":
      return 18;
    case "plan.experts.started":
      return 22;
    case "plan.experts.completed":
      return 26;
    case "plan.specs.started":
      return 30;
    case "plan.specs.completed":
      return 36;
    case "plan.capabilities.started":
      return 42;
    case "plan.capabilities.completed":
      return 48;
    case "plan.edges.started":
      return 54;
    case "plan.edges.completed":
      return 60;
    case "build.stage.started":
      return stageProgress(stage, true);
    case "build.stage.completed":
      return stageProgress(stage, false);
    case "spec.compiled":
    case "spec.contract.compiled":
      return 72;
    case "spec.contract.backtest.passed":
      return 76;
    case "capability.resolved":
      return 64;
    case "capability.missing":
      return 64;
    case "skill.compiled":
      return 84;
    case "script.compiled":
      return 88;
    case "build.completed":
      return 100;
    case "build.failed":
      return 100;
    default:
      return phaseProgress(event.phase);
  }
}

function stageProgress(stage: string, started: boolean): number {
  switch (stage) {
    case "planner":
      return started ? 8 : 12;
    case "composer":
      return started ? 28 : 34;
    case "specx":
      return started ? 56 : 66;
    case "capability":
      return started ? 68 : 74;
    case "script-authoring":
      return started ? 82 : 90;
    case "assembler":
      return started ? 94 : 98;
    default:
      return started ? 20 : 24;
  }
}

function phaseProgress(phase: HarnessEvent["phase"]): number {
  switch (phase) {
    case "intake":
      return 5;
    case "planning":
      return 18;
    case "compose":
      return 32;
    case "resolve":
      return 64;
    case "spec-compile":
      return 76;
    case "script-authoring":
      return 88;
    case "assemble":
      return 96;
    case "build":
      return 100;
    case "runtime":
      return 100;
    case "task-output":
      return 100;
    default:
      return 0;
  }
}
