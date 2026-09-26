import { beforeAll, describe, expect, test } from "bun:test";
import { requiredArray, requiredBoolean, stringArray } from "@bg/shared/contract-parser";
import { parseLearningContract, parseLearningNextContext, UpgradeContractError } from "@bg/shared/learning-contract";
import { getSqlite } from "../src/db/sqlite-client";
import { selectPromptLearning } from "../src/db/learning-store";
import { ensureLearningSchema } from "./learning-fixture";
import { learningRoutes } from "../src/routes/learning";
import { MAX_CHECKPOINT_FEEDBACK_CHARS, parseCheckpoint } from "../src/routes/learning-input";
import { seedLearningItems } from "../src/services/learning-service";

const app = learningRoutes;
const prefix = `learning-${process.pid}`;
const projectId = `${prefix}-project`;
const seedId = "burnguard-learning-contrast";
const userId = `${prefix}-user`;

async function request(method: string, path: string, body?: unknown): Promise<{ readonly status: number; readonly body: Readonly<Record<string, unknown>> }> {
  const response = await app.request(`http://localhost${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const value: unknown = await response.json();
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("expected JSON object");
  return { status: response.status, body: value };
}

function data(result: { readonly body: Readonly<Record<string, unknown>> }): Readonly<Record<string, unknown>> {
  const value = result.body["data"];
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("expected data object");
  return value;
}

beforeAll(() => {
  const db = getSqlite();
  ensureLearningSchema(db);
  db.prepare("INSERT INTO projects (id,name,type,dir_path,backend_id,current_revision,current_digest,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(projectId, "Learning project", "prototype", `/tmp/${projectId}`, "codex", 7, "digest-7", 1, 1);
  seedLearningItems(db, 1);
});

describe("learning shared contracts", () => {
  test("Given strict learning response and context inputs When parsed Then valid variants pass and unknown fields have stable codes", () => {
    const value = parseLearningContract({
      id: "contract-item", kind: "skill-card", revision: 2,
      progress: { state: "completed", revision: 3, expected_revision: 3, feedback_draft: null },
      checkpoint: { id: "contract-cp", parent_checkpoint_id: null, artifact_revision: 7, artifact_digest: "digest-7", next_context: { kind: "iteration", parent_checkpoint_id: "contract-cp", schema_revision: 1, artifact_revision: 7, artifact_digest: "digest-7" } },
    });
    let code = "";
    try { parseLearningNextContext({ kind: "iteration", parent_checkpoint_id: "cp", schema_revision: 1, artifact_revision: 7, artifact_digest: "digest-7", unknown: true }); }
    catch (error) { if (error instanceof UpgradeContractError) code = error.code; else throw error; }

    expect(value).toMatchObject({ kind: "skill-card", progress: { state: "completed" }, checkpoint: { artifact_digest: "digest-7" } });
    expect(code).toBe("invalid_field");
    expect(requiredBoolean({ enabled: true }, "enabled")).toBe(true);
    expect(requiredArray({ items: [] }, "items")).toEqual([]);
    expect(stringArray({ tags: ["typed"] }, "tags")).toEqual(["typed"]);
  });
});

describe("learning item authority", () => {
  test("Given strict item variants When user items are created Then examples require a real project and unknown fields are rejected", async () => {
    const before = getSqlite().query<{ readonly count: number }, []>("SELECT COUNT(*) count FROM learning_items").get()?.count;
    const malformed = await Promise.all([
      request("POST", "/api/learning/items", { id: `${prefix}-unknown`, kind: "lesson", title: "Bad", content: { summary: "x", unknown: true }, project_id: null }),
      request("POST", "/api/learning/items", { id: `${prefix}-forged`, kind: "lesson", title: "Bad", content: { summary: "x" }, project_id: null, owner: "system", seed_key: "contrast" }),
      request("PATCH", `/api/learning/items/${seedId}`, { expected_revision: -1, title: "Bad" }),
      request("POST", "/api/learning/items", { id: "../bad", kind: "lesson", title: "Bad", content: { summary: "x" }, project_id: null }),
    ]);
    const invalid = await request("POST", "/api/learning/items", { id: `${prefix}-bad`, kind: "example", title: "Bad", content: { summary: "x" }, project_id: "missing", extra: true });
    expect(malformed.map((result) => result.status)).toEqual([400, 400, 400, 400]);
    expect(getSqlite().query<{ readonly count: number }, []>("SELECT COUNT(*) count FROM learning_items").get()?.count).toBe(before);
    const created = await request("POST", "/api/learning/items", { id: userId, kind: "example", title: "Example", content: { summary: "Real example" }, project_id: projectId });

    expect(invalid).toMatchObject({ status: 400, body: { error: { code: "invalid_learning_body" } } });
    expect(created).toMatchObject({ status: 201, body: { data: { id: userId, kind: "example", owner: "user", revision: 0, project_id: projectId } } });
  });

  test("Given a user item When renamed and duplicated Then identity is stable and exact parent lineage is persisted", async () => {
    const renamed = await request("PATCH", `/api/learning/items/${userId}`, { expected_revision: 0, title: "Renamed" });
    const childId = `${prefix}-copy`;
    const duplicate = await request("POST", `/api/learning/items/${userId}/duplicate`, { id: childId, title: "Copy" });

    expect(renamed).toMatchObject({ status: 200, body: { data: { id: userId, title: "Renamed", revision: 1 } } });
    expect(duplicate).toMatchObject({ status: 201, body: { data: { id: childId, parent_item_id: userId, owner: "user" } } });
    expect(getSqlite().query("SELECT id,parent_item_id FROM learning_items WHERE id=?").get(childId)).toEqual({ id: childId, parent_item_id: userId });
  });

  test("Given a system seed and a user item When reseeding and destructive mutations run Then the seed is protected and the user item survives", async () => {
    const rename = await request("PATCH", `/api/learning/items/${seedId}`, { expected_revision: 0, title: "Changed" });
    const removed = await request("DELETE", `/api/learning/items/${seedId}`, { expected_revision: 0 });
    const reseed = await request("POST", "/api/learning/seed", {});

    expect([rename.status, removed.status, reseed.status]).toEqual([403, 403, 200]);
    expect(getSqlite().query("SELECT title FROM learning_items WHERE id=?").get(seedId)).toEqual({ title: "Contrast hierarchy" });
    expect(getSqlite().query("SELECT id FROM learning_items WHERE id=?").get(userId)).toEqual({ id: userId });
  });
});

describe("learning progress and lifecycle", () => {
  test("Given two writers at revision zero When both update progress Then exactly one succeeds and the latest feedback draft is retained", async () => {
    const itemId = `${prefix}-cas`;
    await request("POST", "/api/learning/items", { id: itemId, kind: "lesson", title: "CAS", content: { summary: "CAS" }, project_id: null });

    const [left, right] = await Promise.all([
      request("PATCH", `/api/learning/items/${itemId}/progress`, { expected_revision: 0, state: "in_progress", feedback_draft: "left" }),
      request("PATCH", `/api/learning/items/${itemId}/progress`, { expected_revision: 0, state: "completed", feedback_draft: "right" }),
    ]);
    const detail = await request("GET", `/api/learning/items/${itemId}`);

    expect([left.status, right.status].sort()).toEqual([200, 412]);
    const winner = left.status === 200 ? "left" : "right";
    expect(detail).toMatchObject({ status: 200, body: { data: { progress: { revision: 1, feedback_draft: winner } } } });
  });

  test("Given progress and a committed checkpoint When deleted restored and reset Then identity and durable history survive while progress returns to defaults", async () => {
    const itemId = `${prefix}-lifecycle`;
    const checkpointId = `${prefix}-lifecycle-cp`;
    await request("POST", "/api/learning/items", { id: itemId, kind: "skill-card", title: "Lifecycle", content: { summary: "Lifecycle" }, project_id: null });
    await request("PATCH", `/api/learning/items/${itemId}/progress`, { expected_revision: 0, state: "completed", feedback_draft: "draft" });
    await request("POST", `/api/learning/items/${itemId}/checkpoints`, {
      id: checkpointId, project_id: projectId, artifact_revision: 7, artifact_digest: "digest-7", feedback: "committed feedback",
      parent_checkpoint_id: null, next_context: { kind: "iteration", parent_checkpoint_id: checkpointId, schema_revision: 1, artifact_revision: 7, artifact_digest: "digest-7" },
      evidence: { kind: "complete" },
    });

    const removed = await request("DELETE", `/api/learning/items/${itemId}`, { expected_revision: 0 });
    const hidden = await request("GET", `/api/learning/items/${itemId}`);
    const staleRestore = await request("POST", `/api/learning/items/${itemId}/restore`, { expected_revision: 0 });
    const restored = await request("POST", `/api/learning/items/${itemId}/restore`, { expected_revision: 1 });
    const reset = await request("POST", `/api/learning/items/${itemId}/reset`, { expected_revision: 1 });

    expect([removed.status, hidden.status, staleRestore.status, restored.status, reset.status]).toEqual([200, 404, 412, 200, 200]);
    expect(restored).toMatchObject({ body: { data: { id: itemId, revision: 2, progress: { state: "completed", feedback_draft: "draft" } } } });
    expect(reset).toMatchObject({ body: { data: { id: itemId, progress: { state: "not_started", revision: 2, feedback_draft: null } } } });
    expect(getSqlite().query("SELECT COUNT(*) count FROM learning_checkpoints WHERE id=?").get(checkpointId)).toEqual({ count: 1 });
  });
});

describe("learning checkpoint commit", () => {
  test("Given a complete checkpoint When committed Then feedback artifact identity typed context and parent are immutable", async () => {
    const itemId = `${prefix}-checkpoint`;
    const parentId = `${prefix}-parent-cp`;
    const childId = `${prefix}-child-cp`;
    await request("POST", "/api/learning/items", { id: itemId, kind: "lesson", title: "Checkpoint", content: { summary: "Checkpoint" }, project_id: null });
    for (const [id, parent] of [[parentId, null], [childId, parentId]] as const) {
      const result = await request("POST", `/api/learning/items/${itemId}/checkpoints`, {
        id, project_id: projectId, artifact_revision: 7, artifact_digest: "digest-7", feedback: `feedback-${id}`,
        parent_checkpoint_id: parent, next_context: { kind: "iteration", parent_checkpoint_id: id, schema_revision: 1, artifact_revision: 7, artifact_digest: "digest-7" },
        evidence: { kind: "complete" },
      });
      expect(result.status).toBe(201);
    }

    const row = getSqlite().query("SELECT item_id,project_id,parent_checkpoint_id,artifact_revision,artifact_digest,feedback,next_context_json FROM learning_checkpoints WHERE id=?").get(childId);
    expect(row).toMatchObject({ item_id: itemId, project_id: projectId, parent_checkpoint_id: parentId, artifact_revision: 7, artifact_digest: "digest-7", feedback: `feedback-${childId}` });
    expect(() => getSqlite().prepare("UPDATE learning_checkpoints SET feedback='changed' WHERE id=?").run(childId)).toThrow();
    expect(() => getSqlite().prepare("DELETE FROM learning_checkpoints WHERE id=?").run(childId)).toThrow();

    const duplicate = await request("POST", `/api/learning/items/${itemId}/checkpoints`, {
      id: childId, project_id: projectId, artifact_revision: 7, artifact_digest: "digest-7", feedback: "duplicate",
      parent_checkpoint_id: parentId, next_context: { kind: "iteration", parent_checkpoint_id: childId, schema_revision: 1, artifact_revision: 7, artifact_digest: "digest-7" },
      evidence: { kind: "complete" },
    });
    expect(duplicate).toMatchObject({ status: 409, body: { error: { code: "duplicate_id" } } });
  });

  test("PH-21: Given checkpoint feedback beyond the bound When committed Then the body is rejected on the feedback field and nothing is stored", async () => {
    const itemId = `${prefix}-bounded`;
    await request("POST", "/api/learning/items", { id: itemId, kind: "lesson", title: "Bounded", content: { summary: "Bounded" }, project_id: null });
    const id = `${prefix}-bounded-cp`;
    const body = (feedback: string) => ({
      id, project_id: projectId, artifact_revision: 7, artifact_digest: "digest-7", feedback,
      parent_checkpoint_id: null, next_context: { kind: "iteration", parent_checkpoint_id: id, schema_revision: 1, artifact_revision: 7, artifact_digest: "digest-7" },
      evidence: { kind: "complete" },
    });
    const rejected = await request("POST", `/api/learning/items/${itemId}/checkpoints`, body("x".repeat(MAX_CHECKPOINT_FEEDBACK_CHARS + 1)));
    expect(rejected).toMatchObject({ status: 400, body: { error: { code: "invalid_learning_body", details: { field: "feedback" } } } });
    expect(getSqlite().query("SELECT COUNT(*) count FROM learning_checkpoints WHERE id=?").get(id)).toEqual({ count: 0 });
    expect(parseCheckpoint(body("y".repeat(MAX_CHECKPOINT_FEEDBACK_CHARS))).feedback).toHaveLength(MAX_CHECKPOINT_FEEDBACK_CHARS);
  });

  test("Given crash-before-commit or partial evidence When checkpointing Then no checkpoint is exposed and partial state is a typed warning", async () => {
    const itemId = `${prefix}-partial`;
    await request("POST", "/api/learning/items", { id: itemId, kind: "lesson", title: "Partial", content: { summary: "Partial" }, project_id: null });
    const partialId = `${prefix}-partial-cp`;
    const partial = await request("POST", `/api/learning/items/${itemId}/checkpoints`, {
      id: partialId, project_id: projectId, artifact_revision: 7, artifact_digest: "digest-7", feedback: "not committed",
      parent_checkpoint_id: null, next_context: { kind: "iteration", parent_checkpoint_id: partialId, schema_revision: 1, artifact_revision: 7, artifact_digest: "digest-7" },
      evidence: { kind: "partial", code: "missing_artifact_evidence" },
    });
    const incompatible = await request("POST", `/api/learning/items/${itemId}/checkpoints`, {
      id: `${prefix}-crash-cp`, project_id: projectId, artifact_revision: 7, artifact_digest: "stale", feedback: "never committed",
      parent_checkpoint_id: null, next_context: { kind: "iteration", parent_checkpoint_id: `${prefix}-crash-cp`, schema_revision: 1, artifact_revision: 7, artifact_digest: "stale" },
      evidence: { kind: "complete" },
    });

    expect(partial).toMatchObject({ status: 200, body: { data: { checkpoint: null, warning: { code: "partial_evidence" } } } });
    expect(incompatible).toMatchObject({ status: 409, body: { error: { code: "artifact_identity_mismatch" } } });
    expect(getSqlite().query("SELECT COUNT(*) count FROM learning_checkpoints WHERE id IN (?,?)").get(partialId, `${prefix}-crash-cp`)).toEqual({ count: 0 });
  });

  test("Given concurrent lifecycle writers When they target the same or opposite state Then one CAS succeeds and one is stale without losing durable state", async () => {
    const sameId = `${prefix}-delete-cas`;
    await request("POST", "/api/learning/items", { id: sameId, kind: "lesson", title: "Delete CAS", content: { summary: "Delete CAS" }, project_id: null });
    const same = await Promise.all([
      request("DELETE", `/api/learning/items/${sameId}`, { expected_revision: 0 }),
      request("DELETE", `/api/learning/items/${sameId}`, { expected_revision: 0 }),
    ]);
    expect(same.map((result) => result.status).sort()).toEqual([200, 412]);
    const restores = await Promise.all([
      request("POST", `/api/learning/items/${sameId}/restore`, { expected_revision: 1 }),
      request("POST", `/api/learning/items/${sameId}/restore`, { expected_revision: 1 }),
    ]);
    expect(restores.map((result) => result.status).sort()).toEqual([200, 412]);

    const oppositeId = `${prefix}-opposite-cas`;
    await request("POST", "/api/learning/items", { id: oppositeId, kind: "lesson", title: "Opposite CAS", content: { summary: "Opposite CAS" }, project_id: null });
    const opposite = await Promise.all([
      request("DELETE", `/api/learning/items/${oppositeId}`, { expected_revision: 0 }),
      request("POST", `/api/learning/items/${oppositeId}/restore`, { expected_revision: 0 }),
    ]);
    expect(opposite.map((result) => result.status).sort()).toEqual([200, 412]);
    const row = getSqlite().query("SELECT deleted_at,content_json FROM learning_items WHERE id=?").get(oppositeId);
    expect(row).toMatchObject({ deleted_at: expect.any(Number) });
  });

  test("Given forged or malformed stored envelopes When read or reseeded Then provenance cannot grant seed protection", async () => {
    const db = getSqlite();
    const cases = [
      { id: `${prefix}-unknown-envelope`, envelope: { schema_revision: 1, owner: "user", seed_key: null, revision: 0, content: { summary: "x" }, unknown: true } },
      { id: `${prefix}-unknown-content`, envelope: { schema_revision: 1, owner: "user", seed_key: null, revision: 0, content: { summary: "x", unknown: true } } },
      { id: `${prefix}-negative`, envelope: { schema_revision: 1, owner: "user", seed_key: null, revision: -1, content: { summary: "x" } } },
      { id: `${prefix}-forged`, envelope: { schema_revision: 1, owner: "system", seed_key: "contrast", revision: 0, content: { summary: "x" } } },
    ] as const;
    for (const entry of cases) {
      db.prepare("INSERT INTO learning_items (id,kind,title,content_json,created_at,updated_at) VALUES (?,?,?,?,1,1)").run(entry.id, "lesson", "Malformed", JSON.stringify(entry.envelope));
      db.prepare("INSERT INTO learning_progress (item_id,state,revision,feedback_draft,updated_at) VALUES (?,'not_started',0,NULL,1)").run(entry.id);
    }

    const results = await Promise.all(cases.map((entry) => request("GET", `/api/learning/items/${entry.id}`)));
    expect(results.map((result) => result.status)).toEqual([409, 409, 409, 409]);
    const forgedDelete = await request("DELETE", `/api/learning/items/${prefix}-forged`, { expected_revision: 0 });
    expect(forgedDelete.status).not.toBe(403);
  });

  test("Given a corrupt ancestor chain When prompt learning is selected Then no descendant context is injectable", async () => {
    const db = getSqlite();
    const itemId = `${prefix}-lineage`;
    const lineageProjectId = `${prefix}-lineage-project`;
    db.prepare("INSERT INTO projects (id,name,type,dir_path,backend_id,current_revision,current_digest,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(lineageProjectId, "Lineage", "prototype", `/tmp/${lineageProjectId}`, "codex", 7, "digest-7", 1, 1);
    await request("POST", "/api/learning/items", { id: itemId, kind: "lesson", title: "Lineage", content: { summary: "Lineage" }, project_id: null });
    const parentId = `${prefix}-lineage-parent`;
    const childId = `${prefix}-lineage-child`;
    db.prepare("INSERT INTO learning_checkpoints (id,item_id,project_id,artifact_revision,artifact_digest,feedback,next_context_json,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(parentId, itemId, lineageProjectId, 6, "stale", "parent", "{", 1);
    db.prepare("INSERT INTO learning_checkpoints (id,item_id,project_id,parent_checkpoint_id,artifact_revision,artifact_digest,feedback,next_context_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(childId, itemId, lineageProjectId, parentId, 7, "digest-7", "child", JSON.stringify({ kind: "iteration", parent_checkpoint_id: childId, schema_revision: 1, artifact_revision: 7, artifact_digest: "digest-7" }), 2);

    expect(selectPromptLearning(db, lineageProjectId)).toEqual({ context: null, warning: "incompatible_checkpoint" });
  });

  test("Given incompatible schema digest project or parent When committing Then every request is rejected without rows", async () => {
    const itemId = `${prefix}-reject`;
    await request("POST", "/api/learning/items", { id: itemId, kind: "lesson", title: "Reject", content: { summary: "Reject" }, project_id: null });
    const bases = { project_id: projectId, artifact_revision: 7, artifact_digest: "digest-7", feedback: "feedback", parent_checkpoint_id: null, evidence: { kind: "complete" } };
    const inputs = [
      { ...bases, id: `${prefix}-schema`, next_context: { kind: "iteration", parent_checkpoint_id: `${prefix}-schema`, schema_revision: 2, artifact_revision: 7, artifact_digest: "digest-7" } },
      { ...bases, id: `${prefix}-digest`, artifact_digest: "wrong", next_context: { kind: "iteration", parent_checkpoint_id: `${prefix}-digest`, schema_revision: 1, artifact_revision: 7, artifact_digest: "wrong" } },
      { ...bases, id: `${prefix}-project`, project_id: "missing", next_context: { kind: "iteration", parent_checkpoint_id: `${prefix}-project`, schema_revision: 1, artifact_revision: 7, artifact_digest: "digest-7" } },
      { ...bases, id: `${prefix}-parent`, parent_checkpoint_id: "missing", next_context: { kind: "iteration", parent_checkpoint_id: `${prefix}-parent`, schema_revision: 1, artifact_revision: 7, artifact_digest: "digest-7" } },
    ];

    const results = await Promise.all(inputs.map((body) => request("POST", `/api/learning/items/${itemId}/checkpoints`, body)));

    expect(results.map((result) => result.status)).toEqual([409, 409, 404, 409]);
    expect(getSqlite().query("SELECT COUNT(*) count FROM learning_checkpoints WHERE id IN (?,?,?,?)").get(...inputs.map((input) => input.id))).toEqual({ count: 0 });
  });
});
