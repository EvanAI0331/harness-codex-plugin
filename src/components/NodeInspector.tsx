"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Harness } from "shared/types";
import type { GraphNode } from "@/lib/harness-graph";
import { useHarnessStore } from "@/store/useHarnessStore";

type NodeKind = "agent" | "spec" | "capability";

export default function NodeInspector() {
  const harness = useHarnessStore((state) => state.harness);
  const nodes = useHarnessStore((state) => state.nodes);
  const selectedNodeId = useHarnessStore((state) => state.selectedNodeId);
  const setSelectedNodeId = useHarnessStore((state) => state.setSelectedNodeId);
  const hydrateHarness = useHarnessStore((state) => state.hydrateHarness);

  const node = useMemo(() => nodes.find((item) => item.id === selectedNodeId) ?? null, [nodes, selectedNodeId]);

  async function saveNodePatch(kind: NodeKind, nodeId: string, patch: Record<string, unknown>) {
    if (!harness) {
      return;
    }

    const response = await fetch(`/api/harness/${harness.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ kind, nodeId, patch }),
    });

    const result = (await response.json()) as Harness | { error?: string };
    if (!response.ok) {
      throw new Error(typeof result === "object" && result && "error" in result ? result.error ?? "Save failed." : "Save failed.");
    }

    hydrateHarness(result as Harness);
  }

  return (
    <section className="flex h-full min-h-[18rem] flex-col rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,19,33,.9),rgba(7,12,22,.9))] shadow-2xl shadow-black/20">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <div>
          <h2 className="text-[15px] font-semibold text-slate-100">Node Inspector</h2>
          <p className="mt-0.5 text-[10px] text-slate-400">agent / spec / capability</p>
        </div>
        <button
          type="button"
          onClick={() => setSelectedNodeId(null)}
          className="h-4 rounded-full border border-white/10 bg-white/5 px-1.5 py-0 text-[10px] leading-none font-medium text-slate-300 transition hover:bg-white/10"
        >
          Clear
        </button>
      </div>

      <div className="flex gap-1.5 border-b border-white/10 px-3 py-2 text-[10px] uppercase tracking-[0.14em]">
        <InspectorTab active={node?.type === "agent"} onClick={() => selectFirstNodeOfType(nodes, "agent", setSelectedNodeId)}>
          agent
        </InspectorTab>
        <InspectorTab active={node?.type === "spec"} onClick={() => selectFirstNodeOfType(nodes, "spec", setSelectedNodeId)}>
          spec
        </InspectorTab>
        <InspectorTab active={node?.type === "capability"} onClick={() => selectFirstNodeOfType(nodes, "capability", setSelectedNodeId)}>
          capability
        </InspectorTab>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {!node ? (
          <p className="text-[10px] text-slate-400">Select a node in the graph to inspect and edit it.</p>
        ) : (
          <div className="grid gap-2">
            <div className="rounded-[16px] border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">
                  {node.type}
                </span>
                <span className="text-[10px] font-semibold text-sky-300">{node.status ?? "n/a"}</span>
              </div>
              <div className="mt-1.5 text-[12px] font-semibold text-slate-100">{node.label}</div>
              <div className="mt-1 text-[11px] leading-4 text-slate-300">{String(node.data.summary ?? "")}</div>
            </div>

            {node.type === "agent" ? (
              <AgentInspector node={node} saveNodePatch={saveNodePatch} />
            ) : null}
            {node.type === "spec" ? (
              <SpecInspector node={node} saveNodePatch={saveNodePatch} />
            ) : null}
            {node.type === "capability" ? (
              <CapabilityInspector node={node} saveNodePatch={saveNodePatch} />
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function InspectorTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={["rounded-full px-2 py-0.5 text-[9px] transition", active ? "bg-white text-slate-950" : "text-slate-400 hover:bg-white/5"].join(" ")}
    >
      {children}
    </button>
  );
}

function AgentInspector({
  node,
  saveNodePatch,
}: {
  node: Pick<GraphNode, "id" | "label" | "data">;
  saveNodePatch: (kind: NodeKind, nodeId: string, patch: Record<string, unknown>) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => readAgentDraft(node.label, node.data));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(readAgentDraft(node.label, node.data));
    setError(null);
  }, [node.id, node.label, node.data]);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      await saveNodePatch("agent", node.id, {
        label: draft.label,
        role: draft.role,
        modelProvider: draft.modelProvider,
        modelName: draft.modelName,
        modelBaseURL: draft.modelBaseURL,
        modelCredentialRef: draft.modelCredentialRef,
        modelTemperature: draft.modelTemperature,
        modelMaxTokens: draft.modelMaxTokens,
        capabilityIds: parseList(draft.capabilityIds),
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EditorCard title="Agent Editor" busy={busy} error={error} onSave={handleSave}>
      <TextField label="Label" value={draft.label} onChange={(label) => setDraft((current) => ({ ...current, label }))} />
      <TextField label="Role" value={draft.role} onChange={(role) => setDraft((current) => ({ ...current, role }))} />
      <TextField label="Model Provider" value={draft.modelProvider} onChange={(modelProvider) => setDraft((current) => ({ ...current, modelProvider }))} />
      <TextField label="Model Name" value={draft.modelName} onChange={(modelName) => setDraft((current) => ({ ...current, modelName }))} />
      <TextField label="Base URL" value={draft.modelBaseURL} onChange={(modelBaseURL) => setDraft((current) => ({ ...current, modelBaseURL }))} />
      <TextField
        label="Credential Ref"
        value={draft.modelCredentialRef}
        onChange={(modelCredentialRef) => setDraft((current) => ({ ...current, modelCredentialRef }))}
      />
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Temperature"
          type="number"
          value={draft.modelTemperature}
          onChange={(modelTemperature) => setDraft((current) => ({ ...current, modelTemperature }))}
        />
        <TextField
          label="Max Tokens"
          type="number"
          value={draft.modelMaxTokens}
          onChange={(modelMaxTokens) => setDraft((current) => ({ ...current, modelMaxTokens }))}
        />
      </div>
      <TextareaField
        label="Capability IDs"
        value={draft.capabilityIds}
        onChange={(capabilityIds) => setDraft((current) => ({ ...current, capabilityIds }))}
      />
      <ReadonlyCard title="Latest Output" value={formatValue(node.data.latestOutput)} />
    </EditorCard>
  );
}

function SpecInspector({
  node,
  saveNodePatch,
}: {
  node: Pick<GraphNode, "id" | "label" | "data">;
  saveNodePatch: (kind: NodeKind, nodeId: string, patch: Record<string, unknown>) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => readSpecDraft(node.label, node.data));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(readSpecDraft(node.label, node.data));
    setError(null);
  }, [node.id, node.label, node.data]);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      await saveNodePatch("spec", node.id, {
        title: draft.title,
        summary: draft.summary,
        compiledPath: draft.compiledPath,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EditorCard title="Spec Editor" busy={busy} error={error} onSave={handleSave}>
      <TextField label="Title" value={draft.title} onChange={(title) => setDraft((current) => ({ ...current, title }))} />
      <TextareaField label="Summary" value={draft.summary} onChange={(summary) => setDraft((current) => ({ ...current, summary }))} />
      <TextField
        label="Compiled Path"
        value={draft.compiledPath}
        onChange={(compiledPath) => setDraft((current) => ({ ...current, compiledPath }))}
      />
      <ReadonlyCard title="Source" value={formatValue(node.data.source)} />
      <ReadonlyCard title="Compile Output" value={formatValue(node.data.compileOutput)} />
      <ReadonlyCard title="Runtime Binding" value={formatValue(node.data.runtimeBinding)} />
    </EditorCard>
  );
}

function CapabilityInspector({
  node,
  saveNodePatch,
}: {
  node: Pick<GraphNode, "id" | "label" | "data">;
  saveNodePatch: (kind: NodeKind, nodeId: string, patch: Record<string, unknown>) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => readCapabilityDraft(node.label, node.data));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(readCapabilityDraft(node.label, node.data));
    setError(null);
  }, [node.id, node.label, node.data]);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      await saveNodePatch("capability", node.id, {
        label: draft.label,
        summary: draft.summary,
        source: draft.source,
        status: draft.status,
        registryKey: draft.registryKey,
        resolverName: draft.resolverName,
        policyFlags: {
          allowGithubSearch: draft.allowGithubSearch,
          allowAutoGenerateSkill: draft.allowAutoGenerateSkill,
          allowAutoGenerateScript: draft.allowAutoGenerateScript,
        },
        specArtifactIds: parseList(draft.specArtifactIds),
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EditorCard title="Capability Editor" busy={busy} error={error} onSave={handleSave}>
      <TextField label="Label" value={draft.label} onChange={(label) => setDraft((current) => ({ ...current, label }))} />
      <TextareaField label="Summary" value={draft.summary} onChange={(summary) => setDraft((current) => ({ ...current, summary }))} />
      <SelectField
        label="Source"
        value={draft.source}
        options={["builtin", "local", "github", "generated", "unresolved"]}
        onChange={(source) => setDraft((current) => ({ ...current, source }))}
      />
      <SelectField
        label="Status"
        value={draft.status}
        options={["unresolved", "resolved", "missing", "ready", "blocked", "failed"]}
        onChange={(status) => setDraft((current) => ({ ...current, status }))}
      />
      <TextField label="Registry Key" value={draft.registryKey} onChange={(registryKey) => setDraft((current) => ({ ...current, registryKey }))} />
      <TextField label="Resolver" value={draft.resolverName} onChange={(resolverName) => setDraft((current) => ({ ...current, resolverName }))} />
      <div className="grid gap-2 rounded-[18px] border border-white/10 bg-slate-950/60 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Policy Flags</div>
        <ToggleField
          label="Allow GitHub Search"
          checked={draft.allowGithubSearch}
          onChange={(allowGithubSearch) => setDraft((current) => ({ ...current, allowGithubSearch }))}
        />
        <ToggleField
          label="Allow Auto Generate Skill"
          checked={draft.allowAutoGenerateSkill}
          onChange={(allowAutoGenerateSkill) => setDraft((current) => ({ ...current, allowAutoGenerateSkill }))}
        />
        <ToggleField
          label="Allow Auto Generate Script"
          checked={draft.allowAutoGenerateScript}
          onChange={(allowAutoGenerateScript) => setDraft((current) => ({ ...current, allowAutoGenerateScript }))}
        />
      </div>
      <TextareaField
        label="Spec Artifact IDs"
        value={draft.specArtifactIds}
        onChange={(specArtifactIds) => setDraft((current) => ({ ...current, specArtifactIds }))}
      />
      <ReadonlyCard title="Artifacts" value={formatArray(node.data.artifacts)} />
    </EditorCard>
  );
}

function EditorCard({
  title,
  busy,
  error,
  onSave,
  children,
}: {
  title: string;
  busy: boolean;
  error: string | null;
  onSave: () => Promise<void>;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2 rounded-[16px] border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[12px] font-semibold text-slate-100">{title}</div>
          <div className="mt-0.5 text-[10px] text-slate-400">Edit selected node and persist it back to the harness.</div>
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="rounded-full bg-sky-400 px-2.5 py-1 text-[10px] font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
      {error ? <p className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">{error}</p> : null}
      <div className="grid gap-2">{children}</div>
    </div>
  );
}

function ReadonlyCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-[14px] border border-white/10 bg-slate-950/60 p-3">
      <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-slate-400">{title}</div>
      <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-4 text-slate-100">{value || "n/a"}</pre>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-[12px] border border-white/10 bg-slate-950/70 px-3 py-1.5 text-[11px] text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/10"
      />
    </label>
  );
}

function TextareaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-14 rounded-[12px] border border-white/10 bg-slate-950/70 px-3 py-2 text-[11px] leading-4 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/10"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-[12px] border border-white/10 bg-slate-950/70 px-3 py-1.5 text-[11px] text-slate-100 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/10"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 rounded-[10px] border border-white/10 bg-white/[0.03] px-2.5 py-1.5">
      <span className="text-[11px] text-slate-200">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 rounded border-white/20 bg-slate-950 text-sky-400 focus:ring-sky-400/30"
      />
    </label>
  );
}

function readAgentDraft(label: string, data: Record<string, unknown>) {
  const model = isRecord(data.model) ? data.model : {};
  return {
    label,
    role: String(data.role ?? ""),
    modelProvider: String(model.provider ?? ""),
    modelName: String(model.model ?? ""),
    modelBaseURL: String(model.baseURL ?? ""),
    modelCredentialRef: String(model.credentialRef ?? ""),
    modelTemperature: String(model.temperature ?? ""),
    modelMaxTokens: String(model.maxTokens ?? ""),
    capabilityIds: formatArray(data.capabilityIds),
  };
}

function readSpecDraft(label: string, data: Record<string, unknown>) {
  return {
    title: label,
    summary: String(data.summary ?? data.contractSummary ?? ""),
    compiledPath: String(data.compiledPath ?? ""),
  };
}

function readCapabilityDraft(label: string, data: Record<string, unknown>) {
  const policyFlags = isRecord(data.policyFlags) ? data.policyFlags : {};
  return {
    label,
    summary: String(data.summary ?? ""),
    source: String(data.source ?? "unresolved"),
    status: String(data.status ?? "unresolved"),
    registryKey: String(data.registryKey ?? ""),
    resolverName: String(data.resolverName ?? ""),
    allowGithubSearch: Boolean(policyFlags.allowGithubSearch),
    allowAutoGenerateSkill: Boolean(policyFlags.allowAutoGenerateSkill),
    allowAutoGenerateScript: Boolean(policyFlags.allowAutoGenerateScript),
    specArtifactIds: formatArray(data.specArtifactIds),
  };
}

function selectFirstNodeOfType(nodes: { type: string; id: string }[], type: NodeKind, setSelectedNodeId: (nodeId: string | null) => void) {
  const first = nodes.find((node) => node.type === type);
  setSelectedNodeId(first?.id ?? null);
}

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function formatArray(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) {
    return "";
  }

  return value.map((item) => String(item)).join(", ");
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "n/a";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
