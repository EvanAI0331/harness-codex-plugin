"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CreateHarnessRequest, Harness } from "shared/types";
import BuildTimeline from "@/components/BuildTimeline";
import { BuildProgressStrip } from "@/components/BuildTimeline";
import HarnessGraph from "@/components/HarnessGraph";
import HarnessTopNav from "@/components/HarnessTopNav";
import NodeInspector from "@/components/NodeInspector";
import RequirementForm from "@/components/RequirementForm";
import RuntimeTrace from "@/components/RuntimeTrace";
import { useEventStream } from "@/lib/useEventStream";
import { useHarnessStore } from "@/store/useHarnessStore";

interface HarnessWorkspaceProps {
  harnessId: string;
  initialHarness: Harness;
}

export default function HarnessWorkspace({ harnessId, initialHarness }: HarnessWorkspaceProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [bottomTab, setBottomTab] = useState<"build" | "runtime" | "artifacts" | "compile">("build");
  const harness = useHarnessStore((state) => state.harness);
  const loading = useHarnessStore((state) => state.loading);
  const error = useHarnessStore((state) => state.error);
  const eventCount = useHarnessStore((state) => state.events.length);
  const hydrateHarness = useHarnessStore((state) => state.hydrateHarness);
  const setLoading = useHarnessStore((state) => state.setLoading);
  const setError = useHarnessStore((state) => state.setError);

  useEventStream(harnessId, { initialHarness });

  const activeHarness = harness ?? initialHarness;
  const hasGraph = Boolean(activeHarness.blueprint && (activeHarness.agentNodes.length > 0 || activeHarness.specArtifacts.length > 0));

  async function handleBuild(request: CreateHarnessRequest) {
    setBusy(true);
    setError(null);
    setLoading(true);

    try {
      const response = await fetch(`/api/harness/${harnessId}/build`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      const result = (await response.json()) as Harness | { error?: string };
      if (!response.ok) {
        setError(
          typeof result === "object" && result && "error" in result && typeof result.error === "string"
            ? result.error
            : "Build failed. Inspect the failed node and runtime trace.",
        );
        return;
      }

      hydrateHarness(result as Harness);
    } catch (buildError) {
      setError(buildError instanceof Error ? buildError.message : "Failed to start build.");
    } finally {
      setLoading(false);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <HarnessTopNav harnessId={harnessId} active="workspace" />
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-[1760px] flex-col gap-2 px-3 py-3 lg:px-4">
        <section className="rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,19,33,.92),rgba(7,12,22,.88))] px-3 py-2 shadow-2xl shadow-black/20 backdrop-blur">
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-300">
                    Harness Workspace
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-slate-300">
                    Single entry workspace
                  </span>
                </div>
                <h1 className="text-[18px] font-semibold tracking-[-0.03em] text-white md:text-[20px]">{activeHarness.name}</h1>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip label="Harness" value={activeHarness.status} />
                <StatusChip label="Events" value={String(eventCount)} />
                <StatusChip label="Updated" value={new Date(activeHarness.updatedAt).toLocaleString()} />
                <button
                  type="button"
                  onClick={() => router.push(`/harness/${harnessId}/run`)}
                  disabled={activeHarness.status !== "ready" || busy || loading}
                  className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-slate-100 transition hover:bg-white/10"
                >
                  Run New Task
                </button>
              </div>
            </div>
            {error ? <p className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-[10px] text-rose-200">{error}</p> : null}
            <RequirementForm
              initialRequest={{
                name: activeHarness.name,
                goal: activeHarness.intake.goal,
                mainModel: activeHarness.intake.mainModel,
                auxiliaryModel: activeHarness.intake.auxiliaryModel,
                codingAgentModel: activeHarness.intake.codingAgentModel,
                capabilityPolicy: activeHarness.intake.capabilityPolicy,
              }}
              statusValue={activeHarness.status}
              submitLabel={activeHarness.status === "ready" ? "Rebuild" : "Generate Harness"}
              onSubmit={handleBuild}
              busy={busy || loading}
            />
          </div>
        </section>

        <BuildProgressStrip />

        <div className="grid flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="grid min-h-0 gap-3">
            <div className="rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,19,33,.9),rgba(7,12,22,.9))] shadow-2xl shadow-black/20">
              <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                <div>
                  <div className="text-[15px] font-semibold text-slate-100">Harness Graph</div>
                  <div className="mt-0.5 text-[10px] text-slate-400">Pixel-tight layout for agents, specs, and capabilities</div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <GraphChip>Fit View</GraphChip>
                  <GraphChip>Auto Layout</GraphChip>
                  <GraphChip>Show Specs</GraphChip>
                  <GraphChip>Show Caps</GraphChip>
                </div>
              </div>
              <div className="p-2">
                {!hasGraph ? <GraphEmptyState onDemoClick={() => router.push("/harness/new")} /> : null}
                <HarnessGraph />
              </div>
            </div>
          </div>

          <div className="grid min-h-0 gap-3">
            <NodeInspector />
          </div>
        </div>

        <section className="flex h-[clamp(16rem,24vh,21rem)] flex-col rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,19,33,.92),rgba(7,12,22,.88))] shadow-2xl shadow-black/20 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
            <div>
              <div className="text-[15px] font-semibold text-slate-100">Bottom Drawer</div>
              <div className="mt-0.5 text-[10px] text-slate-400">Build Timeline · Runtime Trace · Artifacts · Compile Output</div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <DrawerTab active={bottomTab === "build"} onClick={() => setBottomTab("build")}>
                Build Timeline
              </DrawerTab>
              <DrawerTab active={bottomTab === "runtime"} onClick={() => setBottomTab("runtime")}>
                Runtime Trace
              </DrawerTab>
              <DrawerTab active={bottomTab === "artifacts"} onClick={() => setBottomTab("artifacts")}>
                Artifacts
              </DrawerTab>
              <DrawerTab active={bottomTab === "compile"} onClick={() => setBottomTab("compile")}>
                Compile Output
              </DrawerTab>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
            {bottomTab === "build" ? (
              <BuildTimeline compact />
            ) : bottomTab === "runtime" ? (
              <RuntimeTrace compact />
            ) : bottomTab === "artifacts" ? (
              <ArtifactPanel harness={activeHarness} />
            ) : (
              <CompileOutputPanel harness={activeHarness} />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function GraphEmptyState({ onDemoClick }: { onDemoClick: () => void }) {
  return (
    <div className="mb-2 rounded-[18px] border border-sky-400/20 bg-sky-400/10 px-4 py-3">
      <div className="text-[12px] font-semibold text-sky-200">No harness graph yet.</div>
      <p className="mt-1 text-[10px] leading-5 text-sky-100/80">
        输入 Harness Goal，配置 Model / Capability Policy，然后点击 Generate Harness。`/harness/new` 会先给你一个起始 harness；在 `DEMO_MODE=true` 时它会创建 Repository Audit Harness。
      </p>
      <button
        type="button"
        onClick={onDemoClick}
        className="mt-2 rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-[10px] font-semibold text-white transition hover:bg-white/20"
      >
        Open Starter Harness
      </button>
    </div>
  );
}

function GraphChip({ children }: { children: string }) {
  return <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold text-slate-300">{children}</span>;
}

function DrawerTab({ active, children, onClick }: { active: boolean; children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-full px-1 py-0 font-normal transition",
        active ? "bg-white text-slate-950 shadow-[0_12px_24px_rgba(0,0,0,0.24)]" : "text-slate-300 hover:bg-white/5 hover:text-white",
      ].join(" ")}
      style={{ fontSize: "10px", lineHeight: "1" }}
    >
      {children}
    </button>
  );
}

function CardGroup({ title, value, detail }: { title: string; value: string; detail?: string }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-white/[0.03] p-3">
      <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</div>
      <div className="mt-1 text-[12px] font-medium leading-5 text-slate-100">{value}</div>
      {detail ? <div className="mt-1 text-[10px] leading-4 text-slate-400">{detail}</div> : null}
    </div>
  );
}

function ArtifactPanel({ harness }: { harness: Harness }) {
  const skillArtifacts = harness.specArtifacts.filter((artifact) => artifact.specType === "skill.source" || artifact.specType === "skill.compiled");
  const scriptArtifacts = harness.specArtifacts.filter((artifact) => artifact.specType === "script.source" || artifact.specType === "script.compiled");
  return (
    <div className="grid gap-3">
      <InfoRow label="Spec artifacts" value={String(harness.specArtifacts.length)} />
      <InfoRow label="Skill artifacts" value={String(skillArtifacts.length)} />
      <InfoRow label="Script artifacts" value={String(scriptArtifacts.length)} />
      <InfoRow label="Agent nodes" value={String(harness.agentNodes.length)} />
      <InfoRow label="Capability nodes" value={String(harness.capabilityNodes.length)} />
      <InfoRow label="Edges" value={String(harness.edges.length)} />
    </div>
  );
}

function CompileOutputPanel({ harness }: { harness: Harness }) {
  const latest = [...harness.specArtifacts].reverse().find((artifact) => artifact.compileStatus === "success" || artifact.compileStatus === "failure");
  return (
    <div className="grid gap-3">
      <CardGroup title="Latest compile" value={latest ? `${latest.title} · ${latest.compileStatus ?? "pending"}` : "No compiled spec yet."} detail={latest?.compiledPath ?? latest?.stderr ?? undefined} />
      <div className="rounded-[22px] border border-white/10 bg-slate-950/70 p-4 text-xs leading-6 text-slate-300">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Output payload</div>
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap">{latest?.compiledPayload ?? latest?.content ?? "Compile output will appear here."}</pre>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-[16px] border border-white/10 bg-white/[0.03] px-3 py-2">
      <span className="text-[11px] text-slate-300">{label}</span>
      <span className="text-[11px] font-semibold text-white">{value}</span>
    </div>
  );
}

function StatusChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] text-slate-200 backdrop-blur">
      <span className="text-slate-400">{label}:</span> <span className="font-semibold text-white">{value}</span>
    </div>
  );
}
