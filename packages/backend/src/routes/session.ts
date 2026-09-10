import { ulid } from "ulid";
import { Hono } from "hono";
import { parseGenerationOptions } from "@bg/shared";
import { loadConfig } from "../config";
import { detectBackends } from "../services/backends";
import { resolveGenerationOptions } from "../services/generation-options";
import { streamSSE } from "hono/streaming";
import {
  VisualSourceContractError,
  parseUploadedVisualSourceSelections,
  parseVisualSourceUploadRequest,
  type ApiErrorBody,
  type ApiSuccess,
  type GenerationOptions,
  type NormalizedEvent,
  type UploadedVisualSourceSelection,
  type UserEvent,
  type VisualSourceUploadRequestV1,
} from "@bg/shared";
import {
  persistNormalizedEvent,
  listSessionEvents,
  setSessionBackend,
  setSessionStatus,
} from "../db/events";
import { insertSequencedEvent } from "../db/sequenced-event-writer";
import { readSessionSnapshot } from "../db/session-snapshot";
import {
  getLatestProjectSession,
  getProjectDetail,
  getSessionInfo,
} from "../db/seed";
import { UnsupportedAttachmentKindError, rollbackSessionAttachments, saveSessionAttachments } from "../services/attachments";
import { saveProjectDocuments } from "../services/project-documents";
import { AttachmentRequestError, canonicalizeAttachmentRequest } from "../services/attachment-request";
import { SUPPORTED_UPLOAD_KINDS } from "../services/upload-kind";
import { broker, sequencedBroker } from "../services/broker";
import { subscribeBeforeBackfill } from "../services/sequenced-event-replay";
import {
  getVerifiedSnapshotPath,
} from "../services/checkpoints";
import { ArtifactCoordinator, ArtifactOperationError } from "../services/artifact-coordinator";
import { materializeManagedTree } from "../services/artifact-tree-storage";
import { getSqlite } from "../db/sqlite-client";
import { assertSafeName } from "../security/path-boundary";
import { MAX_USER_MESSAGE_CHARS } from "../security/request-limits";
import { appendSessionTrace } from "../services/trace";
import { indexProjectFiles } from "../services/files";
import {
  interruptUserTurn,
  isUserTurnRunning,
  releaseUserTurnReservation,
  hasTurnCapacity,
  reserveUserTurn,
  startReservedUserTurn,
  type UserTurnReservation,
  submitToolDecisionToTurn,
} from "../services/turns";

function ok<T>(data: T): ApiSuccess<T> {
  return { data };
}

function fail(
  code: string,
  message: string,
  details?: unknown,
): ApiErrorBody {
  return { error: { code, message, details } };
}

async function persistAndPublishRoute(sessionId: string, event: NormalizedEvent): Promise<void> {
  const persisted = persistNormalizedEvent(getSqlite(), sessionId, event);
  broker.publish(sessionId, event);
  sequencedBroker.publish(sessionId, persisted);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

class ActivePageError extends Error {
  readonly name = "ActivePageError";
  constructor(readonly code: "invalid_active_page" | "active_page_unavailable") { super(code); }
}

async function parseActiveRelPath(value: unknown, projectId: string): Promise<string | undefined> {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ActivePageError("invalid_active_page");
  const files = await indexProjectFiles(projectId) ?? [];
  if (!files.some((file) => file.category === "html" && file.rel_path === value)) throw new ActivePageError("active_page_unavailable");
  return value;
}

export const sessionRoutes = new Hono();

sessionRoutes.post("/api/sessions/:id/documents", async (c) => {
  const id = c.req.param("id");
  if (!await getSessionInfo(id)) return c.json(fail("session_not_found", "Session not found"), 404);
  try {
    const form = await c.req.formData();
    const entries = form.getAll("files");
    if (entries.length === 0 || entries.some((entry) => !(entry instanceof File)) || [...form.keys()].some((key) => key !== "files")) return c.json(fail("invalid_attachments", "Select PDF or PPTX files"), 400);
    const files = entries.filter((entry): entry is File => entry instanceof File);
    return c.json(ok({ paths: await saveProjectDocuments(id, files) }));
  } catch (error) {
    if (error instanceof UnsupportedAttachmentKindError) return c.json(fail(error.code, "PDF and PPTX files are supported"), 415);
    return c.json(fail("document_save_failed", "Could not save the original document; retry the upload"), 400);
  }
});

sessionRoutes.get("/api/sessions/:id/snapshot", (c) => {
  const snapshot = readSessionSnapshot(getSqlite(), c.req.param("id"));
  return snapshot === null ? c.json(fail("session_not_found", "Session not found"), 404) : c.json(ok(snapshot));
});

sessionRoutes.get("/api/sessions/:id/events", async (c) => {
  const id = c.req.param("id");
  const session = await getSessionInfo(id);
  if (!session) {
    return c.json(fail("session_not_found", "Session not found", { id }), 404);
  }
  const afterRaw = c.req.query("after_sequence");
  const afterSequence = afterRaw ? Number.parseInt(afterRaw, 10) : 0;
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) return c.json(fail("invalid_sequence", "after_sequence must be a non-negative integer"), 400);
  const events = await listSessionEvents(id, afterSequence);
  return c.json(ok(events));
});

sessionRoutes.post("/api/sessions/:id/events", async (c) => {
  const id = c.req.param("id");
  const session = await getSessionInfo(id);
  if (!session) {
    return c.json(fail("session_not_found", "Session not found", { id }), 404);
  }
  const contentType = c.req.header("content-type") ?? "";
  const [config, detection, project] = await Promise.all([loadConfig(), detectBackends(), getProjectDetail(session.project_id)]);
  if (!hasTurnCapacity(config.harness.maxConcurrentSessions)) {
    return c.json(fail("turn_capacity_exhausted", "Too many turns are running; wait for one to finish", { limit: config.harness.maxConcurrentSessions }), 429);
  }
  const selectedBackend = detection.backends.find((backend) => backend.id === session.backend_id);
  if (project?.type === "graphic" && (session.backend_id !== "codex" || selectedBackend?.authenticated !== true)) return c.json(fail("graphic_requires_authenticated_codex", "Graphic generation requires authenticated Codex"), 409);
  const resolveGeneration = (value: unknown) => resolveGenerationOptions(session.backend_id, value, config, selectedBackend ?? { id: session.backend_id, found: false });
  let payload: UserEvent | null = null;
  let requestedOperationId: string | undefined;
  let reservation: UserTurnReservation | null = null;

  if (contentType.includes("application/json")) {
    const body = await c.req.json<unknown>().catch(() => null);
    if (
      isRecord(body) &&
      body.type === "user.message" &&
      typeof body.text === "string"
    ) {
      if (body.text.length > MAX_USER_MESSAGE_CHARS) return c.json(fail("message_too_long", `Message exceeds ${MAX_USER_MESSAGE_CHARS} characters`, { limit: MAX_USER_MESSAGE_CHARS }), 400);
      let generation: GenerationOptions;
      try { generation = resolveGeneration(body.generation === undefined ? undefined : parseGenerationOptions(body.generation)); }
      catch { return c.json(fail("invalid_generation_options", "Generation options are invalid"), 400); }
      let activeRelPath: string | undefined;
      try { activeRelPath = await parseActiveRelPath(body.active_rel_path, session.project_id); }
      catch (error) {
        if (error instanceof ActivePageError) return c.json(fail(error.code, error.code === "invalid_active_page" ? "Active page path is invalid" : "Active page is not a current HTML file in this project"), error.code === "invalid_active_page" ? 400 : 409);
        throw error;
      }
      let visualSources: readonly UploadedVisualSourceSelection[] | undefined;
      try { visualSources = parseUploadedVisualSourceSelections(body.visualSources); }
      catch (error) {
        if (error instanceof VisualSourceContractError) return c.json(fail(error.code, error.code === "unsupported_visual_source" ? "URL, web, and stock sources are unsupported" : "Visual source metadata is invalid"), error.code === "unsupported_visual_source" ? 415 : 400);
        throw error;
      }
      if (body.attachments !== undefined && (!Array.isArray(body.attachments) || !body.attachments.every((value) => typeof value === "string"))) return c.json(fail("invalid_attachments", "Attachment selection is invalid"), 400);
      try {
        const canonical = await canonicalizeAttachmentRequest({ sessionId: id, requestedPaths: body.attachments ?? [], selections: visualSources });
        payload = { type: "user.message", text: body.text, ...(activeRelPath === undefined ? {} : { active_rel_path: activeRelPath }), attachments: [...canonical.paths], visualSources: canonical.selections, generation };
      } catch (error) {
        if (error instanceof AttachmentRequestError) return c.json(fail(error.code, "Attachment selection is invalid"), 400);
        throw error;
      }
      if (body.operation_id !== undefined) {
        if (typeof body.operation_id !== "string" || process.env.BG_ARTIFACT_QA !== "1" || body.operation_id !== process.env.BG_ARTIFACT_TURN_OPERATION_ID) return c.json(fail("invalid_operation_id", "Scoped operation identity is invalid"), 400);
        try { requestedOperationId = assertSafeName(body.operation_id); }
        catch (error) { return c.json(fail("invalid_operation_id", error instanceof Error ? error.message : "Scoped operation identity is invalid"), 400); }
      }
    }
  } else if (contentType.includes("multipart/form-data")) {
    const form = await c.req.formData();
    const type = form.get("type");
    const text = form.get("text");
    if (type === "user.message" && typeof text === "string") {
      if (text.length > MAX_USER_MESSAGE_CHARS) return c.json(fail("message_too_long", `Message exceeds ${MAX_USER_MESSAGE_CHARS} characters`, { limit: MAX_USER_MESSAGE_CHARS }), 400);
      let generation: GenerationOptions;
      try { const raw = form.get("generation"); generation = resolveGeneration(raw === null ? undefined : parseGenerationOptions(typeof raw === "string" ? JSON.parse(raw) : raw)); }
      catch { return c.json(fail("invalid_generation_options", "Generation options are invalid"), 400); }
      let activeRelPath: string | undefined;
      try { activeRelPath = await parseActiveRelPath(form.get("active_rel_path"), session.project_id); }
      catch (error) {
        if (error instanceof ActivePageError) return c.json(fail(error.code, error.code === "invalid_active_page" ? "Active page path is invalid" : "Active page is not a current HTML file in this project"), error.code === "invalid_active_page" ? 400 : 409);
        throw error;
      }
      const fileEntries = form
        .getAll("files")
        .filter((value): value is File => value instanceof File);
      let attachmentPaths: string[];
      let uploadSources: VisualSourceUploadRequestV1;
      try {
        uploadSources = parseVisualSourceUploadRequest(form.get("visual_sources"), fileEntries.length);
        reservation = reserveUserTurn(id);
        if (reservation === null) return c.json(fail("session_busy", "A turn is already running for this session", { id }), 409);
        attachmentPaths = await saveSessionAttachments(id, fileEntries.map((file, index) => ({
          file,
          role: uploadSources.sources[index]?.role ?? "ordinary_content",
          roleExplicit: uploadSources.explicit,
        })));
      } catch (error) {
        if (reservation !== null) releaseUserTurnReservation(reservation);
        if (error instanceof VisualSourceContractError) {
          return c.json(fail(error.code, error.code === "unsupported_visual_source" ? "URL, web, and stock sources are unsupported" : "Visual source metadata is invalid"), error.code === "unsupported_visual_source" ? 415 : 400);
        }
        if (error instanceof UnsupportedAttachmentKindError) {
          return c.json(
            fail(error.code, "Unsupported source kind", {
              files: error.fileNames,
              supported_kinds: SUPPORTED_UPLOAD_KINDS,
            }),
            415,
          );
        }
        if (error instanceof Error && error.name === "AttachmentExtractionError" && "code" in error && typeof error.code === "string") {
          const codes = new Set(["pdf_password_required", "pdf_invalid", "pdf_runtime_unavailable", "pdf_extraction_timeout", "pdf_size_limit", "pdf_page_limit", "pdf_text_limit", "attachment_extract_failed"]);
          return c.json(fail(codes.has(error.code) ? error.code : "attachment_extract_failed", "Could not read the attachment. Its original remains in docs/attachments."), 422);
        }
        return c.json(
          fail("invalid_attachments", "Attachment upload rejected"),
          400,
        );
      }
      const selections = attachmentPaths.map((attachmentPath, index) => ({ source_type: "uploaded_attachment" as const, attachment_path: attachmentPath, role: uploadSources.sources[index]?.role ?? "ordinary_content" }));
      try {
        const canonical = await canonicalizeAttachmentRequest({ sessionId: id, requestedPaths: attachmentPaths, selections });
        payload = { type: "user.message", text, ...(activeRelPath === undefined ? {} : { active_rel_path: activeRelPath }), attachments: [...canonical.paths], visualSources: canonical.selections, generation };
      } catch (error) {
        await rollbackSessionAttachments(id, attachmentPaths);
        if (reservation !== null) releaseUserTurnReservation(reservation);
        if (error instanceof AttachmentRequestError) return c.json(fail(error.code, "Attachment selection is invalid"), 400);
        throw error;
      }
    }
  }

  if (!payload || payload.type !== "user.message") {
    return c.json(
      fail("invalid_body", "Expected a user.message payload with text"),
      400,
    );
  }

  reservation ??= reserveUserTurn(id, requestedOperationId);
  const turn = reservation === null ? null : startReservedUserTurn(reservation, payload);
  if (!turn) {
    return c.json(
      fail("session_busy", "A turn is already running for this session", { id }),
      409,
    );
  }

  const completed = turn.promise.catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    await persistAndPublishRoute(id, { id: ulid(), ts: Date.now(), type: "status.error", message, recoverable: true });
    await persistAndPublishRoute(id, { id: ulid(), ts: Date.now(), type: "status.idle", stopReason: "error" });
    await setSessionStatus(id, "idle");
  });
  try { await turn.prepared; }
  catch (error) {
    await completed;
    return c.json(fail("artifact_prepare_failed", error instanceof Error ? error.message : "Artifact operation preparation failed"), 500);
  }
  void completed;
  return c.json(ok({ accepted: true, turn_id: turn.turnId, operation_id: turn.operationId }));
});

sessionRoutes.post("/api/sessions/:id/interrupt", async (c) => {
  const id = c.req.param("id");
  const session = await getSessionInfo(id);
  if (!session) {
    return c.json(fail("session_not_found", "Session not found", { id }), 404);
  }

  const interrupted = interruptUserTurn(id);
  if (!interrupted && session.status === "running") {
    const event: NormalizedEvent = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      type: "status.idle",
      stopReason: "interrupted",
    };
    await persistAndPublishRoute(id, event);
    await setSessionStatus(id, "idle");
  }

  return c.json(ok({ accepted: true, interrupted }));
});

/**
 * Records a user's allow/deny decision for a pending
 * `tool.permission_required` event. Phase 2 wiring: the Claude Code
 * adapter does not yet surface permission prompts, so this endpoint is
 * exercised end-to-end via the dev-only `/dev/synthesize-permission`
 * route below. Deny aborts the active turn so the CLI exits cleanly.
 */
/**
 * Switches the CLI backend a session will use on its next turn. Only
 * allowed while the session is idle — switching mid-turn is undefined.
 */
sessionRoutes.patch("/api/sessions/:id/backend", async (c) => {
  const id = c.req.param("id");
  const session = await getSessionInfo(id);
  if (!session) {
    return c.json(fail("session_not_found", "Session not found", { id }), 404);
  }
  if (isUserTurnRunning(id) || session.status === "running") {
    return c.json(
      fail("session_busy", "Cannot switch backend while a turn is running", {
        id,
      }),
      409,
    );
  }

  const body = await c.req.json<unknown>().catch(() => null);
  if (!isRecord(body)) {
    return c.json(fail("invalid_body", "Expected a JSON object"), 400);
  }
  const backend = body.backend_id;
  if (backend !== "claude-code" && backend !== "codex") {
    return c.json(
      fail("invalid_backend", "backend_id must be 'claude-code' or 'codex'"),
      400,
    );
  }

  await setSessionBackend(id, backend);
  const refreshed = await getSessionInfo(id);
  return c.json(ok(refreshed));
});

sessionRoutes.post("/api/sessions/:id/tool-decision", async (c) => {
  const id = c.req.param("id");
  const session = await getSessionInfo(id);
  if (!session) {
    return c.json(fail("session_not_found", "Session not found", { id }), 404);
  }

  const body = await c.req.json<unknown>().catch(() => null);
  if (!isRecord(body)) {
    return c.json(fail("invalid_body", "Expected a JSON object"), 400);
  }
  const { toolCallId, decision, reason } = body;
  if (typeof toolCallId !== "string" || !toolCallId.trim()) {
    return c.json(
      fail("invalid_tool_call_id", "toolCallId is required"),
      400,
    );
  }
  if (decision !== "allow" && decision !== "deny") {
    return c.json(
      fail("invalid_decision", "decision must be 'allow' or 'deny'"),
      400,
    );
  }

  const payload: Extract<UserEvent, { type: "user.tool_decision" }> = {
    type: "user.tool_decision",
    toolCallId,
    decision,
    reason: typeof reason === "string" ? reason : undefined,
  };
  const decided = getSqlite().transaction(() => {
    const pending = readSessionSnapshot(getSqlite(), id)?.pending_permissions.find((item) => item.toolCallId === toolCallId);
    if (pending === undefined) return null;
    const now = Date.now();
    insertSequencedEvent(getSqlite(), { id: ulid(), sessionId: id, direction: "up", type: payload.type, payload, turnId: pending.turnId, processedAt: now, createdAt: now });
    const event: NormalizedEvent = { id: ulid(), ts: now, type: "tool.permission_decided", turnId: pending.turnId, toolCallId, decision };
    const persisted = persistNormalizedEvent(getSqlite(), id, event);
    getSqlite().prepare("UPDATE sessions SET status=? WHERE id=? AND status='awaiting_tool'").run(isUserTurnRunning(id) ? "running" : "idle", id);
    return persisted;
  })();
  if (decided === null) return c.json(fail("permission_not_pending", "This permission request is no longer pending"), 409);
  broker.publish(id, decided.event);
  sequencedBroker.publish(id, decided);

  // Hand the decision to the adapter that owns this session's turn
  // so it can forward it into the CLI's own channel (stdin pipe
  // today, structured mode later). This is the P3.6 round-trip
  // path — independent of the fallback below.
  const delivery = submitToolDecisionToTurn(id, payload);

  if (decision === "deny") {
    // Today's Claude Code `-p` invocation cannot actually skip a
    // pending tool — keep the hard-abort fallback so Deny always
    // stops the CLI. When an adapter upgrades to a mode where it
    // can resume after a deny, it can clear the abort itself via
    // the channel.
    const aborted = interruptUserTurn(id);
    if (!aborted && session.status === "running") {
      const idleEvent: NormalizedEvent = {
        id: ulid(),
        ts: Date.now(),
        type: "status.idle",
        stopReason: "interrupted",
      };
      await persistAndPublishRoute(id, idleEvent);
      await setSessionStatus(id, "idle");
    }
  }

  return c.json(ok({ accepted: true, decision, delivery }));
});

/**
 * Dev-only hook for exercising the permission gate UI without the
 * upstream CLI emitting a real `tool.permission_required`. Gated by
 * BG_DEV so a production build never exposes it.
 */
if (process.env.BG_DEV === "1") {
  sessionRoutes.post(
    "/api/sessions/:id/dev/synthesize-permission",
    async (c) => {
      const id = c.req.param("id");
      const session = await getSessionInfo(id);
      if (!session) {
        return c.json(
          fail("session_not_found", "Session not found", { id }),
          404,
        );
      }

      const body = await c.req.json<unknown>().catch(() => ({}));
      const rec = isRecord(body) ? body : {};
      const tool = typeof rec.tool === "string" ? rec.tool : "Bash";
      const input = rec.input ?? { command: "echo 'synthetic permission demo'" };
      const event: NormalizedEvent = {
        id: ulid(),
        ts: Date.now(),
        type: "tool.permission_required",
        turnId: typeof rec.turnId === "string" ? rec.turnId : "dev-synthesis",
        toolCallId: ulid(),
        tool,
        input,
      };
      await persistAndPublishRoute(id, event);
      return c.json(ok({ accepted: true, toolCallId: event.toolCallId }));
    },
  );
}

/**
 * Rolls a project's file tree back to the pre-turn snapshot captured
 * before `turnId`. Refuses while a turn is running — a concurrent
 * restore would race with the adapter writing fresh files.
 */
sessionRoutes.post(
  "/api/projects/:projectId/checkpoints/:turnId/restore",
  async (c) => {
    const projectId = c.req.param("projectId");
    const turnId = c.req.param("turnId");
    const project = await getProjectDetail(projectId);
    if (!project) {
      return c.json(
        fail("project_not_found", "Project not found", { projectId }),
        404,
      );
    }

    const snapshotPath = await getVerifiedSnapshotPath(projectId, turnId);
    if (snapshotPath === null) return c.json(fail("snapshot_not_found", "No verified pre-turn snapshot for this turn", { projectId, turnId }), 410);
    const body = await c.req.json<unknown>().catch(() => null);
    if (!isRecord(body) || typeof body.expected_revision !== "number" || typeof body.expected_artifact_digest !== "string") return c.json(fail("invalid_artifact_identity", "Expected artifact identity is required"), 400);

    const session = await getLatestProjectSession(projectId);
    if (session && isUserTurnRunning(session.id)) {
      return c.json(
        fail("session_busy", "Cannot restore while a turn is running", {
          sessionId: session.id,
        }),
        409,
      );
    }

    let operationId: string | undefined;
    if (body.operation_id !== undefined) {
      if (typeof body.operation_id !== "string" || process.env.BG_ARTIFACT_QA !== "1" || body.operation_id !== process.env.BG_ARTIFACT_FAULT_OPERATION_ID) return c.json(fail("invalid_operation_id", "Scoped operation identity is invalid"), 400);
      try { operationId = assertSafeName(body.operation_id); }
      catch (error) { return c.json(fail("invalid_operation_id", error instanceof Error ? error.message : "Scoped operation identity is invalid"), 400); }
    }
    try {
      let publicationWrites = 0;
      const coordinator = new ArtifactCoordinator(getSqlite(), operationId !== undefined && operationId === process.env.BG_ARTIFACT_FAULT_OPERATION_ID ? { afterPublishWrite: () => { publicationWrites += 1; if (publicationWrites === 1) process.kill(process.pid, "SIGKILL"); } } : {});
      if (project.current_digest === null) await coordinator.initialize(projectId, project.dir_path);
      const result = await coordinator.run({ projectId, projectDir: project.dir_path, kind: "restore", operationId, expectedRevision: body.expected_revision, expectedArtifactDigest: body.expected_artifact_digest, mutate: async (stage) => { await materializeManagedTree(snapshotPath, stage); } });
      if (session) await appendSessionTrace(session.id, { level: "turn_restored", turnId, operationId: result.id, revision: result.resultRevision, digest: result.resultDigest });
      return c.json(ok({ operation_id: result.id, status: result.status, base_revision: result.baseRevision, base_digest: result.baseDigest, result_revision: result.resultRevision, result_digest: result.resultDigest, diff: result.diff }));
    } catch (error) {
      if (error instanceof ArtifactOperationError) return c.json(fail(error.code, error.message), 409);
      throw error;
    }
  },
);

sessionRoutes.get("/api/sessions/:id/stream", async (c) => {
  const id = c.req.param("id");
  const session = await getSessionInfo(id);
  if (!session) {
    return c.json(fail("session_not_found", "Session not found", { id }), 404);
  }

  const cursorValue = c.req.header("Last-Event-ID") ?? c.req.query("after_sequence") ?? "0";
  const cursor = /^\d+$/.test(cursorValue) ? Number(cursorValue) : Number.NaN;
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    return c.json(fail("invalid_sequence_cursor", "Event cursor must be a non-negative integer"), 400);
  }

  return streamSSE(c, async (stream) => {
    let closed = false;
    let heartbeat: Timer | null = null;
    let unsubscribe = () => {};
    let resolveClosed: () => void = () => {};
    const closedPromise = new Promise<void>((resolve) => { resolveClosed = resolve; });
    const closeAndCleanup = () => {
      closed = true;
      if (heartbeat !== null) clearInterval(heartbeat);
      unsubscribe();
      resolveClosed();
    };
    const signal = c.req.raw.signal;
    const onAbort = closeAndCleanup;
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    try {
      unsubscribe = await subscribeBeforeBackfill({
      afterSequence: cursor,
      subscribe: (listener) => sequencedBroker.subscribe(id, listener),
      backfill: async (afterSequence) => listSessionEvents(id, afterSequence),
      emit: async (item) => {
        if (closed) return;
        await stream.writeSSE({ data: JSON.stringify(item), event: "message", id: String(item.sequence) });
      },
    });
      if (closed) return;

    // Heartbeat must fire inside Bun.serve's idleTimeout window (255s max)
    // to keep the SSE connection alive during long Claude Code runs.
    // 30 s is well below the limit but doesn't burn round-trips on idle
    // tabs; the previous 8 s value was a holdover from a smaller
    // idleTimeout.
    heartbeat = setInterval(() => {
      if (closed) {
        if (heartbeat !== null) clearInterval(heartbeat);
        return;
      }
      // Fire-and-forget but trap the promise — an unhandled rejection
      // here used to leak on every disconnected stream.
      void stream
        .writeSSE({
          data: JSON.stringify({ type: "heartbeat", ts: Date.now() }),
          event: "heartbeat",
        })
        .catch(() => {
          closeAndCleanup();
        });
    }, 30_000);

      await closedPromise;
    } finally {
      closeAndCleanup();
      signal.removeEventListener("abort", onAbort);
    }
  });
});
