import type { RunSession, SpecArtifact } from "shared/types";
import { getDatabase } from "@/lib/sqlite";

interface RunRow {
  id: string;
  harness_id: string;
  status: RunSession["status"];
  task_instruction: string;
  parameters_json: string;
  policy_json: string;
  output_artifacts_json: string;
  report_artifact_id: string | null;
  output_summary: string | null;
  output_status: RunSession["outputStatus"] | null;
  created_at: string;
  updated_at: string;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeRunSession(session: RunSession): RunSession {
  return {
    ...session,
    outputArtifactIds: Array.isArray(session.outputArtifactIds) ? session.outputArtifactIds : [],
    outputStatus: session.outputStatus ?? "pending",
  };
}

function rowToRunSession(row: RunRow): RunSession {
  return normalizeRunSession({
    id: row.id,
    harnessId: row.harness_id,
    status: row.status,
    taskInstruction: row.task_instruction,
    parameters: parseJson(row.parameters_json, []),
    policy: parseJson(row.policy_json, {
      allowGithubImport: false,
      allowScriptGeneration: false,
      humanApprovalRequired: false,
    }),
    outputArtifactIds: parseJson(row.output_artifacts_json, []),
    reportArtifactId: row.report_artifact_id ?? undefined,
    outputSummary: row.output_summary ?? undefined,
    outputStatus: row.output_status ?? "pending",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function saveRunSession(session: RunSession): RunSession {
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO runs (
      id, harness_id, status, task_instruction, parameters_json, policy_json,
      output_artifacts_json, report_artifact_id, output_summary, output_status,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      harness_id=excluded.harness_id,
      status=excluded.status,
      task_instruction=excluded.task_instruction,
      parameters_json=excluded.parameters_json,
      policy_json=excluded.policy_json,
      output_artifacts_json=excluded.output_artifacts_json,
      report_artifact_id=excluded.report_artifact_id,
      output_summary=excluded.output_summary,
      output_status=excluded.output_status,
      updated_at=excluded.updated_at
  `,
  ).run(
    session.id,
    session.harnessId,
    session.status,
    session.taskInstruction,
    JSON.stringify(session.parameters),
    JSON.stringify(session.policy),
    JSON.stringify(session.outputArtifactIds ?? []),
    session.reportArtifactId ?? null,
    session.outputSummary ?? null,
    session.outputStatus ?? "pending",
    session.createdAt,
    session.updatedAt,
  );

  return normalizeRunSession(session);
}

export function getRunSessionById(runId: string): RunSession | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `
      SELECT id, harness_id, status, task_instruction, parameters_json, policy_json,
             output_artifacts_json, report_artifact_id, output_summary, output_status,
             created_at, updated_at
      FROM runs
      WHERE id = ?
    `,
    )
    .get(runId) as RunRow | undefined;

  if (!row) {
    return null;
  }

  return rowToRunSession(row);
}

export function listRunSessionsByHarness(harnessId: string): RunSession[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `
      SELECT id, harness_id, status, task_instruction, parameters_json, policy_json,
             output_artifacts_json, report_artifact_id, output_summary, output_status,
             created_at, updated_at
      FROM runs
      WHERE harness_id = ?
      ORDER BY created_at DESC
    `,
    )
    .all(harnessId) as unknown as RunRow[];

  return rows.map(rowToRunSession);
}

export function saveRunOutputArtifacts(runId: string, artifacts: SpecArtifact[]): SpecArtifact[] {
  const session = getRunSessionById(runId);
  if (!session) {
    return artifacts;
  }

  const outputArtifactIds = Array.from(new Set([...(session.outputArtifactIds ?? []), ...artifacts.map((artifact) => artifact.id)]));
  const reportArtifactId =
    artifacts.find((artifact) => artifact.specType === "final.report")?.id ??
    artifacts.find((artifact) => artifact.specType === "run.report")?.id ??
    session.reportArtifactId;

  saveRunSession({
    ...session,
    outputArtifactIds,
    reportArtifactId,
    outputStatus: artifacts.length > 0 ? "success" : session.outputStatus ?? "pending",
    updatedAt: new Date().toISOString(),
  });

  return artifacts;
}
