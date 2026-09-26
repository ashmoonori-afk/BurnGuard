import { ensureGraphicCapableBackend, isGraphicCapableBackend } from "./graphic-capability";
import { ensureThreeSceneRuntime } from "./three-scene";
import { ensureCharts } from "./charts";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ulid } from "ulid";
import type { NormalizedEvent, TurnNotApplied, TurnRejectionReason, UserEvent } from "@bg/shared";
import { LOGO_FILES } from "@bg/shared";
import { assignAttachmentsToTurn } from "../db/attachments";
import {
  persistNormalizedEvent,
  insertUserEvent,
  setSessionStatus,
} from "../db/events";
import { getProjectDetail, getSessionInfo } from "../db/seed";
import { getSqlite } from "../db/sqlite-client";
import { broker, sequencedBroker } from "./broker";
import { buildSessionContext, readDeckSourcePages, selectContextAttachments } from "./context";
import { parseStoredProjectOptions } from "./project-options";
import { writePreTurnSnapshot, writeTurnCheckpoint } from "./checkpoints";
import { ArtifactCoordinator, ArtifactOperationError } from "./artifact-coordinator";
import { appendSessionTrace } from "./trace";
import { detectBackends } from "./backends";
import { resolveGenerationOptions } from "./generation-options";
import { buildPrompt } from "../harness/prompt-builder";
import type { TaskPresetObservation } from "../harness/task-preset-observation";
import { DECK_REVIEW_PROMPT } from "../harness/skills/deck-skill";
import { runAdapterTurn } from "../adapters/registry";
import { loadConfig } from "../config";
import { hasAgentControlFiles } from "../security/agent-control-files";
import { isDirectionOperationActive } from "./direction-operation-registry";
import { buildVisualSourceManifest } from "./visual-source-manifest";
import { captureImmutableAttachments, verifyImmutableAttachments } from "./immutable-attachment-guard";
import { redactPrivateAttachmentPaths, withPrivateAttachmentInputs } from "./stage-attachment-inputs";
import { sanitizeTurnEvent, turnRejectionReason } from "./turn-error-sanitizer";
import { isRepairableLogoRejection, repairLogoCompletion } from "./logo-completion-repair";
import { logoSvgViolation } from "./logo-svg-validation";
import { startTurnPreview } from "./turn-preview";
import { findHtmlEncodingIssues } from "./generated-html-encoding";
import { runWithContinuation } from "./turn-continuation";
import { needsGenerationPhases, runGenerationPhases } from "./turn-phases";
import { generationOutputComplete } from "./generation-output";
import { parse } from "node-html-parser";
import { prepareSlideDeckExport } from "./export-stage";
import { blockingDesignFindings, DesignReviewError, reviewTurnDesign } from "./turn-design-review";
import { designAuditCanvas } from "./design-audit";
import { assertLogoDeliverables, captureLogoTurnExpectation, LogoDeliverableError, LogoEvidenceCollector } from "./logo-deliverables";
import { applyLogoDesignSystemPatch } from "./logo-design-system-sync";
import { inspectCanonicalTree, type CanonicalTreeManifest } from "./canonical-tree-manifest";
import { manifestEntry, readManagedFile } from "./artifact-tree-storage";
import { resolveWithin } from "../security/path-boundary";

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
    const code =
      err instanceof Error && "code" in err && typeof err.code === "string"
        ? err.code
        : "unavailable";
    return `<error: ${code}>`;
  }
}

export async function persistAndPublish(sessionId: string, event: NormalizedEvent, cause?: unknown) {
  if (cause !== undefined) {
    const diagnostic = diagnosticError(cause);
    console.error("[turn] error diagnostic", diagnostic);
    await appendSessionTrace(sessionId, {
      level: "turn_error_diagnostic",
      error: diagnostic,
    });
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

/**
 * Which paths differ between two canonical manifests of the same stage.
 *
 * Content, additions and removals all count; the comparison is on the manifest's own hashes, so it
 * sees exactly what publication would see.
 */
function changedTreePaths(before: CanonicalTreeManifest, after: CanonicalTreeManifest): readonly string[] {
  const previous = new Map(before.files.map((file) => [file.path, file.sha256]));
  const current = new Map(after.files.map((file) => [file.path, file.sha256]));
  const changed = new Set<string>();
  for (const [path, sha256] of current) if (previous.get(path) !== sha256) changed.add(path);
  for (const path of previous.keys()) if (!current.has(path)) changed.add(path);
  return [...changed];
}

function diagnosticError(error: unknown): Readonly<Record<string, unknown>> {
  if (!(error instanceof Error)) {
    return { name: "NonErrorThrown", valueType: typeof error };
  }
  const name = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.name)
    ? error.name
    : "Error";
  const code =
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Za-z0-9_.-]{1,100}$/.test(error.code)
      ? error.code
      : undefined;
  return { name, ...(code === undefined ? {} : { code }) };
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

export type TurnDependencies = { readonly runAdapter?: typeof runAdapterTurn; readonly detectBackends?: typeof detectBackends; readonly reviewDesign?: typeof reviewTurnDesign };

export type UserTurnAdmission =
  | { readonly kind: "reserved"; readonly reservation: UserTurnReservation }
  | { readonly kind: "session_busy" }
  | { readonly kind: "capacity_exhausted" };

/** Check and acquire together, without yielding between global and per-session admission. */
export function admitUserTurn(sessionId: string, maxConcurrentTurns: number): UserTurnAdmission {
  if (activeTurns.has(sessionId) || isDirectionOperationActive(sessionId)) return { kind: "session_busy" };
  if (!hasTurnCapacity(maxConcurrentTurns)) return { kind: "capacity_exhausted" };
  const reservation = reserveUserTurn(sessionId);
  return reservation === null ? { kind: "session_busy" } : { kind: "reserved", reservation };
}

export function reserveUserTurn(sessionId: string, requestedOperationId?: string): UserTurnReservation | null {
  if (activeTurns.has(sessionId) || isDirectionOperationActive(sessionId)) return null;
  const reservation = { reservationId: ulid(), sessionId, turnId: ulid(), operationId: requestedOperationId ?? ulid() };
  activeTurns.set(sessionId, { reservationId: reservation.reservationId, abortController: new AbortController(), interrupted: false, decisionQueue: [], decisionHandler: null, completion: null });
  return reservation;
}

/** Whether another CLI turn may start anywhere in the process; `harness.maxConcurrentSessions` is the ceiling. */
export function hasTurnCapacity(maxConcurrentTurns: number): boolean {
  return activeTurns.size < maxConcurrentTurns;
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
  await setSessionStatus(sessionId, "running");
  const attachmentCount = await assignAttachmentsToTurn(
    sessionId,
    payload.attachments ?? [],
    turnId,
  );
  const sessionContext = await buildSessionContext(sessionId);
  if (!sessionContext) throw new Error("session_not_found");
  // Previously submitted documents remain available after navigation/restart.
  const contextPayload = { ...payload, attachments: selectContextAttachments(sessionContext.attachments, payload.attachments ?? [], payload.text) };
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

  // Graphic projects are rejected below unless they selected Codex, so only a Codex turn depends
  // on the authentication answer. Other backends stay usable while a Codex probe is indeterminate.
  const detection = await (dependencies.detectBackends ?? detectBackends)({ force: true, requireCodexAuthentication: backendId === "codex" });
  const backend = detection.backends.find((b) => b.id === backendId);

  // The caller publishes the one sanitized error and idle for a turn that fails before preparation.
  if (!backend?.found || !backend.binary_path) throw Object.assign(new Error("backend_unavailable"), { code: "backend_unavailable" });

  const binaryPath = backend.binary_path;
  const config = await loadConfig();
  const projectDir = sessionContext.project.project_dir;
  const project = await getProjectDetail(sessionContext.project.project_id);
  if (project === null) throw new Error("project_not_found");
  if (await hasAgentControlFiles(projectDir)) {
    throw Object.assign(new Error("agent_control_files_present"), {
      code: "agent_control_files_present",
    });
  }
  const generation = resolveGenerationOptions(backendId, payload.generation, config, backend);
  // The selected model decides whether this backend can draw, so the gate follows resolution.
  if (project.type === "graphic") ensureGraphicCapableBackend(backend, generation.model);
  // A logo is drawn with the same image capability; only the refusal code differs, so the client
  // can name the deliverable the user actually asked for.
  if (project.type === "logo" && !isGraphicCapableBackend(backend, generation.model)) throw new Error("logo_requires_authenticated_codex");
  const coordinator = new ArtifactCoordinator(getSqlite());
  const base = await coordinator.initialize(project.id, projectDir);
  // The revert route only offers a rollback when a pre-turn snapshot exists,
  // so it has to be taken here — before the adapter can touch the tree. A
  // failed snapshot costs the user the rollback, never the turn itself.
  try { await writePreTurnSnapshot(project.id, turnId); }
  catch (error) {
    await appendSessionTrace(sessionId, {
      level: "checkpoint_snapshot_failed",
      turnId,
      error: diagnosticError(error),
    });
  }
  let operationPrepared = false;
  /** Set once the artifact operation is terminal and committed: its work is in the project. */
  let publishedOperation = false;
  let providerReportedFailure = false;
  let providerErrorPublished = false;
  let stopPreview: (() => Promise<void>) | undefined;
  /** Captured selection, retained only after the finalize deliverable gate succeeds. */
  let finalizedLogoSource: string | null = null;
  /** Bounded targeted repairs of the finished deliverable; the gate allows at most one. */
  let logoRepairs = 0;
  /**
   * The finite reason the completion gate refused, recorded where the domain error is still
   * itself. The artifact coordinator rethrows a fresh error carrying only the public message, so
   * the reason has to be captured here or it is gone by the time the failure is published.
   */
  let rejectionReason: TurnRejectionReason | undefined;
  const terminalEvents: NormalizedEvent[] = [];
  const selectedAttachments = sessionContext.attachments.filter((attachment) => contextPayload.attachments.includes(attachment.file_path));
  const forbiddenSha256 = new Set(selectedAttachments.filter((attachment) => attachment.source_role === "immutable_reference").flatMap((attachment) => attachment.sha256 === null ? [] : [attachment.sha256]));
  try {
    const operation = await coordinator.run({
      projectId: project.id, projectDir, kind: "turn", operationId,
      expectedRevision: project.current_revision, expectedArtifactDigest: base.tree_digest,
      publicationPolicy: { forbiddenSha256 },
      onPrepared: () => { operationPrepared = true; onPrepared(); },
      mutate: async (stageDir) => {
        const sourcePages = project.type === "slide_deck"
          ? await readDeckSourcePages(
            selectedAttachments,
            parseStoredProjectOptions(project.options_json).design_brief?.source_page_mapping,
            payload.attachments ?? [],
          )
          : undefined;
        // Old projects carry a copied runtime. Refresh only the owned stage,
        // so the preview receives engine fixes without touching live files.
        if (project.type === "slide_deck") await prepareSlideDeckExport(stageDir, project.entrypoint);
        stopPreview = startTurnPreview({ projectId: project.id, id: operationId, stageDir, entrypoint: payload.active_rel_path ?? project.entrypoint, forbiddenSha256 }, (event) => persistAndPublish(sessionId, event));
        const graphicEntrypoint = project.type === "graphic" ? path.join(stageDir, project.entrypoint) : null;
        const graphicBefore = graphicEntrypoint === null ? null : await readFile(graphicEntrypoint, "utf8");
        // The logo gate's expectation is captured before the agent runs, so nothing the model writes
        // during the turn can change which phase is checked or which candidate counts as selected.
        const logoExpectation = project.type === "logo" ? await captureLogoTurnExpectation(stageDir, payload.text) : null;
        const logoEvidence = logoExpectation === null ? null : new LogoEvidenceCollector(stageDir, logoExpectation);
        const deckStarter = project.type === "slide_deck" && (await readFile(path.join(stageDir, project.entrypoint), "utf8")).includes("Send your first prompt in chat to expand this deck.");
        const waitsForInterrupt = process.env.BG_ARTIFACT_QA === "1" && operationId === process.env.BG_ARTIFACT_TURN_OPERATION_ID && process.env.BG_ARTIFACT_TURN_BARRIER === "abort";
        if (waitsForInterrupt && !activeTurn.abortController.signal.aborted) await new Promise<void>((resolve) => activeTurn.abortController.signal.addEventListener("abort", () => resolve(), { once: true }));
        if (activeTurn.abortController.signal.aborted) throw new ArtifactOperationError("operation_cancelled", "Turn was interrupted");
        await appendSessionTrace(sessionId, {
          level: "adapter_stage_ready",
          turnId,
          operationId,
        });
        // What this turn changes is measured against the stage as the adapter found it, so a
        // finding that predates the turn on an untouched page cannot refuse it.
        const beforeAdapter = await inspectCanonicalTree(stageDir);
        const immutableSnapshots = await captureImmutableAttachments(selectedAttachments);
        try {
          await withPrivateAttachmentInputs({ operationDir: path.dirname(stageDir), projectDir, attachments: sessionContext.attachments, requestedPaths: contextPayload.attachments, immutableSnapshots }, async (stageInputs) => {
            // Observe the guidance that was actually emitted rather than re-deriving it, so the
            // record cannot drift from the envelope the model received.
            let shippedPreset: TaskPresetObservation | null = null;
            const sourceInstructions = sourcePages === undefined ? "" : `\n<deck_source_page_mapping>\n${JSON.stringify({ schema_version: 1, mode: "one_to_one", pages: sourcePages })}\n</deck_source_page_mapping>\nKeep exactly one slide per source page in this order, with matching data-bg-source-attachment and data-bg-source-page attributes. Do not split, merge, omit or reorder source pages. Preserve their content and conditions; visual styling follows the selected design reference.`;
            const prompt = await buildPrompt(sessionContext, contextPayload, { outputDirectory: stageDir, contextMode: config.chat.contextMode, visualSourceManifest: visualSources, stageAttachmentInputs: stageInputs, backendId, generation, onTaskGuidance: (value) => { shippedPreset = value; } }) + sourceInstructions;
            await appendSessionTrace(sessionId, { level: "prompt_built", turnId, prompt_chars: prompt.length, context_mode: config.chat.contextMode, backend_id: backendId, task_preset: shippedPreset });
            const adapterInput: Parameters<typeof runAdapterTurn>[1] = {
              sessionId, turnId, projectDir: stageDir, binaryPath, prompt,
              generation,
              ...(generation.provider === "commandcode" ? { commandcodeApiKey: config.commandcodeApiKey ?? undefined } : {}),
              signal: activeTurn.abortController.signal, userEvent: payload,
              onEvent: async (event) => {
                // Cancellation is finalized only after the stopped writer's stage is saved.
                if (activeTurn.interrupted && event.type === "status.error") return;
                if (event.type === "status.error" || (event.type === "status.idle" && event.stopReason === "error")) providerReportedFailure = true;
                if (event.type === "file.changed") return;
                if (logoEvidence !== null) await logoEvidence.observe(event);
                const scrubbedEvent = config.commandcodeApiKey ? JSON.parse(JSON.stringify(event, (_key, value: unknown) => typeof value === "string" ? value.split(config.commandcodeApiKey!).join("[redacted]") : value)) as NormalizedEvent : event;
                const safeEvent = redactPrivateAttachmentPaths(scrubbedEvent, stageInputs);
                if (safeEvent.type === "status.error") providerErrorPublished = true;
                if (safeEvent.type === "chat.message_end" || safeEvent.type === "status.idle") { terminalEvents.push(safeEvent); return; }
                const eventError = safeEvent.type === "status.error" ? Object.assign(new Error(safeEvent.message), safeEvent.code === undefined ? {} : { code: safeEvent.code }) : undefined;
                await persistAndPublish(sessionId, safeEvent, eventError);
              },
              onStderr: async (line) => {
                await appendSessionTrace(sessionId, {
                  level: "stderr",
                  turnId,
                  bytes: Buffer.byteLength(line, "utf8"),
                });
              },
              onDecision: (handler) => {
                activeTurn.decisionHandler = handler;
                for (const decision of activeTurn.decisionQueue.splice(0)) handler(decision);
                return () => { if (activeTurn.decisionHandler === handler) activeTurn.decisionHandler = null; };
              },
            };
            const runAdapter = dependencies.runAdapter ?? runAdapterTurn;
            try {
              const result = needsGenerationPhases(project.type, payload.text, deckStarter)
                ? await runGenerationPhases(adapterInput, project.entrypoint, (input) => runAdapter(backendId, input), project.type, sourcePages)
                : await runWithContinuation(adapterInput, (input) => runAdapter(backendId, input), () => generationOutputComplete(stageDir, project.entrypoint, project.type, sourcePages?.length, sourcePages));
              if (result.exitCode !== 0 || providerReportedFailure) throw new ArtifactOperationError("turn_failed", "Provider did not complete the turn successfully");
              if (project.type === "slide_deck") {
                const expectedSlides = sourcePages?.length ?? parse(await readFile(path.join(stageDir, project.entrypoint), "utf8")).querySelectorAll("[data-slide]").length;
                const toolCallId = ulid();
                await persistAndPublish(sessionId, { id: ulid(), ts: Date.now(), type: "tool.started", turnId, toolCallId, tool: "generation_deck_review", input: { scope: "all_slides" } });
                let reviewFailed = false;
                const review = await runWithContinuation({ ...adapterInput, turnId: `${turnId}-review`, prompt: `${prompt}\n\n${DECK_REVIEW_PROMPT}\nPreserve all ${expectedSlides} slides and completed content. Replace unfinished placeholders and repair missing local images before returning.`, onEvent: async (event) => {
                  // A failed review belongs to this check, not the enclosing turn: retain it and refuse below.
                  if (event.type === "status.error" || (event.type === "status.idle" && event.stopReason !== "end_turn")) { reviewFailed = true; return; }
                  await adapterInput.onEvent(event);
                } }, (input) => runAdapter(backendId, input), () => generationOutputComplete(stageDir, project.entrypoint, project.type, expectedSlides, sourcePages), { idleMs: 120_000 });
                const reviewed = review.exitCode === 0 && !reviewFailed && !providerReportedFailure;
                await persistAndPublish(sessionId, { id: ulid(), ts: Date.now(), type: "tool.finished", turnId, toolCallId, tool: "generation_deck_review", ok: reviewed });
                if (!reviewed) throw new ArtifactOperationError("turn_failed", "Deck copy review did not complete");
              }
              if (!await generationOutputComplete(stageDir, project.entrypoint, project.type)) throw new ArtifactOperationError("turn_failed", "Generated content is incomplete");
              await ensureThreeSceneRuntime(stageDir);
              await ensureCharts(stageDir);
              if ((await findHtmlEncodingIssues(stageDir, activeTurn.abortController.signal)).length > 0) throw new ArtifactOperationError("publication_failed", "Generated HTML encoding is invalid");
              const canvas = designAuditCanvas(project.type, project.options_json);
              const changedPaths = changedTreePaths(beforeAdapter, await inspectCanonicalTree(stageDir));
              const designReview = await (dependencies.reviewDesign ?? reviewTurnDesign)({
                adapter: adapterInput, projectId: project.id, type: project.type, entrypoint: project.entrypoint,
                revision: project.current_revision + 1, changedPaths, ...(canvas ? { canvas } : {}),
                ...(sessionContext.designSystemPin ? { tokensCss: sessionContext.designSystemPin.tokens } : {}),
                run: (input) => runAdapter(backendId, input),
              });
              // Checks that could not run do not refuse the turn: the review badge and the on-demand
              // Quality audit carry that warning. Only measured, blocking defects do.
              const blocking = designReview.result === null ? [] : blockingDesignFindings(designReview.result, changedPaths);
              if (blocking.length > 0 || providerReportedFailure) throw new DesignReviewError();
              // A repair edits the stage after the completion gate, so repaired output is gated again.
              if ((designReview.repairs > 0 || sourcePages !== undefined) && !await generationOutputComplete(stageDir, project.entrypoint, project.type, sourcePages?.length, sourcePages)) {
                throw new ArtifactOperationError("publication_failed", "Design review left incomplete or remapped output");
              }
              const encodingIssues = await findHtmlEncodingIssues(stageDir, activeTurn.abortController.signal);
              if (encodingIssues.length > 0) throw new ArtifactOperationError("publication_failed", "Generated HTML encoding is invalid");
              if (logoExpectation !== null && logoEvidence !== null) {
                // The expectation was captured before the agent ran and is never recaptured. A
                // repair is therefore judged against the same phase, the same selected candidate
                // and the same candidate hashes as the first attempt: it may correct the document
                // it was refused for and nothing else, and a second pass cannot launder a turn
                // that quietly regenerated an image or rewrote history.
                const gate = async (): Promise<void> => {
                  const info = await lstat(path.join(stageDir, project.entrypoint));
                  if (!info.isFile() || info.nlink !== 1 || info.size > 16 * 1024 * 1024) throw new LogoDeliverableError("guidelines_not_file");
                  await assertLogoDeliverables(stageDir, logoExpectation, logoEvidence.evidence);
                };
                try {
                  try { await gate(); }
                  catch (rejected) {
                    const reason = turnRejectionReason(rejected);
                    // A repair is offered only when the refusal carries a finite violation from
                    // the validator's own list; nothing derived from what the model wrote.
                    const violation = rejected instanceof LogoDeliverableError ? logoSvgViolation(rejected.detail) : null;
                    if (!isRepairableLogoRejection(reason) || violation === null || logoRepairs > 0) throw rejected;
                    logoRepairs += 1;
                    // The stage as the refusal left it. The repair is handed exactly one editable
                    // file, and the deliverable gate cannot see a rewritten guidelines document or
                    // a file left behind beside it, so the repair's own blast radius is measured.
                    const beforeRepair = await inspectCanonicalTree(stageDir);
                    if (!await repairLogoCompletion({ adapter: adapterInput, reason, violation, run: (attempt) => runAdapter(backendId, attempt) })) throw rejected;
                    // Revalidate the whole deliverable rather than the part that was refused.
                    // Immutable references are re-verified by this operation's own `finally`,
                    // which still runs between here and publication.
                    await gate();
                    // A valid vector does not buy a repair the right to change anything else: a
                    // turn that edited outside its one file keeps the refusal that opened the
                    // repair, and the whole operation rolls back with nothing published.
                    const touched = changedTreePaths(beforeRepair, await inspectCanonicalTree(stageDir));
                    if (touched.some((changed) => changed !== LOGO_FILES.logo)) throw rejected;
                    if ((await findHtmlEncodingIssues(stageDir, activeTurn.abortController.signal)).length > 0) throw new ArtifactOperationError("publication_failed", "Generated HTML encoding is invalid");
                  }
                } catch (error) {
                  // The coordinator rethrows a fresh error carrying only the public message, so
                  // the finite reason is recorded here while the domain error is still itself.
                  rejectionReason = turnRejectionReason(error);
                  throw error;
                }
                finalizedLogoSource = logoExpectation.selected?.file ?? null;
              }
            } catch (error) {
              if (!activeTurn.interrupted) throw error;
              // The adapter has settled and stopped its owned writers. Keep its partial
              // work; private-input cleanup and immutable/publication checks still run.
            }
          });
        } finally {
          await verifyImmutableAttachments(immutableSnapshots);
        }
        if (activeTurn.interrupted) {
          if (sourcePages !== undefined) throw new ArtifactOperationError("operation_cancelled", "Interrupted source-mapped output remains unpublished");
          const partial = await inspectCanonicalTree(stageDir);
          if (!manifestEntry(partial, project.entrypoint)) {
            const original = manifestEntry(base, project.entrypoint);
            if (!original) throw new ArtifactOperationError("publication_failed", "Interrupted entrypoint is unavailable");
            const bytes = await readManagedFile(path.join(path.dirname(stageDir), "snapshot"), original);
            const target = resolveWithin(stageDir, ...project.entrypoint.split("/"));
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(target, bytes, { flag: "wx" });
          }
          if ((await findHtmlEncodingIssues(stageDir)).length > 0) throw new ArtifactOperationError("publication_failed", "Interrupted HTML encoding is invalid");
          return;
        }
        await ensureThreeSceneRuntime(stageDir);
        await ensureCharts(stageDir);
        if (graphicEntrypoint !== null && graphicBefore !== null) {
          const info = await lstat(graphicEntrypoint);
          if (!info.isFile() || info.nlink !== 1 || info.size > 16 * 1024 * 1024) throw new Error("graphic_starter_unchanged");
          assertGraphicStarterReplaced(graphicBefore, await readFile(graphicEntrypoint, "utf8"));
        }
      },
    });
    // The operation is terminal here. "committed" means what this turn produced is in the project,
    // whatever happens next, so a later failure must not be reported as a turn that published
    // nothing. The QA barrier below makes exactly that sequence reproducible.
    publishedOperation = operation.status === "committed";
    if (process.env.BG_ARTIFACT_QA === "1" && operationId === process.env.BG_ARTIFACT_TURN_OPERATION_ID && process.env.BG_ARTIFACT_TURN_BARRIER === "after_publish") {
      throw new Error("qa_fault_after_publication");
    }
    if (activeTurn.interrupted) {
      await persistAndPublish(sessionId, { id: ulid(), ts: Date.now(), type: "status.idle", stopReason: "interrupted" });
    } else for (const event of terminalEvents) await persistAndPublish(sessionId, event);
    if (!activeTurn.interrupted && finalizedLogoSource !== null) {
      // Guidelines feed the design system, but they are not the deliverable: a patch that cannot be
      // applied is a warning on the trace, never a failed turn.
      try { await applyLogoDesignSystemPatch({ projectDir, designSystemId: project.design_system_id, expectedSource: finalizedLogoSource }); }
      catch (error) { await appendSessionTrace(sessionId, { level: "logo_design_system_patch_failed", turnId, error: diagnosticError(error) }); }
    }
  } catch (error) {
    if (!operationPrepared) throw error;
    // The operation reached its terminal state without publishing, so nothing this turn produced
    // is in the project. An interrupted turn is the exception: it keeps and publishes its partial
    // stage, so it is not "not applied" and carries no such notice.
    const rejected: { readonly notApplied?: TurnNotApplied; readonly reason?: TurnRejectionReason } = {
      // Only a turn whose operation never committed can say the project is untouched. A step that
      // failed after publication - persisting a terminal event, writing the trace - leaves real
      // work in the project, and claiming otherwise would send the user looking for lost output.
      ...(publishedOperation ? {} : { notApplied: { turnId, operationId, repairs: logoRepairs } }),
      ...(rejectionReason === undefined ? {} : { reason: rejectionReason }),
    };
    if (activeTurn.interrupted || activeTurn.abortController.signal.aborted) {
      if (!(error instanceof ArtifactOperationError && error.code === "operation_cancelled")) {
        await persistAndPublish(sessionId, { id: ulid(), ts: Date.now(), type: "status.error", message: "turn_failed", recoverable: true }, error);
      }
      await persistAndPublish(sessionId, { id: ulid(), ts: Date.now(), type: "status.idle", stopReason: "interrupted" });
    } else if (providerReportedFailure) {
      if (!providerErrorPublished) {
        await persistAndPublish(sessionId, { id: ulid(), ts: Date.now(), type: "status.error", message: "turn_failed", recoverable: true, ...rejected }, error);
      }
      // An unpublished operation never releases a buffered message end or success idle.
      for (const event of terminalEvents) if (publishedOperation || (event.type === "status.idle" && event.stopReason === "error")) await persistAndPublish(sessionId, event);
      if (
        !terminalEvents.some(
          (event) =>
            event.type === "status.idle" && event.stopReason === "error",
        )
      ) {
        await persistAndPublish(sessionId, {
          id: ulid(),
          ts: Date.now(),
          type: "status.idle",
          stopReason: "error",
        });
      }
    } else {
      await persistAndPublish(sessionId, { id: ulid(), ts: Date.now(), type: "status.error", message: "turn_failed", recoverable: true, ...rejected }, error);
      await persistAndPublish(sessionId, { id: ulid(), ts: Date.now(), type: "status.idle", stopReason: "error" });
    }
    await setSessionStatus(sessionId, "idle");
    return;
  } finally {
    await stopPreview?.();
  }

  const postTurnListing = await listDirSafe(projectDir);
  const spawnCwdListing = await listDirSafe(process.cwd());
  console.log(
    "[turn] post-turn project entries=",
    postTurnListing,
  );
  console.log(
    "[turn] post-turn workspace entries=",
    Array.isArray(spawnCwdListing)
      ? spawnCwdListing.filter(
          (name) => name.endsWith(".html") || name.endsWith(".css"),
        )
      : spawnCwdListing,
  );
  await appendSessionTrace(sessionId, {
    level: "post_turn_dir",
    turnId,
    entries: postTurnListing,
  });

  await setSessionStatus(sessionId, "idle");

  const checkpoint = await writeTurnCheckpoint(
    sessionContext.project.project_id,
    turnId,
  );
  await appendSessionTrace(sessionId, {
    level: activeTurn.interrupted ? "turn_interrupted" : "turn_complete",
    turnId,
    checkpoint:
      checkpoint === null
        ? null
        : { turnId: checkpoint.turnId, createdAt: checkpoint.createdAt },
  });
}
