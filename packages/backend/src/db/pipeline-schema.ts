import { desc, sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { designSystemsTable, exportsTable, projectsTable } from "./pipeline-authorities";

export const designSystemTagsTable = sqliteTable(
  "design_system_tags",
  {
    designSystemId: text("design_system_id").notNull().references(() => designSystemsTable.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    ordinal: integer("ordinal").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.designSystemId, table.tag] }),
    unique().on(table.designSystemId, table.ordinal),
  ],
);

export const designSystemReceiptsTable = sqliteTable(
  "design_system_receipts",
  {
    id: text("id").primaryKey(),
    designSystemId: text("design_system_id").notNull().references(() => designSystemsTable.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["prepared", "committed", "recovering", "failed"] }).notNull().default("prepared"),
    contentRevision: integer("content_revision").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    digest: text("digest").notNull(),
    manifestJson: text("manifest_json").notNull(),
    provenanceJson: text("provenance_json").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    operation: text("operation", { enum: ["content", "duplicate", "derive", "trash", "restore", "purge"] }).notNull().default("content"),
    parentSystemId: text("parent_system_id"),
    parentReceiptId: text("parent_receipt_id"),
    parentDigest: text("parent_digest"),
    reason: text("reason"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    sourcePath: text("source_path"),
    destinationPath: text("destination_path"),
  },
  (table) => [
    check("ck_design_system_receipts_status", sql`${table.status} IN ('prepared','committed','recovering','failed')`),
    check("ck_design_system_receipts_operation", sql`${table.operation} IN ('content','duplicate','derive','trash','restore','purge')`),
    unique().on(table.designSystemId, table.contentRevision),
    index("idx_design_system_receipts_system").on(table.designSystemId, desc(table.contentRevision)),
    index("idx_design_system_receipt_operation").on(table.designSystemId, table.operation, table.createdAt),
    uniqueIndex("uq_design_system_pending_receipt").on(table.designSystemId).where(sql`${table.status} IN ('prepared','recovering')`),
  ],
);

export const learningItemsTable = sqliteTable(
  "learning_items",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["lesson", "example", "skill-card"] }).notNull(),
    title: text("title").notNull(),
    contentJson: text("content_json").notNull(),
    projectId: text("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
    parentItemId: text("parent_item_id"),
    deletedAt: integer("deleted_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.parentItemId], foreignColumns: [table.id] }).onDelete("set null"),
    check("ck_learning_items_kind", sql`${table.kind} IN ('lesson','example','skill-card')`),
    index("idx_learning_items_kind").on(table.kind, table.deletedAt),
  ],
);

export const learningProgressTable = sqliteTable(
  "learning_progress",
  {
    itemId: text("item_id").primaryKey().references(() => learningItemsTable.id, { onDelete: "cascade" }),
    state: text("state", { enum: ["not_started", "in_progress", "completed"] }).notNull().default("not_started"),
    revision: integer("revision").notNull().default(0),
    feedbackDraft: text("feedback_draft"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check("ck_learning_progress_state", sql`${table.state} IN ('not_started','in_progress','completed')`),
  ],
);

export const learningCheckpointsTable = sqliteTable(
  "learning_checkpoints",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").notNull().references(() => learningItemsTable.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "restrict" }),
    parentCheckpointId: text("parent_checkpoint_id"),
    artifactRevision: integer("artifact_revision").notNull(),
    artifactDigest: text("artifact_digest").notNull(),
    feedback: text("feedback").notNull(),
    nextContextJson: text("next_context_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.parentCheckpointId], foreignColumns: [table.id] }).onDelete("restrict"),
    index("idx_learning_checkpoints_item").on(table.itemId, table.createdAt),
  ],
);

export const artifactOperationsTable = sqliteTable(
  "artifact_operations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "working", "committed", "cancelled", "failed", "conflicted", "recovering", "recovered"] }).notNull().default("pending"),
    baseRevision: integer("base_revision").notNull(),
    baseDigest: text("base_digest").notNull(),
    resultRevision: integer("result_revision"),
    resultDigest: text("result_digest"),
    expectedRevision: integer("expected_revision").notNull(),
    expectedFileHash: text("expected_file_hash").notNull(),
    nodeFingerprint: text("node_fingerprint").notNull(),
    diffJson: text("diff_json").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    retentionJson: text("retention_json").notNull(),
    replayJson: text("replay_json").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check("ck_artifact_operations_status", sql`${table.status} IN ('pending','working','committed','cancelled','failed','conflicted','recovering','recovered')`),
    index("idx_artifact_operations_project").on(table.projectId, desc(table.createdAt)),
    uniqueIndex("uq_artifact_operations_nonterminal").on(table.projectId).where(sql`${table.status} IN ('pending','working','recovering')`),
  ],
);

export const exportAttemptsTable = sqliteTable(
  "export_attempts",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull().references(() => exportsTable.id, { onDelete: "cascade" }),
    parentAttemptId: text("parent_attempt_id"),
    status: text("status", { enum: ["pending", "running", "validating", "validated", "failed", "cancelled", "retrying", "recovering", "expired", "corrupt"] }).notNull(),
    progressJson: text("progress_json").notNull(),
    stopReason: text("stop_reason"),
    projectRevision: integer("project_revision").notNull(),
    projectDigest: text("project_digest").notNull(),
    canonicalOptionsJson: text("canonical_options_json").notNull(),
    optionsDigest: text("options_digest").notNull(),
    inputClosureDigest: text("input_closure_digest"),
    designSystemDigest: text("design_system_digest"),
    rendererDigest: text("renderer_digest").notNull(),
    captureDigest: text("capture_digest").notNull(),
    outputDigest: text("output_digest"),
    receiptDigest: text("receipt_digest"),
    findingsJson: text("findings_json").notNull(),
    retentionJson: text("retention_json").notNull(),
    cancelRequestedAt: integer("cancel_requested_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.parentAttemptId], foreignColumns: [table.id] }).onDelete("set null"),
    check("ck_export_attempts_status", sql`${table.status} IN ('pending','running','validating','validated','failed','cancelled','retrying','recovering','expired','corrupt')`),
    index("idx_export_attempts_job").on(table.jobId, table.createdAt),
    uniqueIndex("uq_export_attempts_nonterminal").on(table.jobId).where(sql`${table.status} IN ('pending','running','validating','retrying','recovering')`),
    uniqueIndex("uq_export_attempts_parent").on(table.parentAttemptId).where(sql`${table.parentAttemptId} IS NOT NULL`),
  ],
);
