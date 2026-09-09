import { ensureThreeSceneRuntime } from "./three-scene";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { ulid } from "ulid";
import type { NormalizedEvent, UserEvent } from "@bg/shared";
import { assignAttachmentsToTurn } from "../db/attachments";
import {
  persistNormalizedEvent,
  insertUserEvent,
  setSessionStatus,
} from "../db/events";
import { getProjectDetail, getSessionInfo } from "../db/seed";
import { getSqlite } from "../db/sqlite-client";
import { broker, sequencedBroker } from "./broker";
import { buildSessionContext } from "./context";
import { writePreTurnSnapshot, writeTurnCheckpoint } from "./checkpoints";
import { ArtifactCoordinator, ArtifactOperationError } from "./artifact-coordinator";
import { appendSessionTrace } from "./trace";
import { detectBackends } from "./backends";
import { resolveGenerationOptions } from "./generation-options";
import { buildPrompt } from "../harness/prompt-builder";
import { runAdapterTurn } from "../adapters/registry";
import { loadConfig } from "../config";
import { isDirectionOperationActive } from "./direction-operation-registry";
import { buildVisualSourceManifest } from "./visual-source-manifest";
import { captureImmutableAttachments, verifyImmutableAttachments } from "./immutable-attachment-guard";
import { redactPrivateAttachmentPaths, withPrivateAttachmentInputs } from "./stage-attachment-inputs";
import { sanitizeTurnEvent } from "./turn-error-sanitizer";

export function assertGraphicStarterReplaced(before: string, after: string): void {
  if (before.includes('data-bg-node-id="graphic-copy"') && before.includes("Start with one clear visual message.") && before === after) throw new Error("graphic_starter_unchanged");
}

type ToolDecision = Extract<UserEvent, { type: "user.tool_decision" }>;

interface ActiveTurn {
  readonly reservationId: string;
  abortController: AbortController;
  interrupted: boolean;
  /**
   * Tool decisions that arrived before the adapter registered a
   * handler. Drained when `onDecision` is called. When flush is done
   * the queue is kept for safety — any late registration still sees
   * the backlog exactly once.
   */
  decisionQueue: ToolDecision[];
  decisionHandler: ((decision: ToolDecision) => void) | null;
  /**
   * The running turn body, set once `startReservedUserTurn` kicks it off.
   * Only `interruptAllUserTurns` awaits it, so shutdown can let a turn
   * unwind instead of killing the process out from under a publication.
   */
  completion: Promise<unknown> | null;
}

const activeTurns = new Map<string, ActiveTurn>();

/** Upper bound on how long shutdown waits for interrupted turns to unwind. */
const SHUTDOWN_DRAIN_MS = 5_000;

async function listDirSafe(dir: string): Promise<string[] | string> {
  try {
    return await readdir(dir);
  } catch (err) {
    return `<error: ${err instanceof Error ? err.message : String(err)}>`;
  }
}

export async function persistAndPublish(sessionId: string, event: NormalizedEvent, cause?: unknown) {
  if (cause !== undefined) {
    console.error("[turn] error diagnostic", cause);
    await appendSessionTrace(sessionId, { level: "turn_error_diagnostic", error: diagnosticError(cause) });
  }
  const safeEvent = sanitizeTurnEvent(event, cause);
  const persisted = persistNormalizedEvent(getSqlite(), sessionId, safeEvent);
  broker.publish(sessionId, safeEvent);
  sequencedBroker.publish(sessionId, persisted);
  await appendSessionTrace(sessionId, {
    level: "event",
    event: safeEvent,
  });
}

function diagnosticError(error: unknown): Readonly<Record<string, unknown>> {
  if (!(error instanceof Error)) return { value: String(error) };
  return { name: error.name, message: error.message, stack: error.stack, ...("code" in error ? { code: error.code } : {}) };
}

/**
 * Drives a single user turn end-to-end:
 *   1. Persist the user.message
 *   2. Build the prompt (harness/prompt-builder)
 *   3. Detect and invoke the CLI adapter (claude-code or codex)
 *   4. Stream normalized events back through the broker + persist to SQLite
 *   5. Reindex project files + checkpoint the turn
 *
 * No templated HTML is written here — all artifact creation comes from the
 * real LLM CLI. See doc/03-backend-adapters.md for the event-normalization
 * contract the adapters must satisfy.
 */
export function isUserTurnRunning(sessionId: string) {
  return activeTurns.has(sessionId);
}

export function interruptUserTurn(sessionId: string) {
  const active = activeTurns.get(sessionId);
  if (!active) {
    return false;
  }

  active.interrupted = true;
  active.abortController.abort();
  return true;
}

/**
 * Aborts every running turn and waits — bounded by `SHUTDOWN_DRAIN_MS` — for
 * the turn bodies to unwind. Called first in the process shutdown path so a
 * Ctrl+C stops the CLI subprocesses instead of orphaning them.
 */
export async function interruptAllUserTurns(): Promise<void> {
  const pending: Promise<unknown>[] = [];
  for (const active of activeTurns.values()) {
    active.interrupted = true;
    active.abortController.abort();
    if (active.completion !== null) pending.push(active.completion);
  }
  if (pending.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const drainDeadline = new Promise<void>((resolve) => { timer = setTimeout(resolve, SHUTDOWN_DRAIN_MS); });
  try { await Promise.race([Promise.allSettled(pending), drainDeadline]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

/**
 * Delivers a tool decision to the running turn's adapter. Called from
 * `routes/session.ts` after a `POST /tool-decision`. Returns:
 *
 *   - `"delivered"`  — an adapter handler consumed the decision
 *   - `"queued"`     — no handler yet; it will be drained on register
 *   - `"no_active_turn"` — no active turn for this session
 *
 * Denies currently continue to interrupt the turn at the route layer
 * regardless of return value because today's Claude Code `-p` mode
 * can't actually skip a tool call. That fallback is the right
 * behaviour until an adapter upgrades to a mode where a real round-
 * trip through stdin is possible.
 */
export function submitToolDecisionToTurn(
  sessionId: string,
  decision: ToolDecision,
): "delivered" | "queued" | "no_active_turn" {
  const active = activeTurns.get(sessionId);
  if (!active) return "no_active_turn";
  if (active.decisionHandler) {
    try {
      active.decisionHandler(decision);
    } catch {
      // Handlers shouldn't throw. If one does, queue so a replacement
      // handler can retry.
      active.decisionQueue.push(decision);
      return "queued";
    }
    return "delivered";
  }
  active.decisionQueue.push(decision);
  return "queued";
}

export type UserTurnReservation = {
  readonly reservationId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly operationId: string;
};

export type TurnDependencies = { readonly runAdapter?: typeof runAdapterTurn; readonly detectBackends?: typeof detectBackends };

export function reserveUserTurn(sessionId: string, requestedOperationId?: string): UserTurnReservation | null {
  if (activeTurns.has(sessionId) || isDirectionOperationActive(sessionId)) return null;
  const reservation = { reservationId: ulid(), sessionId, turnId: ulid(), operationId: requestedOperationId ?? ulid() };
  activeTurns.set(sessionId, { reservationId: reservation.reservationId, abortController: new AbortController(), interrupted: false, decisionQueue: [], decisionHandler: null, completion: null });
  return reservation;
}

export function releaseUserTurnReservation(reservation: UserTurnReservation): void {
  if (activeTurns.get(reservation.sessionId)?.reservationId === reservation.reservationId) activeTurns.delete(reservation.sessionId);
}

export function startReservedUserTurn(reservation: UserTurnReservation, payload: Extract<UserEvent, { type: "user.message" }>, dependencies: TurnDependencies = {}) {
  const activeTurn = activeTurns.get(reservation.sessionId);
  if (activeTurn?.reservationId !== reservation.reservationId) return null;
  const { sessionId, turnId, operationId } = reservation;
  let resolvePrepared: () => void = () => {};
  let rejectPrepared: (error: unknown) => void = () => {};
  const prepared = new Promise<void>((resolve, reject) => { resolvePrepared = resolve; rejectPrepared = reject; });
  const promise = runUserTurnInternal(sessionId, payload, activeTurn, turnId, operationId, resolvePrepared, dependencies)
    .catch(async (error: unknown) => { rejectPrepared(error); await setSessionStatus(sessionId, "idle"); throw error; })
    .finally(() => activeTurns.delete(sessionId));
  activeTurn.completion = promise;
  return { promise, prepared, turnId, operationId };
}

export function startUserTurn(sessionId: string, payload: Extract<UserEvent, { type: "user.message" }>, requestedOperationId?: string, dependencies: TurnDependencies = {}) {
  const reservation = reserveUserTurn(sessionId, requestedOperationId);
  return reservation === null ? null : startReservedUserTurn(reservation, payload, dependencies);
}

async function runUserTurnInternal(
  sessionId: string,
  payload: Extract<UserEvent, { type: "user.message" }>,
  activeTurn: ActiveTurn,
  turnId: string,
  operationId: string,
  onPrepared: () => void,
  dependencies: TurnDependencies,
) {
  const session = await getSessionInfo(sessionId);
  if (!session) {
    throw new Error("session_not_found");
  }

  const backendId = session.backend_id;
  const attachmentCount = await assignAttachmentsToTurn(
    sessionId,
    payload.attachments ?? [],
    turnId,
  );
  const sessionContext = await buildSessionContext(sessionId);
  if (!sessionContext) throw new Error("session_not_found");
  const visualSources = await buildVisualSourceManifest({
    projectDir: sessionContext.project.project_dir,
    attachments: sessionContext.attachments,
    requestedPaths: payload.attachments ?? [],
    selections: payload.visualSources,
  });
  await insertUserEvent(sessionId, payload);
  await appendSessionTrace(sessionId, {
    level: "input",
    payload,
    attachment_count: attachmentCount,
  });
  await setSessionStatus(sessionId, "running");

  const startTs = Date.now();

  // Persist the user's own message as a normalized event so that replay
  // (page reload, history fetch) renders the full conversation — not just
  // the agent side. `direction=up` user events are filtered out by
  // listSessionEvents, so without this the user bubble would disappear.
  const userMessage: NormalizedEvent = {
    id: ulid(),
    ts: startTs,
    type: "chat.user_message",
    turnId,
    text: payload.text,
    attachmentCount,
    ...(visualSources === null ? {} : { visualSources }),
  };
  await persistAndPublish(sessionId, userMessage);

  await persistAndPublish(sessionId, {
    id: ulid(),
    ts: startTs,
    type: "status.running",
  });

  const detection = await (dependencies.detectBackends ?? detectBackends)({ force: true });
  const backend = detection.backends.find((b) => b.id === backendId);

  if (!backend?.found || !backend.binary_path) {
    await persistAndPublish(sessionId, {
      id: ulid(),
      ts: Date.now(),
      type: "status.error",
      code: "backend_unavailable",
      message: `${backendId} CLI not found on PATH. ${backend?.install_hint ?? "Install and retry."}`,
      recoverable: true,
    });
    await persistAndPublish(sessionId, {
      id: ulid(),
      ts: Date.now(),
      type: "status.idle",
      stopReason: "error",
    });
    await setSessionStatus(sessionId, "idle");
    throw new Error("backend_unavailable");
  }

  const binaryPath = backend.binary_path;
  const config = await loadConfig();
  const projectDir = sessionContext.project.project_dir;
  const project = await getProjectDetail(sessionContext.project.project_id);
  if (project === null) throw new Error("project_not_found");
  if (project.type === "graphic" && (backendId !== "codex" || backend.authenticated !== true)) throw new Error("graphic_requires_authenticated_codex");
  const generation = resolveGenerationOptions(backendId, payload.generation, config, backend);
  const coordinator = new ArtifactCoordinator(getSqlite());
  const base = await coordinator.initialize(project.id, projectDir);
  // The revert route only offers a rollback when a pre-turn snapshot exists,
  // so it has to be taken here — before the adapter can touch the tree. A
  // failed snapshot costs the user the rollback, never the turn itself.
  try { await writePreTurnSnapshot(project.id, turnId); }
  catch (error) { await appendSessionTrace(sessionId, { level: "checkpoint_snapshot_failed", turnId, error: error instanceof Error ? error.message : String(error) }); }
  let operationPrepared = false;
  const terminalEvents: NormalizedEvent[] = [];
  const selectedAttachments = sessionContext.attachments.filter((attachment) => payload.attachments?.includes(attachment.file_path) ?? false);
  const forbiddenSha256 = new Set(selectedAttachments.filter((attachment) => attachment.source_role === "immutable_reference").flatMap((attachment) => attachment.sha256 === null ? [] : [attachment.sha256]));
  try {
    await coordinator.run({
      projectId: project.id, projectDir, kind: "turn", operationId,
      expectedRevision: project.current_revision, expectedArtifactDigest: base.tree_digest,
      publicationPolicy: { forbiddenSha256 },
      onPrepared: () => { operationPrepared = true; onPrepared(); },
      mutate: async (stageDir) => {
        const graphicEntrypoint = project.type === "graphic" ? path.join(stageDir, project.entrypoint) : null;
        const graphicBefore = graphicEntrypoint === null ? null : await readFile(graphicEntrypoint, "utf8");
        const waitsForInterrupt = process.env.BG_ARTIFACT_QA === "1" && operationId === process.env.BG_ARTIFACT_TURN_OPERATION_ID && process.env.BG_ARTIFACT_TURN_BARRIER === "abort";
        if (waitsForInterrupt && !activeTurn.abortController.signal.aborted) await new Promise<void>((resolve) => activeTurn.abortController.signal.addEventListener("abort", () => resolve(), { once: true }));
        if (activeTurn.abortController.signal.aborted) throw new ArtifactOperationError("operation_cancelled", "Turn was interrupted");
        await appendSessionTrace(sessionId, { level: "adapter_stage_dir", turnId, operationId, projectDir: stageDir });
        const immutableSnapshots = await captureImmutableAttachments(selectedAttachments);
        try {
          await withPrivateAttachmentInputs({ operationDir: path.dirname(stageDir), projectDir, attachments: sessionContext.attachments, requestedPaths: payload.attachments ?? [], immutableSnapshots }, async (stageInputs) => {
            const prompt = await buildPrompt(sessionContext, payload, { outputDirectory: stageDir, contextMode: config.chat.contextMode, visualSourceManifest: visualSources, stageAttachmentInputs: stageInputs, backendId, generation });
            await appendSessionTrace(sessionId, { level: "prompt_built", turnId, prompt_chars: prompt.length, context_mode: config.chat.contextMode, backend_id: backendId, binary: binaryPath });
            let providerFailed = false;
            const result = await (dependencies.runAdapter ?? runAdapterTurn)(backendId, {
              sessionId, turnId, projectDir: stageDir, binaryPath, prompt,
              generation,
              ...(generation.provider === "commandcode" ? { commandcodeApiKey: config.commandcodeApiKey ?? undefined } : {}),
              signal: activeTurn.abortController.signal, userEvent: payload,
              onEvent: async (event) => {
                if (event.type === "status.error" || (event.type === "status.idle" && event.stopReason === "error")) providerFailed = true;
                if (event.type === "file.changed") return;
                const scrubbedEvent = config.commandcodeApiKey ? JSON.parse(JSON.stringify(event, (_key, value: unknown) => typeof value === "string" ? value.split(config.commandcodeApiKey!).join("[redacted]") : value)) as NormalizedEvent : event;
                const safeEvent = redactPrivateAttachmentPaths(scrubbedEvent, stageInputs);
                if (safeEvent.type === "chat.message_end" || safeEvent.type === "status.idle") { terminalEvents.push(safeEvent); return; }
                const eventError = safeEvent.type === "status.error" ? Object.assign(new Error(safeEvent.message), safeEvent.code === undefined ? {} : { code: safeEvent.code }) : undefined;
                await persistAndPublish(sessionId, safeEvent, eventError);
              },
              onStderr: async (line) => { await appendSessionTrace(sessionId, { level: "stderr", turnId, line: config.commandcodeApiKey ? line.split(config.commandcodeApiKey).join("[redacted]") : line }); },
              onDecision: (handler) => {
                activeTurn.decisionHandler = handler;
                for (const decision of activeTurn.decisionQueue.splice(0)) handler(decision);
                return () => { if (activeTurn.decisionHandler === handler) activeTurn.decisionHandler = null; };
              },
            });
            if (result.exitCode !== 0 || providerFailed) throw new ArtifactOperationError("turn_failed", "Provider did not complete the turn successfully");
          });
        } finally {
          await verifyImmutableAttachments(immutableSnapshots);
        }
        if (activeTurn.abortController.signal.aborted) throw new ArtifactOperationError("operation_cancelled", "Turn was interrupted");
        await ensureThreeSceneRuntime(stageDir);
        if (graphicEntrypoint !== null && graphicBefore !== null) {
          const info = await lstat(graphicEntrypoint);
          if (!info.isFile() || info.nlink !== 1 || info.size > 16 * 1024 * 1024) throw new Error("graphic_starter_unchanged");
          assertGraphicStarterReplaced(graphicBefore, await readFile(graphicEntrypoint, "utf8"));
        }
      },
    });
    for (const event of terminalEvents) await persistAndPublish(sessionId, event);
  } catch (error) {
    if (!operationPrepared) throw error;
    if (activeTurn.interrupted || activeTurn.abortController.signal.aborted) {
      await persistAndPublish(sessionId, { id: ulid(), ts: Date.now(), type: "status.idle", stopReason: "interrupted" });
    } else {
      await persistAndPublish(sessionId, { id: ulid(), ts: Date.now(), type: "status.error", message: "turn_failed", recoverable: true }, error);
      await persistAndPublish(sessionId, { id: ulid(), ts: Date.now(), type: "status.idle", stopReason: "error" });
    }
    await setSessionStatus(sessionId, "idle");
    return;
  }

  const postTurnListing = await listDirSafe(projectDir);
  const spawnCwdListing = await listDirSafe(process.cwd());
  console.log(
    `[turn] post-turn projectDir=${projectDir} contents=`,
    postTurnListing,
  );
  console.log(
    `[turn] post-turn process.cwd=${process.cwd()} contents=`,
    Array.isArray(spawnCwdListing)
      ? spawnCwdListing.filter(
          (name) => name.endsWith(".html") || name.endsWith(".css"),
        )
      : spawnCwdListing,
  );
  await appendSessionTrace(sessionId, {
    level: "post_turn_dir",
    turnId,
    projectDir,
    entries: postTurnListing,
  });

  await setSessionStatus(sessionId, "idle");

  const checkpoint = await writeTurnCheckpoint(
    sessionContext.project.project_id,
    turnId,
  );
  await appendSessionTrace(sessionId, {
    level: "turn_complete",
    turnId,
    checkpoint,
  });
}
