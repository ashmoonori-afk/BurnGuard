import { desc, sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { projectsTable } from "./pipeline-authorities";

export const visualAlternativeGenerationsTable = sqliteTable(
  "visual_alternative_generations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["generating", "ready", "partial", "failed"],
    }).notNull(),
    baseRevision: integer("base_revision").notNull(),
    baseDigest: text("base_digest").notNull(),
    baseManifestJson: text("base_manifest_json"),
    basePath: text("base_path").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "ck_visual_alternative_generations_status",
      sql`${table.status} IN ('generating','ready','partial','failed')`,
    ),
    index("idx_visual_alternative_generations_project").on(
      table.projectId,
      desc(table.createdAt),
    ),
    unique().on(table.id, table.projectId),
    uniqueIndex("uq_visual_alternative_generation_active")
      .on(table.projectId)
      .where(sql`${table.status} = 'generating'`),
  ],
);

export const visualAlternativesTable = sqliteTable(
  "visual_alternatives",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    generationId: text("generation_id").notNull(),
    name: text("name").notNull(),
    ordinal: integer("ordinal").notNull(),
    status: text("status", {
      enum: ["pending", "generating", "ready", "failed"],
    }).notNull(),
    sourceRevision: integer("source_revision").notNull(),
    sourceDigest: text("source_digest").notNull(),
    resultRevision: integer("result_revision"),
    resultDigest: text("result_digest"),
    operationId: text("operation_id").notNull().unique(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "ck_visual_alternatives_ordinal",
      sql`${table.ordinal} BETWEEN 0 AND 3`,
    ),
    check(
      "ck_visual_alternatives_status",
      sql`${table.status} IN ('pending','generating','ready','failed')`,
    ),
    check(
      "ck_visual_alternatives_result",
      sql`(${table.status} = 'ready') = (${table.resultRevision} IS NOT NULL AND ${table.resultDigest} IS NOT NULL)`,
    ),
    foreignKey({
      columns: [table.generationId, table.projectId],
      foreignColumns: [
        visualAlternativeGenerationsTable.id,
        visualAlternativeGenerationsTable.projectId,
      ],
    }).onDelete("cascade"),
    unique().on(table.generationId, table.ordinal),
    unique().on(table.generationId, table.name),
    index("idx_visual_alternatives_project").on(
      table.projectId,
      desc(table.createdAt),
      table.ordinal,
    ),
  ],
);
