import { Hono } from "hono";
import type { Context } from "hono";
import type { ApiErrorBody, ApiSuccess } from "@bg/shared/api";
import { LearningStoreError } from "../db/learning-store";
import { getSqlite } from "../db/sqlite-client";
import {
  changeProgress, commitCheckpoint, createItem, deleteItem, duplicateItem, readItem,
  renameItem, resetProgress, restoreItem, seedLearningItems, LearningCommitFaultError,
} from "../services/learning-service";
import {
  LearningIdentifierError, LearningInputError, parseCheckpoint, parseDuplicate, parseEmpty,
  parseExpectedRevision, parseItem, parseLearningId, parseProgress, parseRename,
} from "./learning-input";

function ok<T>(data: T): ApiSuccess<T> { return { data }; }
function fail(code: string, message: string, details?: unknown): ApiErrorBody { return { error: { code, message, details } }; }

export const learningRoutes = new Hono();

learningRoutes.post("/api/learning/items", async (c) => {
  try { return c.json(ok(createItem(getSqlite(), parseItem(await jsonBody(c.req.raw)))), 201); }
  catch (error) { return learningError(c, error); }
});
learningRoutes.get("/api/learning/items/:id", (c) => {
  try {
    const id = parseLearningId(c.req.param("id"));
    return c.json(ok(readItem(getSqlite(), id)));
  } catch (error) { return learningError(c, error); }
});
learningRoutes.patch("/api/learning/items/:id", async (c) => {
  try {
    const id = parseLearningId(c.req.param("id"));
    return c.json(ok(renameItem(getSqlite(), id, parseRename(await jsonBody(c.req.raw)))));
  } catch (error) { return learningError(c, error); }
});
learningRoutes.post("/api/learning/items/:id/duplicate", async (c) => {
  try {
    const id = parseLearningId(c.req.param("id"));
    return c.json(ok(duplicateItem(getSqlite(), id, parseDuplicate(await jsonBody(c.req.raw)))), 201);
  } catch (error) { return learningError(c, error); }
});
learningRoutes.patch("/api/learning/items/:id/progress", async (c) => {
  try {
    const id = parseLearningId(c.req.param("id"));
    return c.json(ok(changeProgress(getSqlite(), id, parseProgress(await jsonBody(c.req.raw)))));
  } catch (error) { return learningError(c, error); }
});
learningRoutes.post("/api/learning/items/:id/reset", async (c) => {
  try {
    const id = parseLearningId(c.req.param("id"));
    return c.json(ok(resetProgress(getSqlite(), id, parseExpectedRevision(await jsonBody(c.req.raw)))));
  } catch (error) { return learningError(c, error); }
});
learningRoutes.delete("/api/learning/items/:id", async (c) => {
  try {
    const id = parseLearningId(c.req.param("id"));
    return c.json(ok(deleteItem(getSqlite(), id, parseExpectedRevision(await jsonBody(c.req.raw)))));
  } catch (error) { return learningError(c, error); }
});
learningRoutes.post("/api/learning/items/:id/restore", async (c) => {
  try {
    const id = parseLearningId(c.req.param("id"));
    return c.json(ok(restoreItem(getSqlite(), id, parseExpectedRevision(await jsonBody(c.req.raw)))));
  } catch (error) { return learningError(c, error); }
});
learningRoutes.post("/api/learning/items/:id/checkpoints", async (c) => {
  try {
    const id = parseLearningId(c.req.param("id"));
    const result = commitCheckpoint(getSqlite(), id, parseCheckpoint(await jsonBody(c.req.raw)));
    return c.json(ok(result), result.checkpoint === null ? 200 : 201);
  } catch (error) { return learningError(c, error); }
});
learningRoutes.post("/api/learning/seed", async (c) => {
  try { parseEmpty(await jsonBody(c.req.raw)); return c.json(ok({ inserted: seedLearningItems(getSqlite()) })); }
  catch (error) { return learningError(c, error); }
});

async function jsonBody(request: Request): Promise<unknown> {
  try { return await request.json(); }
  catch (error) { if (error instanceof SyntaxError) throw new LearningInputError("body"); throw error; }
}
function learningError(c: Context, error: unknown): Response {
  if (error instanceof LearningIdentifierError) return c.json(fail(error.code, error.message, { field: error.field }), 400);
  if (error instanceof LearningInputError) return c.json(fail(error.code, error.message, { field: error.field }), 400);
  if (error instanceof LearningCommitFaultError) return c.json(fail("checkpoint_commit_interrupted", error.message), 500);
  if (error instanceof LearningStoreError) {
    switch (error.code) {
      case "not_found": return c.json(fail("learning_not_found", error.message), 404);
      case "protected_seed": return c.json(fail(error.code, error.message), 403);
      case "expected_revision_conflict": return c.json(fail(error.code, error.message), 412);
      case "artifact_identity_mismatch": case "incompatible_schema": case "invalid_parent": case "duplicate_id": case "corrupt_item": return c.json(fail(error.code, error.message), 409);
    }
  }
  console.warn("[learning] request failed", error instanceof Error ? String(Reflect.get(error, "code") ?? error.name) : "unknown");
  return c.json(fail("learning_operation_failed", "Learning operation failed"), 500);
}
