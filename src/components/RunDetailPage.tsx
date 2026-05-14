"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Harness, RunArtifact, RunSession } from "shared/types";
import HarnessTopNav from "@/components/HarnessTopNav";
import RuntimeTrace from "@/components/RuntimeTrace";
import { useEventStream } from "@/lib/useEventStream";
import { useHarnessStore } from "@/store/useHarnessStore";

interface RunDetailPageProps {
  run: RunSession;
  initialHarness: Harness;
  initialArtifacts: RunArtifact[];
  initialFinalDeliverable: RunArtifact | null;
  initialFinalReport: RunArtifact | null;
}

export default function RunDetailPage({
  run,
  initialHarness,
  initialArtifacts,
  initialFinalDeliverable,
  initialFinalReport,
}: RunDetailPageProps) {
  const harness = useHarnessStore((state) => state.harness);
  const events = useHarnessStore((state) => state.events);
  const activeHarness = harness ?? initialHarness;
  const [artifacts, setArtifacts] = useState(initialArtifacts);
  const [finalDeliverable, setFinalDeliverable] = useState(initialFinalDeliverable);
  const [finalReport, setFinalReport] = useState(initialFinalReport);

  useEventStream(activeHarness.id, { initialHarness });

  useEffect(() => {
    setArtifacts(initialArtifacts);
    setFinalDeliverable(initialFinalDeliverable);
    setFinalReport(initialFinalReport);
  }, [initialArtifacts, initialFinalDeliverable, initialFinalReport]);

  const runTraceCount = events.filter((event) => isRunEvent(event, run.id)).length;
  const latestEvent = events.at(-1);
  const artifactCount = artifacts.length;

  useEffect(() => {
    if (!latestEvent || !shouldRefreshArtifacts(latestEvent)) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void refreshRunArtifacts(run.id)
        .then((next) => {
          if (cancelled) {
            return;
          }
          setArtifacts(next.artifacts);
          setFinalDeliverable(next.finalDeliverable);
          setFinalReport(next.finalReport);
        })
        .catch(() => undefined);
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [latestEvent?.id, run.id]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <HarnessTopNav harnessId={activeHarness.id} active="run" />
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-[1760px] flex-col gap-5 px-5 py-6 lg:px-6">
        <header className="rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,19,33,.92),rgba(7,12,22,.88))] px-6 py-5 shadow-2xl shadow-black/20 backdrop-blur">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-300">
                  Run Detail
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium text-slate-300">
                  runId view
                </span>
              </div>
              <h1 className="text-[30px] font-semibold tracking-[-0.03em] text-white md:text-[34px]">{activeHarness.name}</h1>
              <p className="max-w-4xl text-[15px] leading-7 text-slate-300">
                按 runId 查看单次执行的 artifacts、final output 和 runtime trace，和 harness 的构建历史分开。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <StatusChip label="Run status" value={run.status} />
              <StatusChip label="Output" value={run.outputStatus ?? "pending"} />
              <StatusChip label="Trace" value={String(runTraceCount)} />
              <StatusChip label="Artifacts" value={String(artifactCount)} />
              <Link
                href={`/harness/${activeHarness.id}`}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-semibold text-slate-100 transition hover:bg-white/10"
              >
                Back to Workspace
              </Link>
            </div>
          </div>
        </header>

        <div className="grid flex-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <section className="grid gap-5">
            <div className="rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,19,33,.92),rgba(7,12,22,.88))] p-5 shadow-2xl shadow-black/20 backdrop-blur">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-100">Run Instruction</div>
                  <div className="mt-1 text-xs text-slate-400">Run Task Instruction is separate from Harness Goal</div>
                </div>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-medium text-slate-400">
                  {run.id}
                </span>
              </div>
              <textarea
                value={run.taskInstruction}
                readOnly
                className="mt-4 min-h-40 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none"
              />
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {run.parameters.map((parameter) => (
                  <div key={`${parameter.key}-${parameter.value}`} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{parameter.key}</div>
                    <div className="mt-1 text-sm text-slate-100">{parameter.value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,19,33,.92),rgba(7,12,22,.88))] p-5 shadow-2xl shadow-black/20 backdrop-blur">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-100">Final Deliverable</div>
                  <div className="mt-1 text-xs text-slate-400">Primary task result artifact, not the final summary report.</div>
                </div>
                <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-[11px] font-semibold text-sky-300">
                  {finalDeliverable ? finalDeliverable.type : "pending"}
                </span>
              </div>
              {finalDeliverable ? (
                <div className="mt-4 rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                    <span className="font-semibold text-sky-300">{finalDeliverable.type}</span>
                    <span>·</span>
                    <span>{finalDeliverable.title}</span>
                    <span>·</span>
                    <span>{new Date(finalDeliverable.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="mt-2 text-[12px] leading-6 text-slate-100">{finalDeliverable.summary}</div>
                  <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-2xl border border-white/10 bg-slate-950/80 p-3 text-[10px] leading-5 text-slate-200">
                    {finalDeliverable.contentText || formatArtifactJson(finalDeliverable.contentJson)}
                  </pre>
                </div>
              ) : (
                <p className="mt-4 text-[10px] text-slate-400">No final deliverable generated</p>
              )}
            </div>

            <div className="rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,19,33,.92),rgba(7,12,22,.88))] p-5 shadow-2xl shadow-black/20 backdrop-blur">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-100">Final Report</div>
                  <div className="mt-1 text-xs text-slate-400">Auxiliary report generated after the deliverable is finalized.</div>
                </div>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-medium text-slate-400">
                  {finalReport ? finalReport.type : "pending"}
                </span>
              </div>
              {finalReport ? (
                <div className="mt-4 rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                    <span className="font-semibold text-sky-300">{finalReport.type}</span>
                    <span>·</span>
                    <span>{finalReport.title}</span>
                    <span>·</span>
                    <span>{new Date(finalReport.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="mt-2 text-[12px] leading-6 text-slate-100">{finalReport.summary}</div>
                  <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-2xl border border-white/10 bg-slate-950/80 p-3 text-[10px] leading-5 text-slate-200">
                    {finalReport.contentText || formatArtifactJson(finalReport.contentJson)}
                  </pre>
                </div>
              ) : (
                <p className="mt-4 text-[10px] text-slate-400">No final report generated yet.</p>
              )}
            </div>

            <div className="rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,19,33,.92),rgba(7,12,22,.88))] p-5 shadow-2xl shadow-black/20 backdrop-blur">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-100">Artifacts</div>
                  <div className="mt-1 text-xs text-slate-400">Node result, capability call, spec validation, error, output artifacts.</div>
                </div>
                <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-xs font-semibold text-sky-300">
                  {artifactCount} artifacts
                </span>
              </div>
              <div className="mt-4 grid gap-3">
                {artifacts.length === 0 ? (
                  <p className="text-[10px] text-slate-400">No run artifacts yet.</p>
                ) : (
                  artifacts.map((artifact) => <ArtifactCard key={artifact.id} artifact={artifact} />)
                )}
              </div>
            </div>
          </section>

          <aside className="grid gap-5">
            <RuntimeTrace compact runId={run.id} />
          </aside>
        </div>
      </div>
    </div>
  );
}

function ArtifactCard({ artifact }: { artifact: RunArtifact }) {
  return (
    <article className="rounded-[20px] border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">
        <span className="font-semibold text-sky-300">{artifact.type}</span>
        <span>·</span>
        <span>{artifact.nodeId ?? "run"}</span>
        <span>·</span>
        <span>{new Date(artifact.createdAt).toLocaleTimeString()}</span>
      </div>
      <div className="mt-1.5 text-[12px] leading-6 text-slate-100">{artifact.title}</div>
      <div className="mt-1 text-[10px] leading-5 text-slate-400">{artifact.summary}</div>
      <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-2xl border border-white/10 bg-slate-950/80 p-3 text-[10px] leading-5 text-slate-200">
        {artifact.contentText || formatArtifactJson(artifact.contentJson)}
      </pre>
    </article>
  );
}

function formatArtifactJson(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function refreshRunArtifacts(runId: string): Promise<{ artifacts: RunArtifact[]; finalDeliverable: RunArtifact | null; finalReport: RunArtifact | null }> {
  const [artifactResponse, outputResponse] = await Promise.all([
    fetch(`/api/runs/${runId}/artifacts`),
    fetch(`/api/runs/${runId}/output`),
  ]);

  if (!artifactResponse.ok) {
    throw new Error(await artifactResponse.text());
  }
  if (!outputResponse.ok) {
    throw new Error(await outputResponse.text());
  }

  const artifactPayload = (await artifactResponse.json()) as { artifacts: RunArtifact[] };
  const outputPayload = (await outputResponse.json()) as {
    output?: RunArtifact | null;
    finalOutput?: RunArtifact | null;
    finalDeliverable?: RunArtifact | null;
    finalReport?: RunArtifact | null;
  };

  return {
    artifacts: artifactPayload.artifacts ?? [],
    finalDeliverable: outputPayload.finalDeliverable ?? outputPayload.finalOutput ?? outputPayload.output ?? null,
    finalReport: outputPayload.finalReport ?? null,
  };
}

function shouldRefreshArtifacts(event: { kind: string }): boolean {
  if (event.kind === "runtime.started" || event.kind === "runtime.requested") {
    return false;
  }
  return (
    event.kind === "node.completed" ||
    event.kind === "node.failed" ||
    event.kind.startsWith("runtime.tool.") ||
    (event.kind.startsWith("task.output.") && event.kind !== "task.output.chunk") ||
    event.kind.startsWith("spec.") ||
    event.kind.startsWith("capability.") ||
    event.kind.startsWith("run.")
  );
}

function StatusChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-medium text-slate-300">
      <span className="text-slate-400">{label}:</span> <span className="text-white">{value}</span>
    </div>
  );
}

function isRunEvent(event: { payload: Record<string, unknown> }, runId: string): boolean {
  return typeof event.payload.runId === "string" && event.payload.runId === runId;
}
