"use client";

import { useEffect, useRef } from "react";
import type { Harness, HarnessEvent } from "shared/types";
import { useHarnessStore } from "@/store/useHarnessStore";

export function useEventStream(harnessId: string | null, options: { initialHarness?: Harness | null } = {}) {
  const appendEvent = useHarnessStore((state) => state.appendEvent);
  const hydrateHarness = useHarnessStore((state) => state.hydrateHarness);
  const patchNodeStatus = useHarnessStore((state) => state.patchNodeStatus);
  const refreshTimer = useRef<number | null>(null);

  useEffect(() => {
    if (options.initialHarness) {
      hydrateHarness(options.initialHarness);
    }
  }, [hydrateHarness, options.initialHarness]);

  useEffect(() => {
    if (!harnessId) {
      return;
    }

    const source = new EventSource(`/api/harness/${harnessId}/events`);
    const handleEvent = (event: MessageEvent) => {
      const payload = JSON.parse(event.data) as HarnessEvent;
      appendEvent(payload);
      patchFromEvent(payload, patchNodeStatus);
      if (shouldRefreshSnapshot(payload)) {
        if (refreshTimer.current) {
          window.clearTimeout(refreshTimer.current);
        }
        refreshTimer.current = window.setTimeout(() => {
          void refreshHarnessSnapshot(harnessId, hydrateHarness).catch(() => undefined);
          refreshTimer.current = null;
        }, 300);
      }
    };

    source.addEventListener("harness.event", handleEvent);
    source.onmessage = handleEvent;

    return () => {
      source.removeEventListener("harness.event", handleEvent);
      source.close();
      if (refreshTimer.current) {
        window.clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
  }, [appendEvent, harnessId, hydrateHarness, patchNodeStatus]);
}

async function refreshHarnessSnapshot(harnessId: string, hydrateHarness: (harness: Harness) => void): Promise<void> {
  const response = await fetch(`/api/harness/${harnessId}`);
  if (!response.ok) {
    throw new Error(await response.text());
  }

  const harness = (await response.json()) as Harness;
  hydrateHarness(harness);
}

function shouldRefreshSnapshot(event: HarnessEvent): boolean {
  return event.kind === "build.completed" || event.kind === "build.failed" || event.kind === "run.completed" || event.kind === "run.failed";
}

function patchFromEvent(event: HarnessEvent, patchNodeStatus: (nodeId: string, status: string, dataPatch?: Record<string, unknown>) => void): void {
  const payload = event.payload as Record<string, unknown>;
  if (event.kind.startsWith("runtime.tool.")) {
    return;
  }

  if (event.kind.startsWith("node.") || event.kind.startsWith("runtime.")) {
    const nodeId = typeof payload.nodeId === "string" ? payload.nodeId : null;
    const status = typeof payload.status === "string" ? payload.status : event.kind === "node.failed" ? "failed" : event.kind === "node.completed" ? "completed" : "running";
    if (nodeId) {
      patchNodeStatus(nodeId, status, {
        nodeName: payload.nodeName,
        action: payload.action,
        summary: payload.summary,
        error: payload.error,
      });
    }
  }

  if (event.kind === "capability.resolved" || event.kind === "capability.missing" || event.kind === "script.generated" || event.kind === "skill.generated") {
    const capabilityId = typeof payload.capabilityId === "string" ? payload.capabilityId : null;
    if (capabilityId) {
      patchNodeStatus(capabilityId, event.kind === "capability.missing" ? "missing" : "resolved", {
        source: payload.source,
        registryKey: payload.registryKey,
        artifactId: payload.artifactId,
      });
    }
  }

  if (
    event.kind === "skill.output.started" ||
    event.kind === "script.output.started"
  ) {
    const agentId = typeof payload.agentId === "string" ? payload.agentId : null;
    if (agentId) {
      patchNodeStatus(agentId, "running", {
        resetOutput: true,
        outputKind: payload.outputKind,
        fileName: payload.fileName,
      });
    }
  }

  if (event.kind === "skill.output.chunk" || event.kind === "script.output.chunk") {
    const agentId = typeof payload.agentId === "string" ? payload.agentId : null;
    const chunkText = typeof payload.chunkText === "string" ? payload.chunkText : "";
    if (agentId && chunkText) {
      patchNodeStatus(agentId, "running", {
        outputChunk: chunkText,
        outputKind: payload.outputKind,
        fileName: payload.fileName,
        chunkIndex: payload.chunkIndex,
        chunkCount: payload.chunkCount,
      });
    }
  }

  if (
    event.kind === "skill.generated" ||
    event.kind === "script.generated" ||
    event.kind === "skill.compiled" ||
    event.kind === "script.compiled" ||
    event.kind === "skill.failed" ||
    event.kind === "script.failed"
  ) {
    const agentId = typeof payload.agentId === "string" ? payload.agentId : null;
    if (agentId) {
      const patch: Record<string, unknown> = {
        skillArtifactId: event.kind.startsWith("skill") ? payload.artifactId : undefined,
        scriptArtifactId: event.kind.startsWith("script") ? payload.artifactId : undefined,
        compiledPath: payload.compiledPath,
        stdout: payload.stdout,
        stderr: payload.stderr,
      };
      patchNodeStatus(agentId, event.kind.includes("failed") ? "failed" : "completed", {
        ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
      });
    }
  }

  if (
    event.kind === "spec.generated" ||
    event.kind === "spec.compiled" ||
    event.kind === "spec.failed" ||
    event.kind === "spec.contract.generated" ||
    event.kind === "spec.contract.compiled" ||
    event.kind === "spec.contract.backtest.passed" ||
    event.kind === "spec.contract.backtest.failed" ||
    event.kind === "spec.backtest.passed" ||
    event.kind === "spec.backtest.failed"
  ) {
    const agentId = typeof payload.agentId === "string" ? payload.agentId : null;
    if (agentId) {
      patchNodeStatus(agentId, event.kind.includes("failed") ? "failed" : "completed", {
        specArtifactId: payload.artifactId ?? payload.sourceArtifactId,
        compiledPath: payload.compiledPath,
        stdout: payload.stdout,
        stderr: payload.stderr,
        backtestStderr: payload.backtestStderr,
        backtestStatus: event.kind.includes("failed") ? "failure" : event.kind.includes("passed") ? "success" : undefined,
      });
    }
  }

  if (event.kind === "build.started") {
    const harnessId = event.harnessId;
    patchNodeStatus(harnessId, "building", {
      summary: event.message,
    });
  }
  if (event.kind === "build.completed") {
    patchNodeStatus(event.harnessId, "ready", {
      summary: event.message,
    });
  }
  if (event.kind === "build.failed") {
    patchNodeStatus(event.harnessId, "failed", {
      summary: event.message,
    });
  }

  if (event.kind.startsWith("plan.") && typeof payload.nodeId === "string") {
    const progressPatch: Record<string, unknown> = {
      summary: event.message,
    };
    if (typeof payload.summary === "string") {
      progressPatch.latestOutput = payload.summary;
    }
    patchNodeStatus(payload.nodeId, "building", {
      ...progressPatch,
    });
  }
}
