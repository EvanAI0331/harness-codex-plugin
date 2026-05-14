import type { PlannerLLMConfig } from "shared/types";

export interface LLMJsonRequest {
  config: PlannerLLMConfig;
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
}

export interface LLMJsonResponse {
  rawText: string;
  rawPayload: unknown;
  model: string;
  provider: string;
  requestedAt: string;
  respondedAt: string;
}

export interface LLMAdapter {
  generateJson(request: LLMJsonRequest): Promise<LLMJsonResponse>;
}
