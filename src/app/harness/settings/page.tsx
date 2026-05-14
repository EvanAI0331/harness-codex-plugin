import SettingsPage from "@/components/SettingsPage";
import { readEnvFile } from "@/lib/env";

export const metadata = {
  title: "Runtime Settings",
};

export default function HarnessSettingsRoute() {
  const env = readEnvFile();
  return (
    <SettingsPage
      initialValues={{
        DEFAULT_LLM_PROVIDER: env.DEFAULT_LLM_PROVIDER ?? env.LLM_PROVIDER ?? "openai_compatible",
        DEFAULT_LLM_MODEL: env.DEFAULT_LLM_MODEL ?? env.LLM_MODEL ?? "qwen3.6-plus",
        DEFAULT_LLM_BASE_URL: env.DEFAULT_LLM_BASE_URL ?? env.LLM_BASE_URL ?? "https://api.openai.com/v1",
        DEFAULT_LLM_CREDENTIAL_REF: env.DEFAULT_LLM_CREDENTIAL_REF ?? env.LLM_CREDENTIAL_REF ?? "OPENAI_MAIN",
        DEFAULT_LLM_TEMPERATURE: env.DEFAULT_LLM_TEMPERATURE ?? env.LLM_TEMPERATURE ?? "0.2",
        DEFAULT_LLM_MAX_TOKENS: env.DEFAULT_LLM_MAX_TOKENS ?? env.LLM_MAX_TOKENS ?? "4096",
        LLM_REQUEST_TIMEOUT_MS: env.LLM_REQUEST_TIMEOUT_MS ?? "120000",
        GITHUB_USERNAME: env.GITHUB_USERNAME ?? "",
        GITHUB_PASSWORD: env.GITHUB_PASSWORD ?? "",
      }}
    />
  );
}
