import { makeId } from "@/lib/id";
import { nowIso } from "@/lib/time";
import { getDatabase } from "@/lib/sqlite";
import type { ArtifactReference, RunArtifact } from "shared/types";

interface ArtifactRow {
  id: string;
  run_id: string;
  harness_id: string;
  node_id: string | null;
  type: string;
  title: string;
  content_json: string;
  content_text: string;
  summary: string;
  created_at: string;
}

export interface CreateArtifactInput {
  id?: string;
  runId: string;
  harnessId: string;
  nodeId?: string | null;
  type: string;
  title: string;
  contentJson: unknown;
  contentText?: string;
  summary?: string;
  createdAt?: string;
}

export function createArtifact(input: CreateArtifactInput): RunArtifact {
  const db = getDatabase();
  const createdAt = input.createdAt ?? nowIso();
  const id = input.id ?? makeId("artifact");
  const contentJson = JSON.stringify(input.contentJson ?? null);
  const contentText = normalizeContentText(input.contentText, input.contentJson);
  const summary = normalizeSummary(input.summary, input.title);

  db.prepare(
    `
    INSERT INTO artifacts (
      id, run_id, harness_id, node_id, "type", title, content_json, content_text, summary, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      run_id=excluded.run_id,
      harness_id=excluded.harness_id,
      node_id=excluded.node_id,
      "type"=excluded."type",
      title=excluded.title,
      content_json=excluded.content_json,
      content_text=excluded.content_text,
      summary=excluded.summary
  `,
  ).run(
    id,
    input.runId,
    input.harnessId,
    input.nodeId ?? null,
    input.type,
    input.title,
    contentJson,
    contentText,
    summary,
    createdAt,
  );

  return {
    id,
    runId: input.runId,
    harnessId: input.harnessId,
    nodeId: input.nodeId ?? null,
    type: input.type,
    title: input.title,
    contentJson: input.contentJson,
    contentText,
    summary,
    createdAt,
  };
}

export function listArtifactsByRun(runId: string): RunArtifact[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `
      SELECT id, run_id, harness_id, node_id, "type", title, content_json, content_text, summary, created_at
      FROM artifacts
      WHERE run_id = ?
      ORDER BY created_at DESC, id DESC
    `,
    )
    .all(runId) as unknown as ArtifactRow[];

  return rows.map(rowToArtifact);
}

export function getArtifactById(artifactId: string): RunArtifact | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `
      SELECT id, run_id, harness_id, node_id, "type", title, content_json, content_text, summary, created_at
      FROM artifacts
      WHERE id = ?
    `,
    )
    .get(artifactId) as ArtifactRow | undefined;

  return row ? rowToArtifact(row) : null;
}

export function getLatestArtifactForNode(runId: string, nodeId: string): RunArtifact | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `
      SELECT id, run_id, harness_id, node_id, "type", title, content_json, content_text, summary, created_at
      FROM artifacts
      WHERE run_id = ? AND node_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    )
    .get(runId, nodeId) as ArtifactRow | undefined;

  return row ? rowToArtifact(row) : null;
}

export function getRunFinalOutput(runId: string): RunArtifact | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `
      SELECT id, run_id, harness_id, node_id, "type", title, content_json, content_text, summary, created_at
      FROM artifacts
      WHERE run_id = ? AND ("type" = 'final.deliverable' OR "type" = 'report.final' OR "type" = 'run.output' OR "type" = 'run_final_output')
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    )
    .get(runId) as ArtifactRow | undefined;

  return row ? rowToArtifact(row) : null;
}

export function getRunErrorArtifact(runId: string): RunArtifact | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `
      SELECT id, run_id, harness_id, node_id, "type", title, content_json, content_text, summary, created_at
      FROM artifacts
      WHERE run_id = ? AND ("type" = 'run.error' OR "type" = 'error.report')
      ORDER BY CASE "type" WHEN 'run.error' THEN 0 ELSE 1 END, created_at DESC, id DESC
      LIMIT 1
    `,
    )
    .get(runId) as ArtifactRow | undefined;

  return row ? rowToArtifact(row) : null;
}

export function toArtifactReference(artifact: RunArtifact): ArtifactReference {
  return {
    id: artifact.id,
    runId: artifact.runId,
    harnessId: artifact.harnessId,
    nodeId: artifact.nodeId,
    type: artifact.type,
    title: artifact.title,
    summary: artifact.summary,
    createdAt: artifact.createdAt,
  };
}

function rowToArtifact(row: ArtifactRow): RunArtifact {
  return {
    id: row.id,
    runId: row.run_id,
    harnessId: row.harness_id,
    nodeId: row.node_id,
    type: row.type,
    title: row.title,
    contentJson: parseJson(row.content_json, null),
    contentText: row.content_text,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

function normalizeContentText(contentText: string | undefined, contentJson: unknown): string {
  if (typeof contentText === "string") {
    return contentText;
  }
  if (typeof contentJson === "string") {
    return contentJson;
  }
  if (contentJson && typeof contentJson === "object") {
    const candidate = contentJson as { contentText?: unknown; summary?: unknown; title?: unknown; message?: unknown };
    if (typeof candidate.contentText === "string") {
      return candidate.contentText;
    }
    if (typeof candidate.summary === "string") {
      return candidate.summary;
    }
    if (typeof candidate.title === "string") {
      return candidate.title;
    }
    if (typeof candidate.message === "string") {
      return candidate.message;
    }
  }
  return "";
}

function normalizeSummary(summary: string | undefined, title: string): string {
  return typeof summary === "string" && summary.trim().length > 0 ? summary : title;
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
