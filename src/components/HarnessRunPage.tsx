"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Harness, RunHarnessRequest, RunParameter, RunStatus } from "shared/types";
import HarnessGraph from "@/components/HarnessGraph";
import HarnessTopNav from "@/components/HarnessTopNav";
import RuntimeTrace from "@/components/RuntimeTrace";
import { useEventStream } from "@/lib/useEventStream";
import { useHarnessStore } from "@/store/useHarnessStore";

interface HarnessRunPageProps {
  harnessId: string;
  initialHarness: Harness;
}

export default function HarnessRunPage({ harnessId, initialHarness }: HarnessRunPageProps) {
  const router = useRouter();
  const harness = useHarnessStore((state) => state.harness);
  const events = useHarnessStore((state) => state.events);
  const hydrateHarness = useHarnessStore((state) => state.hydrateHarness);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [bottomTab, setBottomTab] = useState<"output" | "contract" | "capabilities" | "errors">("output");
  const [taskInstruction, setTaskInstruction] = useState("");
  const [parameters, setParameters] = useState<RunParameter[]>([
    { key: "时间范围", value: "近 90 天" },
    { key: "输出格式", value: "结构化 JSON + 中文摘要" },
    { key: "数据源限制", value: "仅允许已挂载数据源" },
    { key: "风险约束", value: "禁止越权 / 禁止空结论" },
  ]);
  const [policy, setPolicy] = useState<RunHarnessRequest["policy"]>({
    allowGithubImport: true,
    allowScriptGeneration: true,
    humanApprovalRequired: false,
  });

  useEventStream(harnessId, { initialHarness });

  const activeHarness = harness ?? initialHarness;

  const runtimeEvents = useMemo(
    () => events.filter((event) => event.channel === "runtime" || event.kind.startsWith("node.") || event.kind.startsWith("runtime.")),
    [events],
  );
  const latestRuntimeEvent = runtimeEvents[runtimeEvents.length - 1] ?? null;

  useEffect(() => {
    if (!latestRuntimeEvent) {
      return;
    }
    if (
      latestRuntimeEvent.kind === "runtime.failed" ||
      latestRuntimeEvent.kind === "run.failed" ||
      latestRuntimeEvent.kind === "node.failed" ||
      latestRuntimeEvent.kind === "runtime.tool.failed" ||
      latestRuntimeEvent.kind === "task.output.failed"
    ) {
      setRunStatus("failed");
      return;
    }
    if (
      latestRuntimeEvent.kind === "runtime.completed" ||
      latestRuntimeEvent.kind === "run.completed" ||
      latestRuntimeEvent.kind === "runtime.tool.completed" ||
      latestRuntimeEvent.kind === "task.output.generated"
    ) {
      setRunStatus("completed");
      return;
    }
    if (
      latestRuntimeEvent.kind === "runtime.requested" ||
      latestRuntimeEvent.kind === "runtime.started" ||
      latestRuntimeEvent.kind === "node.running" ||
      latestRuntimeEvent.kind === "runtime.tool.called" ||
      latestRuntimeEvent.kind === "task.output.generated"
    ) {
      setRunStatus("running");
    }
  }, [latestRuntimeEvent]);

  async function handleStartRun() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/harness/${harnessId}/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          taskInstruction,
          parameters,
          policy,
        }),
      });

      const payload = (await response.json()) as { error?: string; run?: { id?: string; status?: RunStatus }; harness?: Harness };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to start run.");
      }

      if (payload.run?.id) {
        setRunId(payload.run.id);
        setRunStatus(payload.run.status ?? "running");
        router.push(`/runs/${payload.run.id}`);
        return;
      }
      if (payload.harness) {
        hydrateHarness(payload.harness);
      }
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Failed to start run.");
    } finally {
      setBusy(false);
    }
  }

  function updateParameter(index: number, patch: Partial<RunParameter>) {
    setParameters((current) => current.map((item, currentIndex) => (currentIndex === index ? { ...item, ...patch } : item)));
  }

  function addParameter() {
    setParameters((current) => [...current, { key: "", value: "" }]);
  }

  function removeParameter(index: number) {
    setParameters((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  const latestNodeSummary =
    latestRuntimeEvent &&
    (typeof latestRuntimeEvent.payload.outputSummary === "string" || typeof latestRuntimeEvent.payload.summary === "string")
      ? String(latestRuntimeEvent.payload.outputSummary ?? latestRuntimeEvent.payload.summary)
      : "等待运行结果。";

  const latestNodeName =
    latestRuntimeEvent && typeof latestRuntimeEvent.payload.nodeName === "string"
      ? latestRuntimeEvent.payload.nodeName
      : latestRuntimeEvent?.kind ?? "idle";

  const usedCapabilities = activeHarness.capabilityNodes.filter((capability) => capability.status === "resolved" || capability.status === "missing");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <HarnessTopNav harnessId={harnessId} active="run" />
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-[1760px] flex-col gap-5 px-5 py-6 lg:px-6">
        <header className="rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,19,33,.92),rgba(7,12,22,.88))] px-6 py-5 shadow-2xl shadow-black/20 backdrop-blur">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-300">
                  Run Task
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium text-slate-300">
                  Task instance
                </span>
              </div>
              <h1 className="text-[30px] font-semibold tracking-[-0.03em] text-white md:text-[34px]">{activeHarness.name}</h1>
              <p className="max-w-4xl text-[15px] leading-7 text-slate-300">
                用户在这里输入本次任务需求自然语言、补充参数和运行策略，然后发起一次独立任务实例。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <StatusChip label="Run status" value={runStatus} />
              <StatusChip label="Run ID" value={runId ?? "idle"} />
              <StatusChip label="Harness" value={activeHarness.status} />
              <button
                type="button"
                onClick={handleStartRun}
                disabled={busy}
                className="rounded-full bg-sky-400 px-3 py-1.5 text-[10px] font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Starting..." : "Start Run"}
              </button>
              <button
                type="button"
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-semibold text-slate-100 opacity-60"
                disabled
                title="Not implemented yet"
              >
                Pause
              </button>
              <button
                type="button"
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-semibold text-slate-100 opacity-60"
                disabled
                title="Not implemented yet"
              >
                Resume
              </button>
              <button
                type="button"
                className="rounded-full border border-rose-400/20 bg-rose-500/10 px-3 py-1.5 text-[10px] font-semibold text-rose-200 opacity-60"
                disabled
                title="Not implemented yet"
              >
                Stop
              </button>
            </div>
          </div>
          {error ? <p className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p> : null}
        </header>

        <div className="grid flex-1 gap-5 xl:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
          <section className="rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,19,33,.92),rgba(7,12,22,.88))] p-5 shadow-2xl shadow-black/20 backdrop-blur">
            <div className="space-y-5">
              <div>
                <div className="text-sm font-semibold text-slate-100">Task Instruction</div>
                <p className="mt-2 text-sm leading-6 text-slate-300">本次任务需求只在 Run 页输入，不影响 harness 模板本身。</p>
              </div>

              <label className="grid gap-2">
                <span className="text-sm font-medium text-slate-300">本次任务需求</span>
                <textarea
                  value={taskInstruction}
                  onChange={(event) => setTaskInstruction(event.target.value)}
                  className="min-h-44 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-sky-400 focus:ring-4 focus:ring-sky-400/10"
                  placeholder="例如：研究过去 90 天 AI 算力板块中，哪些标的盈利预期上修最强，并输出可执行交易计划。"
                />
              </label>

              <div className="grid gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">Task Parameters</div>
                    <div className="text-xs text-slate-400">key / value 动态参数表</div>
                  </div>
                  <button
                    type="button"
                    onClick={addParameter}
                    className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-slate-100 transition hover:bg-white/10"
                  >
                    Add Parameter
                  </button>
                </div>
                <div className="grid gap-3">
                  {parameters.map((parameter, index) => (
                    <div key={`${parameter.key}-${index}`} className="grid grid-cols-[1fr_1.5fr_auto] gap-2">
                      <input
                        value={parameter.key}
                        onChange={(event) => updateParameter(index, { key: event.target.value })}
                        className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-sky-400 focus:ring-4 focus:ring-sky-400/10"
                        placeholder="参数名"
                      />
                      <input
                        value={parameter.value}
                        onChange={(event) => updateParameter(index, { value: event.target.value })}
                        className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-sky-400 focus:ring-4 focus:ring-sky-400/10"
                        placeholder="参数值"
                      />
                      <button
                        type="button"
                        onClick={() => removeParameter(index)}
                        className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-[10px] font-semibold text-slate-300 transition hover:bg-white/10"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
                <h3 className="text-sm font-semibold text-slate-200">Run Policy</h3>
                <ToggleField
                  label="Allow Agent Reach GitHub Search In This Run"
                  hint="允许本次运行使用 Agent Reach GitHub 搜索"
                  checked={policy.allowGithubImport}
                  onChange={(checked) => setPolicy((current) => ({ ...current, allowGithubImport: checked }))}
                />
                <ToggleField
                  label="Allow Script Generation In This Run"
                  hint="允许本次运行生成脚本"
                  checked={policy.allowScriptGeneration}
                  onChange={(checked) => setPolicy((current) => ({ ...current, allowScriptGeneration: checked }))}
                />
                <ToggleField
                  label="Human Approval Required"
                  hint="需要人工审批后执行"
                  checked={policy.humanApprovalRequired}
                  onChange={(checked) => setPolicy((current) => ({ ...current, humanApprovalRequired: checked }))}
                />
              </div>

              <div className="grid gap-3 rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
                <h3 className="text-sm font-semibold text-slate-200">Input Artifacts</h3>
                <div className="flex flex-wrap gap-3">
                  <button type="button" className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-semibold text-slate-100 transition hover:bg-white/10">
                    Upload Files
                  </button>
                  <button type="button" className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-semibold text-slate-100 transition hover:bg-white/10">
                    Attach Existing Artifact
                  </button>
                </div>
              </div>

              <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
                <div className="font-semibold text-slate-100">Current Node Output</div>
                <div className="mt-2 text-slate-400">{latestNodeName}</div>
                <div className="mt-1 leading-6 text-slate-300">{latestNodeSummary}</div>
              </div>
            </div>
          </section>

          <section className="grid gap-5">
            <div className="rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,19,33,.92),rgba(7,12,22,.88))] p-5 shadow-2xl shadow-black/20 backdrop-blur">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-100">Active Graph</div>
                  <div className="text-xs text-slate-400">当前高亮运行节点与依赖路径</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusChip label="Task" value={runStatus} />
                  <StatusChip label="Trace" value={`${runtimeEvents.length} events`} />
                </div>
              </div>
              <HarnessGraph />
            </div>

            <RuntimeTrace />

            <div className="rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,19,33,.92),rgba(7,12,22,.88))] shadow-2xl shadow-black/20 backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
                <div>
                  <div className="text-sm font-semibold text-slate-100">Bottom Drawer</div>
                  <div className="mt-1 text-xs text-slate-400">Current Node Output · Contract Check · Used Capabilities · Errors</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <DrawerTab active={bottomTab === "output"} onClick={() => setBottomTab("output")}>
                    Current Node Output
                  </DrawerTab>
                  <DrawerTab active={bottomTab === "contract"} onClick={() => setBottomTab("contract")}>
                    Contract Check
                  </DrawerTab>
                  <DrawerTab active={bottomTab === "capabilities"} onClick={() => setBottomTab("capabilities")}>
                    Used Capabilities
                  </DrawerTab>
                  <DrawerTab active={bottomTab === "errors"} onClick={() => setBottomTab("errors")}>
                    Errors
                  </DrawerTab>
                </div>
              </div>
              <div className="px-5 py-4">
                {bottomTab === "output" ? (
                  <BottomCard title="Current Node Output" lines={["structured JSON summary view", "human-readable summary", latestNodeSummary]} />
                ) : bottomTab === "contract" ? (
                  <BottomCard
                    title="Contract Check"
                    lines={["spec version", "input valid / output valid", runStatus === "failed" ? "node.failed" : "node.completed"]}
                  />
                ) : bottomTab === "capabilities" ? (
                  <BottomCard
                    title="Used Capabilities"
                    lines={
                      usedCapabilities.length > 0
                        ? usedCapabilities.map((capability) => `${capability.label} · ${capability.source}`)
                        : ["waiting for runtime resolution"]
                    }
                  />
                ) : (
                  <BottomCard
                    title="Errors"
                    lines={events.filter((event) => event.kind === "runtime.failed" || event.kind === "node.failed").map((event) => event.message).slice(-3)}
                  />
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function StatusChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-200">
      <span className="text-slate-400">{label}:</span> <span className="font-semibold text-white">{value}</span>
    </div>
  );
}

function ToggleField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-[10px] text-slate-200">
      <span className="grid gap-0.5">
        <span>{label}</span>
        <span className="text-[10px] text-slate-400">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-slate-500 bg-slate-900 text-sky-400 focus:ring-sky-400"
      />
    </label>
  );
}

function BottomCard({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
      <div className="text-[12px] font-semibold text-slate-100">{title}</div>
      <div className="mt-2 space-y-1 text-[10px] leading-5 text-slate-300">
        {lines.length > 0 ? lines.map((line, index) => <div key={`${title}-${index}`}>{line}</div>) : <div className="text-slate-500">No data yet.</div>}
      </div>
    </div>
  );
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
