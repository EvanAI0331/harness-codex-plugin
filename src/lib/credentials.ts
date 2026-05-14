import { readEnvValue } from "@/lib/env";

export function resolveCredentialApiKey(credentialRef?: string): string {
  const reference = credentialRef?.trim();
  if (!reference) {
    throw new Error("Missing credentialRef for LLM request.");
  }

  const envKey = `${reference}_API_KEY`;
  const apiKey = readEnvValue(envKey) ?? process.env[envKey];
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new Error(`Missing server-side secret for credentialRef "${reference}" (${envKey}).`);
  }

  return apiKey.trim();
}
