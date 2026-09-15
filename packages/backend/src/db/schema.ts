import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { designSystemsTable, eventsTable, exportsTable, projectsTable, sessionsTable } from "./pipeline-authorities";

export { designSystemsTable, eventsTable, exportsTable, projectsTable, sessionsTable };

export const usersTable = sqliteTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull().default("You"),
  email: text("email"),
  createdAt: integer("created_at").notNull(),
});

export const attachmentsTable = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    turnId: text("turn_id"),
    filePath: text("file_path").notNull(),
    mimeType: text("mime_type").notNull(),
    originalName: text("original_name").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256"),
    sourceRole: text("source_role", { enum: ["ordinary_content", "immutable_reference"] }).notNull().default("ordinary_content"),
    sourceRoleExplicit: integer("source_role_explicit", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    sessionIdx: index("idx_attachments_session").on(table.sessionId),
  }),
);

export const filesTable = sqliteTable(
  "files",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    relPath: text("rel_path").notNull(),
    category: text("category", {
      enum: ["stylesheet", "script", "document", "asset", "folder", "html", "other"],
    }).notNull(),
    sizeBytes: integer("size_bytes"),
    hash: text("hash"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    relPathUnique: uniqueIndex("uq_files_project_rel_path").on(
      table.projectId,
      table.relPath,
    ),
    projectIdx: index("idx_files_project").on(table.projectId),
  }),
);

export const commentsTable = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    relPath: text("rel_path").notNull(),
    nodeSelector: text("node_selector").notNull().default(""),
    xPct: real("x_pct").notNull(),
    yPct: real("y_pct").notNull(),
    anchorJson: text("anchor_json"),
    slideIndex: integer("slide_index"),
    body: text("body").notNull().default(""),
    authorId: text("author_id").notNull().default("local"),
    artifactRevision: integer("artifact_revision"),
    artifactDigest: text("artifact_digest"),
    resolvedAt: integer("resolved_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    projectIdx: index("idx_comments_project").on(table.projectId, table.resolvedAt),
  }),
);

export const tweaksTable = sqliteTable(
  "tweaks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    nodeId: text("node_id").notNull(),
    prop: text("prop").notNull(),
    value: text("value").notNull(),
    turnId: text("turn_id"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    projectNodeIdx: index("idx_tweaks_project_node").on(table.projectId, table.nodeId),
    turnIdx: index("idx_tweaks_turn").on(table.turnId),
  }),
);

export const metaSchemaTable = sqliteTable("meta_schema", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export * from "./pipeline-schema";
