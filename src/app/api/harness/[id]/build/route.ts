import { NextResponse } from "next/server";
import { BuildOrchestratorService } from "@/lib/build-orchestrator";
import type { BuildHarnessRequest, ModelConfig } from "shared/types";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const orchestrator = new BuildOrchestratorService();

  let body: Partial<BuildHarnessRequest>;
  try {
    body = (await request.json()) as Partial<BuildHarnessRequest>;
  } catch {
    body = {};
  }

  if (typeof body.goal !== "string" || body.goal.trim().length === 0) {
    return NextResponse.json({ error: "goal is required." }, { status: 400 });
  }
  if (!isModelConfig(body.mainModel) || !isModelConfig(body.auxiliaryModel)) {
    return NextResponse.json({ error: "mainModel and auxiliaryModel are required." }, { status: 400 });
  }
  if (!body.capabilityPolicy || typeof body.capabilityPolicy !== "object") {
    return NextResponse.json({ error: "capabilityPolicy is required." }, { status: 400 });
  }

  const mainModel = body.mainModel as ModelConfig;
  const auxiliaryModel = body.auxiliaryModel as ModelConfig;
  const codingAgentModel = isModelConfig(body.codingAgentModel) ? (body.codingAgentModel as ModelConfig) : deriveCodingAgentModel(mainModel);

  const normalizedRequest: BuildHarnessRequest = {
    ...body,
    goal: body.goal.trim(),
    mainModel,
    auxiliaryModel,
    codingAgentModel,
    capabilityPolicy: body.capabilityPolicy,
  };

  const result = await orchestrator.runBuild(id, normalizedRequest);

  if (!result) {
    return NextResponse.json({ error: "Harness not found." }, { status: 404 });
  }

  const status = result.harness.status === "failed" ? 500 : 200;
  return NextResponse.json(result.harness, { status });
}

function isModelConfig(value: unknown): value is ModelConfig {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { provider?: unknown }).provider === "string" &&
      typeof (value as { model?: unknown }).model === "string" &&
      (typeof (value as { baseURL?: unknown }).baseURL === "string" || typeof (value as { baseURL?: unknown }).baseURL === "undefined") &&
      (typeof (value as { credentialRef?: unknown }).credentialRef === "string" || typeof (value as { credentialRef?: unknown }).credentialRef === "undefined") &&
      typeof (value as { temperature?: unknown }).temperature === "number" &&
      typeof (value as { maxTokens?: unknown }).maxTokens === "number",
  );
}

function deriveCodingAgentModel(mainModel: ModelConfig): ModelConfig {
  return {
    ...mainModel,
    model: "qwen3-coder-plus",
  };
}
