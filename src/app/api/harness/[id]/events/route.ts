import { listHarnessEvents } from "@/lib/harness-repository";
import { subscribeHarnessEvents } from "@/lib/harness-event-bus";
import { formatHarnessEventSse, formatSseComment } from "@/lib/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: Uint8Array) => controller.enqueue(chunk);
      const existingEvents = listHarnessEvents(id);

      send(formatSseComment(`harness:${id}`));
      existingEvents.forEach((event) => send(formatHarnessEventSse(event)));

      const unsubscribe = subscribeHarnessEvents(id, (event) => {
        send(formatHarnessEventSse(event));
      });

      const heartbeat = setInterval(() => {
        send(formatSseComment("ping"));
      }, 15000);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        controller.close();
      };

      requestSignalAbort(_request, cleanup);
    },
    cancel() {
      // Cleanup is handled through the abort signal listener.
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

function requestSignalAbort(request: Request, cleanup: () => void): void {
  if (request.signal.aborted) {
    cleanup();
    return;
  }

  request.signal.addEventListener("abort", cleanup, { once: true });
}
