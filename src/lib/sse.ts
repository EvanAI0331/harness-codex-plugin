import type { HarnessEvent } from "shared/types";

const encoder = new TextEncoder();

export function formatHarnessEventSse(event: HarnessEvent): Uint8Array {
  return encoder.encode(`event: harness.event\ndata: ${JSON.stringify(event)}\n\n`);
}

export function formatSseComment(comment: string): Uint8Array {
  return encoder.encode(`: ${comment}\n\n`);
}
