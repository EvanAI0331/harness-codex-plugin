"use client";

import { useState, type ReactNode } from "react";
import HarnessTopNav from "@/components/HarnessTopNav";

interface SettingsPageProps {
  initialValues: Record<string, string>;
}

export default function SettingsPage({ initialValues }: SettingsPageProps) {
  const [values, setValues] = useState(initialValues);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(values),
      });
      const payload = (await response.json()) as { error?: string; ok?: boolean; settings?: Record<string, string> };

      if (!response.ok || !payload.ok || !payload.settings) {
        throw new Error(payload.error ?? "Failed to save settings.");
      }

      setValues(payload.settings);
      setMessage("Runtime settings saved to .env.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <HarnessTopNav active="settings" />
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-[1240px] flex-col gap-5 px-5 py-6 lg:px-6">
        <header className="rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,19,33,.92),rgba(7,12,22,.88))] px-6 py-5 shadow-2xl shadow-black/20 backdrop-blur">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-300">
                Runtime Settings
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium text-slate-300">
                .env writer
              </span>
            </div>
            <h1 className="text-[30px] font-semibold tracking-[-0.03em] text-white md:text-[34px]">Runtime Settings</h1>
            <p className="max-w-3xl text-[15px] leading-7 text-slate-300">
              Secrets are resolved server-side via <code>credentialRef</code> and environment variables. 前端只保存运行时默认值，不直接传递密钥。
            </p>
          </div>
        </header>

        {error ? <p className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p> : null}
        {message ? <p className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{message}</p> : null}

        <section className="rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,19,33,.92),rgba(7,12,22,.88))] p-6 shadow-2xl shadow-black/20 backdrop-blur">
          <div className="grid gap-6">
            <SettingsBlock title="LLM Runtime" description="这些值控制默认模型连接与采样参数。">
              <div className="grid gap-4 md:grid-cols-2">
                <SettingField
                  label="Provider"
                  value={values.DEFAULT_LLM_PROVIDER}
                  onChange={(value) => setValues((current) => ({ ...current, DEFAULT_LLM_PROVIDER: value }))}
                  helpText="推荐值：openai_compatible。可手动修改。"
                />
                <SettingField
                  label="Model"
                  value={values.DEFAULT_LLM_MODEL}
                  onChange={(value) => setValues((current) => ({ ...current, DEFAULT_LLM_MODEL: value }))}
                  helpText="推荐值：qwen3.6-plus。可手动修改。"
                />
                <SettingField
                  label="URL"
                  value={values.DEFAULT_LLM_BASE_URL}
                  onChange={(value) => setValues((current) => ({ ...current, DEFAULT_LLM_BASE_URL: value }))}
                  helpText="推荐值：https://api.openai.com/v1。可手动修改。"
                />
                <SettingField
                  label="Credential Ref"
                  value={values.DEFAULT_LLM_CREDENTIAL_REF}
                  onChange={(value) => setValues((current) => ({ ...current, DEFAULT_LLM_CREDENTIAL_REF: value }))}
                  helpText="对应服务端环境变量前缀，例如 OPENAI_MAIN。"
                />
                <SettingField
                  label="Temperature"
                  type="number"
                  value={values.DEFAULT_LLM_TEMPERATURE}
                  onChange={(value) => setValues((current) => ({ ...current, DEFAULT_LLM_TEMPERATURE: value }))}
                  helpText="推荐值：0.2。空或非法值会回落到默认值。可手动修改。"
                />
                <SettingField
                  label="Max Tokens"
                  type="number"
                  value={values.DEFAULT_LLM_MAX_TOKENS}
                  onChange={(value) => setValues((current) => ({ ...current, DEFAULT_LLM_MAX_TOKENS: value }))}
                  helpText="推荐值：4096。可手动修改。"
                />
                <SettingField
                  label="Request Timeout MS"
                  type="number"
                  value={values.LLM_REQUEST_TIMEOUT_MS}
                  onChange={(value) => setValues((current) => ({ ...current, LLM_REQUEST_TIMEOUT_MS: value }))}
                  helpText="推荐值：120000。可手动修改。"
                />
              </div>
            </SettingsBlock>

            <SettingsBlock title="GitHub Credentials" description="GitHub 登录凭据仅用于本地执行器，不会回传到前端或仓库。">
              <div className="grid gap-4 md:grid-cols-2">
                <SettingField
                  label="GitHub Username"
                  value={values.GITHUB_USERNAME}
                  onChange={(value) => setValues((current) => ({ ...current, GITHUB_USERNAME: value }))}
                  helpText="可选，GitHub 登录用户名。"
                />
                <SettingField
                  label="GitHub Password"
                  type="password"
                  value={values.GITHUB_PASSWORD}
                  onChange={(value) => setValues((current) => ({ ...current, GITHUB_PASSWORD: value }))}
                  helpText="可选，GitHub 登录密码。"
                />
              </div>
            </SettingsBlock>
          </div>

          <div className="mt-6 flex items-center justify-between gap-3">
            <p className="text-xs leading-6 text-slate-400">留空会从 `.env` 删除对应项。Secrets are resolved server-side via credentialRef and environment variables.</p>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy}
              className="rounded-full bg-sky-400 px-3 py-1.5 text-[10px] font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Saving..." : "Save Settings"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function SettingsBlock({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-4 space-y-1">
        <h2 className="text-[12px] font-semibold text-slate-100">{title}</h2>
        <p className="text-[10px] leading-5 text-slate-400">{description}</p>
      </div>
      {children}
    </div>
  );
}

function SettingField({
  label,
  value,
  onChange,
  type = "text",
  helpText,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  helpText?: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-[12px] font-semibold text-slate-100">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-2.5 text-[10px] text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-sky-400 focus:ring-4 focus:ring-sky-400/10"
      />
      {helpText ? <span className="text-[10px] leading-5 text-slate-400">{helpText}</span> : null}
    </label>
  );
}
