import { NextResponse } from "next/server";
import { createDraftHarness } from "@/lib/harness-create";

export async function POST(_request: Request) {
  const harness = await createDraftHarness();
  const status = 201;
  return NextResponse.json(harness, { status });
}
