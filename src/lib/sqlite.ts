import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readArtifactDir, readDatabasePath } from "@/lib/env";

let database: DatabaseSync | null = null;

function initializeDatabase(): DatabaseSync {
  const databasePath = resolveWorkspacePath(readDatabasePath());
  const dataDir = path.dirname(databasePath);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(resolveWorkspacePath(readArtifactDir()), { recursive: true });

  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS harnesses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      intake_json TEXT NOT NULL,
      blueprint_json TEXT,
      spec_artifacts_json TEXT NOT NULL,
      agent_nodes_json TEXT NOT NULL,
      capability_nodes_json TEXT NOT NULL,
      edges_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS harness_events (
      id TEXT PRIMARY KEY,
      harness_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      phase TEXT NOT NULL,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(harness_id) REFERENCES harnesses(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_harness_events_harness_created
      ON harness_events(harness_id, created_at);

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      harness_id TEXT NOT NULL,
      status TEXT NOT NULL,
      task_instruction TEXT NOT NULL,
      parameters_json TEXT NOT NULL,
      policy_json TEXT NOT NULL,
      output_artifacts_json TEXT NOT NULL,
      report_artifact_id TEXT,
      output_summary TEXT,
      output_status TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(harness_id) REFERENCES harnesses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_instances (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL UNIQUE,
      harness_id TEXT NOT NULL,
      task_instruction TEXT NOT NULL,
      goal TEXT NOT NULL,
      constraints_json TEXT NOT NULL,
      success_criteria_json TEXT NOT NULL,
      per_agent_assignments_json TEXT NOT NULL,
      final_deliverable_json TEXT NOT NULL DEFAULT '{}',
      planning_summary TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE,
      FOREIGN KEY(harness_id) REFERENCES harnesses(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_task_instances_harness_created
      ON task_instances(harness_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      harness_id TEXT NOT NULL,
      node_id TEXT,
      "type" TEXT NOT NULL,
      title TEXT NOT NULL,
      content_json TEXT NOT NULL,
      content_text TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE,
      FOREIGN KEY(harness_id) REFERENCES harnesses(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_artifacts_run_created
      ON artifacts(run_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_artifacts_run_node_created
      ON artifacts(run_id, node_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_artifacts_run_type_created
      ON artifacts(run_id, "type", created_at DESC);
  `);

  ensureColumn(db, "task_instances", "final_deliverable_json", "TEXT NOT NULL DEFAULT '{}'");

  return db;
}

export function getDatabase(): DatabaseSync {
  if (!database) {
    database = initializeDatabase();
  }

  return database;
}

function ensureColumn(db: DatabaseSync, tableName: string, columnName: string, columnDefinition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
}

function resolveWorkspacePath(value: string): string {
  return path.isAbsolute(value) ? value : path.join(process.cwd(), value);
}
