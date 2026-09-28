import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import path from "node:path";
import { runMigrationsFrom } from "../src/db/migrate";
import {
  createVisualAlternativeGeneration,
  deleteVisualAlternative,
  markVisualAlternativeReady,
  repairVisualAlternativeRetention,
} from "../src/db/visual-alternative-repository";

const DIGEST = "a".repeat(64);
let db: Database;

beforeEach(async () => {
  db = new Database(":memory:");
  await runMigrationsFrom(db, path.join(import.meta.dir, "../src/db/migrations"));
  for (const id of ["p", "q"]) {
    db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(id, id, `/managed/${id}`);
  }
  createVisualAlternativeGeneration(db, {
    generationId: "g",
    projectId: "p",
    baseRevision: 0,
    baseDigest: DIGEST,
    basePath: "/managed/p/.meta/visual-alternatives/g/base",
    alternatives: [{ id: "a", name: "A", operationId: "op-a" }],
    now: 1,
  });
});

afterEach(() => {
  db.close();
});

function insertAlternative(values: { readonly id: string; readonly projectId: string; readonly operationId: string; readonly status?: string }) {
  db.prepare(
    "INSERT INTO visual_alternatives(id,project_id,generation_id,name,ordinal,status,source_revision,source_digest,result_revision,result_digest,operation_id,created_at,updated_at) VALUES (?,?,'g','X',1,?,0,?,NULL,NULL,?,1,1)",
  ).run(values.id, values.projectId, values.status ?? "pending", DIGEST, values.operationId);
}

describe("visual alternative repository constraints", () => {
  test("Given a generation of one project When an alternative claims another project Then the insert is refused", () => {
    expect(() => insertAlternative({ id: "cross", projectId: "q", operationId: "op-cross" })).toThrow();
  });

  test("Given an operation already owned by an alternative When another row reuses it Then the insert is refused", () => {
    expect(() => insertAlternative({ id: "dup", projectId: "p", operationId: "op-a" })).toThrow();
  });

  test("Given a ready status without a result When stored Then the check constraint refuses it", () => {
    expect(() => insertAlternative({ id: "hollow", projectId: "p", operationId: "op-hollow", status: "ready" })).toThrow();
  });

  test("Given no committed operation to retain When an alternative is marked ready Then the row stays unready", () => {
    // When / Then
    expect(() => markVisualAlternativeReady(db, {
      id: "a",
      projectId: "p",
      operationId: "op-a",
      resultRevision: 1,
      resultDigest: DIGEST,
      now: 2,
    })).toThrow("corrupt_visual_alternative");
    expect(db.query("SELECT status,result_revision FROM visual_alternatives WHERE id='a'").get()).toEqual({ status: "pending", result_revision: null });
  });

  test("Given a ready row whose result disagrees with its pinned operation When retention is repaired Then the pin is released", () => {
    // Given
    db.prepare(
      "INSERT INTO artifact_operations(id,project_id,status,base_revision,base_digest,result_revision,result_digest,expected_revision,expected_file_hash,node_fingerprint,diff_json,snapshot_json,retention_json,replay_json,created_at,updated_at) VALUES ('op-a','p','committed',0,?,1,?,0,'','','[]','{}',?,'{}',1,1)",
    ).run(DIGEST, "b".repeat(64), JSON.stringify({ schema_version: 1, replayable: true, retained_until: 253402300799999, pruned_at: null, prune_reason: null }));
    db.prepare("UPDATE visual_alternatives SET status='ready',result_revision=1,result_digest=? WHERE id='a'").run("c".repeat(64));

    // When
    const repaired = repairVisualAlternativeRetention(db, 1000);

    // Then
    expect(repaired.released).toBe(1);
    expect(db.query("SELECT json_extract(retention_json,'$.retained_until') AS until FROM artifact_operations WHERE id='op-a'").get()).toEqual({ until: 1000 + 30 * 24 * 60 * 60 * 1000 });
  });

  test("Given an unfinished alternative When deleted Then it is refused and kept", () => {
    // When / Then
    expect(() => deleteVisualAlternative(db, "p", "a", 2)).toThrow("generation_active");
    expect(db.query("SELECT COUNT(*) AS count FROM visual_alternatives WHERE id='a'").get()).toEqual({ count: 1 });
  });
});
