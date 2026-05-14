"use client";

import { useState } from "react";
import type { CreateHarnessRequest, ModelConfig } from "shared/types";

const DEFAULT_MAIN_MODEL: ModelConfig = {
  provider: "openai_compatible",
  model: "qwen3.6-plus",
  temperature: 0.2,
  maxTokens: 4096,
};

const DEFAULT_REQUEST: CreateHarnessRequest = {
  goal: "Build a public harness for repository audit, architecture inspection, and artifact-driven runtime tracing.",
  mainModel: DEFAULT_MAIN_MODEL,
  auxiliaryModel: {
    ...DEFAULT_MAIN_MODEL,
    model: "qwen3.6-plus",
    temperature: 0.1,
    maxTokens: 2048,
  },
  codingAgentModel: deriveCodingAgentModel(DEFAULT_MAIN_MODEL),
  capabilityPolicy: {
    allowGithubSearch: true,
    allowAutoGenerateSkill: true,
    allowAutoGenerateScript: true,
  },
};

interface RequirementFormProps {
  initialRequest?: CreateHarnessRequest;
  submitLabel?: string;
  onSubmit: (request: CreateHarnessRequest) => Promise<void> | void;
  busy?: boolean;
  statusValue?: string;
}

export default function RequirementForm({
  initialRequest,
  submitLabel = "Generate Harness",
  onSubmit,
  busy = false,
  statusValue,
}: RequirementFormProps) {
  const [form, setForm] = useState<CreateHarnessRequest>(initialRequest ?? DEFAULT_REQUEST);

  return (
    <form
      className="grid gap-1.5"
      onSubmit={async (event) => {
        event.preventDefault();
        await onSubmit(form);
      }}
    >
      <div className="flex flex-wrap items-center gap-1.5 rounded-[12px] border border-white/10 bg-slate-950/50 px-2 py-1.5">
        <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Capability Policy</span>
        <CompactToggleField
          label="GitHub Search"
          checked={form.capabilityPolicy.allowGithubSearch}
          onChange={(checked) =>
            setForm((current) => ({
              ...current,
              capabilityPolicy: { ...current.capabilityPolicy, allowGithubSearch: checked },
            }))
          }
        />
        <CompactToggleField
          label="Skill on"
          checked={form.capabilityPolicy.allowAutoGenerateSkill}
          onChange={(checked) =>
            setForm((current) => ({
              ...current,
              capabilityPolicy: { ...current.capabilityPolicy, allowAutoGenerateSkill: checked },
            }))
          }
        />
        <CompactToggleField
          label="Script on"
          checked={form.capabilityPolicy.allowAutoGenerateScript}
          onChange={(checked) =>
            setForm((current) => ({
              ...current,
              capabilityPolicy: { ...current.capabilityPolicy, allowAutoGenerateScript: checked },
            }))
          }
        />
        <div className="ml-auto">
          <StatusChip label="Status" value={statusValue ?? "draft"} />
        </div>
      </div>

      <section className="grid gap-1">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-semibold text-slate-100">Harness Goal</label>
          <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Draft only</span>
        </div>
        <textarea
          className="min-h-14 w-full rounded-[12px] border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[11px] leading-4 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/10"
          value={form.goal}
          placeholder="输入一句话需求"
          onChange={(event) => setForm((current) => ({ ...current, goal: event.target.value }))}
        />
      </section>

      <div className="flex items-center justify-end gap-2">
        <button type="submit" disabled={busy} className="rounded-full bg-sky-400 px-2.5 py-1 text-[10px] font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-60">
          {busy ? "Working..." : submitLabel}
        </button>
      </div>
    </form>
  );
}

function CompactToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-slate-200">
      <span className="whitespace-nowrap leading-4">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 rounded border-slate-500 bg-slate-900 text-sky-400 focus:ring-sky-400"
      />
    </label>
  );
}

function StatusChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-300">
      <span>{label}</span>
      <span className="text-slate-100">{value}</span>
    </span>
  );
}

function deriveCodingAgentModel(mainModel: ModelConfig): ModelConfig {
  return {
    ...mainModel,
    model: "qwen3-coder-plus",
  };
}
