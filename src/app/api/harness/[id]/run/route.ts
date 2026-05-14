import { NextResponse } from "next/server";
import { RunOrchestratorService } from "@/lib/run-orchestrator";
import type { RunHarnessRequest } from "shared/types";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const orchestrator = new RunOrchestratorService();

  let body: RunHarnessRequest;
  try {
    body = (await request.json()) as RunHarnessRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.taskInstruction !== "string" || body.taskInstruction.trim().length === 0) {
    return NextResponse.json({ error: "taskInstruction is required." }, { status: 400 });
  }
  if (!Array.isArray(body.parameters)) {
    return NextResponse.json({ error: "parameters must be an array." }, { status: 400 });
  }
  if (!body.policy || typeof body.policy !== "object") {
    return NextResponse.json({ error: "policy is required." }, { status: 400 });
  }

  try {
    const result = await orchestrator.startRun(id, {
      taskInstruction: body.taskInstruction.trim(),
      parameters: body.parameters,
      policy: body.policy,
    });

    if (!result) {
      return NextResponse.json({ error: "Harness not found." }, { status: 404 });
    }

    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to start run.",
      },
      { status: 400 },
    );
  }
}
