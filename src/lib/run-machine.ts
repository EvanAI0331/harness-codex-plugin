import type { RunHarnessRequest, RunSession, RunStatus } from "shared/types";
import { nowIso } from "@/lib/time";
import { makeId } from "@/lib/id";

export function createRunSession(harnessId: string, request: RunHarnessRequest): RunSession {
  const createdAt = nowIso();
  return {
    id: makeId("run"),
    harnessId,
    status: "running",
    taskInstruction: request.taskInstruction,
    parameters: request.parameters,
    policy: request.policy,
    outputArtifactIds: [],
    createdAt,
    updatedAt: createdAt,
  };
}

export function startRunSession(session: RunSession): RunSession {
  return transitionRunSession(session, "running");
}

export function pauseRunSession(session: RunSession): RunSession {
  return transitionRunSession(session, "paused");
}

export function completeRunSession(session: RunSession, patch: Partial<RunSession> = {}): RunSession {
  return transitionRunSession(session, "completed", patch);
}

export function failRunSession(session: RunSession, patch: Partial<RunSession> = {}): RunSession {
  return transitionRunSession(session, "failed", patch);
}

export function cancelRunSession(session: RunSession, patch: Partial<RunSession> = {}): RunSession {
  return transitionRunSession(session, "cancelled", patch);
}

export function transitionRunSession(session: RunSession, nextStatus: RunStatus, patch: Partial<RunSession> = {}): RunSession {
  if (!canTransitionRunStatus(session.status, nextStatus)) {
    throw new Error(`Invalid run status transition from ${session.status} to ${nextStatus}.`);
  }

  return {
    ...session,
    ...patch,
    status: nextStatus,
    updatedAt: nowIso(),
  };
}

export function canTransitionRunStatus(current: RunStatus, next: RunStatus): boolean {
  if (current === next) {
    return true;
  }

  if (current === "idle") {
    return next === "running" || next === "cancelled";
  }

  if (current === "running") {
    return next === "paused" || next === "completed" || next === "failed" || next === "cancelled";
  }

  if (current === "paused") {
    return next === "running" || next === "cancelled" || next === "failed";
  }

  return next === current;
}
