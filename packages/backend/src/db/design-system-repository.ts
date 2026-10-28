import { and, asc, eq, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/bun-sqlite";
import { getCurrentSystemContent, getPendingSystemOperation } from "./catalog-repository";
import { PipelineRepositoryError, parseJsonRecord } from "./pipeline-repository";
import { designSystemReceiptsTable, designSystemTagsTable } from "./pipeline-schema";

type MetadataUpdate = {
  readonly id: string;
  readonly expectedRevision: number;
  readonly name: string;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly updatedAt: number;
};
type ReceiptInput = {
  readonly id: string;
  readonly designSystemId: string;
  readonly contentRevision: number;
  readonly schemaVersion: number;
  readonly digest: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly provenance: Readonly<Record<string, unknown>>;
  readonly createdAt: number;
};
type Receipt = {
  readonly id: string;
  readonly contentRevision: number;
  readonly schemaVersion: number;
  readonly digest: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly provenance: Readonly<Record<string, unknown>>;
};

type PipelineDatabase = ReturnType<typeof drizzle>;

export function updateDesignSystemMetadata(db: PipelineDatabase, input: MetadataUpdate) {
  const tags = [...new Set(input.tags.map((tag) => tag.normalize("NFC").trim().toLowerCase()).filter(Boolean))].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return db.transaction((tx) => {
    tx.run(sql`UPDATE design_systems SET name=${input.name}, description=${input.description}, metadata_revision=${input.expectedRevision + 1}, updated_at=${input.updatedAt} WHERE id=${input.id} AND metadata_revision=${input.expectedRevision}`);
    const changed = tx.get<readonly [number]>(sql`SELECT changes()`);
    if (changed?.[0] === 0) throw new PipelineRepositoryError("expected_revision_conflict", input.id);
    tx.delete(designSystemTagsTable).where(eq(designSystemTagsTable.designSystemId, input.id)).run();
    if (tags.length > 0) {
      tx.insert(designSystemTagsTable).values(tags.map((tag, ordinal) => ({ designSystemId: input.id, tag, ordinal }))).run();
    }
    return { id: input.id, metadataRevision: input.expectedRevision + 1, tags };
  });
}

export function prepareDesignSystemReceipt(db: PipelineDatabase, input: ReceiptInput): Receipt {
  return db.transaction((tx) => {
    const pending = getPendingSystemOperation(db.$client, input.designSystemId);
    if (pending !== null && pending.id !== input.id) throw new PipelineRepositoryError("content_receipt_mismatch", input.designSystemId);
    const current = tx.select().from(designSystemReceiptsTable).where(and(
      eq(designSystemReceiptsTable.designSystemId, input.designSystemId),
      eq(designSystemReceiptsTable.contentRevision, input.contentRevision),
    )).limit(1).all()[0];
    if (current !== undefined) {
      if (current.operation !== "content" || current.id !== input.id || current.digest !== input.digest || current.schemaVersion !== input.schemaVersion) {
        throw new PipelineRepositoryError("content_receipt_mismatch", input.designSystemId);
      }
      return parseReceipt(current);
    }
    tx.insert(designSystemReceiptsTable).values({
      id: input.id,
      designSystemId: input.designSystemId,
      status: "prepared",
      contentRevision: input.contentRevision,
      schemaVersion: input.schemaVersion,
      digest: input.digest,
      manifestJson: JSON.stringify(input.manifest),
      provenanceJson: JSON.stringify(input.provenance),
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    }).run();
    return { id: input.id, contentRevision: input.contentRevision, schemaVersion: input.schemaVersion, digest: input.digest, manifest: input.manifest, provenance: input.provenance };
  });
}

export function commitDesignSystemReceipt(db: PipelineDatabase, input: { readonly id: string; readonly digest: string; readonly updatedAt: number }): Receipt {
  db.update(designSystemReceiptsTable).set({ status: "committed", updatedAt: input.updatedAt }).where(and(
    eq(designSystemReceiptsTable.id, input.id),
    eq(designSystemReceiptsTable.operation, "content"),
    sql`${designSystemReceiptsTable.status} IN ('prepared','recovering')`,
    eq(designSystemReceiptsTable.digest, input.digest),
  )).run();
  const changed = db.get<readonly [number]>(sql`SELECT changes()`);
  if (changed?.[0] !== 1) throw new PipelineRepositoryError("content_receipt_mismatch", input.id);
  const row = db.select().from(designSystemReceiptsTable).where(eq(designSystemReceiptsTable.id, input.id)).limit(1).all()[0];
  if (row === undefined) throw new PipelineRepositoryError("not_found", input.id);
  return parseReceipt(row);
}

export function getDesignSystemReceiptById(db: PipelineDatabase, id: string): Receipt | null {
  const row = db.select().from(designSystemReceiptsTable).where(and(
    eq(designSystemReceiptsTable.id, id),
    eq(designSystemReceiptsTable.status, "committed"),
    eq(designSystemReceiptsTable.operation, "content"),
  )).limit(1).all()[0];
  return row === undefined ? null : parseReceipt(row);
}

export function getDesignSystemPipeline(db: PipelineDatabase, id: string): { readonly metadataRevision: number; readonly tags: readonly string[]; readonly receipt: Receipt | null } {
  const system = db.get<readonly [number]>(sql`SELECT metadata_revision FROM design_systems WHERE id=${id}`);
  if (system === undefined) throw new PipelineRepositoryError("not_found", id);
  const tags = db.select({ tag: designSystemTagsTable.tag }).from(designSystemTagsTable).where(eq(designSystemTagsTable.designSystemId, id)).orderBy(asc(designSystemTagsTable.ordinal)).all().map((row) => row.tag);
  if (tags.some((tag) => tag.length === 0 || tag.trim() !== tag || tag.normalize("NFC") !== tag)) {
    throw new PipelineRepositoryError("corrupt_tag", id);
  }
  const row = getCurrentSystemContent(db.$client, id);
  return { metadataRevision: system[0], tags, receipt: row === null ? null : parseReceipt(row) };
}

function parseReceipt(row: Pick<typeof designSystemReceiptsTable.$inferSelect, "id" | "contentRevision" | "schemaVersion" | "digest" | "manifestJson" | "provenanceJson">): Receipt {
  return {
    id: row.id,
    contentRevision: row.contentRevision,
    schemaVersion: row.schemaVersion,
    digest: row.digest,
    manifest: parseJsonRecord(row.manifestJson, row.id),
    provenance: parseJsonRecord(row.provenanceJson, row.id),
  };
}
