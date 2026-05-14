import type { LLMAdapter, LLMJsonRequest, LLMJsonResponse } from "@/lib/llm/types";
import { readEnvValue } from "@/lib/env";
import { resolveCredentialApiKey } from "@/lib/credentials";

const MAX_RETRY_ATTEMPTS = 3;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

let llmRequestQueue: Promise<unknown> = Promise.resolve();

export class OpenAICompatibleLLMAdapter implements LLMAdapter {
  async generateJson(request: LLMJsonRequest): Promise<LLMJsonResponse> {
    return enqueueLLMRequest(() => this.generateJsonInternal(request));
  }

  private async generateJsonInternal(request: LLMJsonRequest): Promise<LLMJsonResponse> {
    const requestedAt = new Date().toISOString();
    const baseURL = normalizeBaseUrl(request.config.baseURL?.trim() || readEnvValue("DEFAULT_LLM_BASE_URL", "LLM_BASE_URL") || "https://api.openai.com/v1");
    const apiKey = resolveCredentialApiKey(request.config.credentialRef ?? readEnvValue("DEFAULT_LLM_CREDENTIAL_REF", "LLM_CREDENTIAL_REF") ?? undefined);

    const timeoutMs = Number(readEnvValue("LLM_REQUEST_TIMEOUT_MS") ?? 120000);

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${baseURL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: request.config.model,
            temperature: request.config.temperature,
            max_tokens: request.config.maxTokens,
            messages: [
              {
                role: "system",
                content: request.systemPrompt,
              },
              {
                role: "user",
                content: request.userPrompt,
              },
            ],
            response_format: { type: "json_object" },
          }),
        });

        const respondedAt = new Date().toISOString();
        const rawPayload = await readResponsePayload(response);

        if (!response.ok) {
          const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
          const retryable = RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_RETRY_ATTEMPTS;
          if (retryable) {
            lastError = new Error(formatLLMError(response.status, rawPayload));
            await delay(retryAfterMs ?? backoffDelayMs(attempt));
            continue;
          }

          throw new Error(formatLLMError(response.status, rawPayload));
        }

        const rawText = extractContent(rawPayload);
        if (!rawText) {
          throw new Error("LLM response did not include assistant content.");
        }

        return {
          rawText,
          rawPayload,
          model: request.config.model,
          provider: request.config.provider,
          requestedAt,
          respondedAt,
        };
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        lastError = normalized;
        if (isRetryableError(normalized) && attempt < MAX_RETRY_ATTEMPTS) {
          await delay(backoffDelayMs(attempt));
          continue;
        }
        throw normalized;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError ?? new Error("LLM request failed.");
  }
}

function normalizeBaseUrl(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function extractContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return "";
  }

  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  const content = first?.message?.content;
  return typeof content === "string" ? content : "";
}

function enqueueLLMRequest<T>(task: () => Promise<T>): Promise<T> {
  const next = llmRequestQueue.then(task, task);
  llmRequestQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return (await response.json()) as unknown;
    } catch {
      return { error: { message: "Failed to parse JSON response." } };
    }
  }

  try {
    return await response.text();
  } catch {
    return "";
  }
}

function formatLLMError(status: number, payload: unknown): string {
  return `LLM request failed with status ${status}: ${safeStringify(payload)}`;
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.max(0, numeric * 1000);
  }

  const parsedDate = Date.parse(value);
  if (!Number.isNaN(parsedDate)) {
    return Math.max(0, parsedDate - Date.now());
  }

  return null;
}

function backoffDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 8000);
}

function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return message.includes("throttl") || message.includes("429") || message.includes("503") || message.includes("502") || message.includes("504");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
