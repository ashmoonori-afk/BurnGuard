import { watch } from "node:fs";
import type { AdapterRunInput, AdapterRunResult } from "../adapters/types";
import { ulid } from "ulid";

/** Schedules `handler` after `ms` and returns its cancel function; injected so tests drive deadlines by signal instead of elapsed time. */
export type ContinuationTimer = (handler: () => void, ms: number) => () => void;

const realTimer: ContinuationTimer = (handler, ms) => {
  const timer = setTimeout(handler, ms);
  return () => clearTimeout(timer);
};

/** Why an attempt was stopped. A closed vocabulary, so it is safe to publish: never provider text, a path or a credential. */
export type ContinuationStopReason = "inactivity" | "attempt_deadline" | "workspace_unwatchable" | "incomplete_output";

/**
 * Distinguishes work that is getting somewhere from a status heartbeat.
 *
 * Providers repeat a reasoning summary while a single long call is in flight, so the text alone
 * cannot prove activity; only reasoning that has not been seen in this attempt refreshes the
 * inactivity budget. The window is bounded so a long turn cannot grow this set without limit.
 */
function activityProgress(): (text: string) => boolean {
  const seen = new Set<string>();
  return (text) => {
    const value = text.trim();
    if (value.length === 0) return false;
    const signature = `${value.length}:${value.slice(-256)}`;
    if (seen.has(signature)) return false;
    if (seen.size >= 64) for (const oldest of seen) { seen.delete(oldest); break; }
    seen.add(signature);
    return true;
  };
}

/** Retries stay inside the same unpublished stage and session reservation. */
export async function runWithContinuation(
  input: AdapterRunInput,
  run: (input: AdapterRunInput) => Promise<AdapterRunResult>,
  complete: () => Promise<boolean>,
  limits = { idleMs: 120_000, toolMs: 600_000, attemptMs: 900_000, attempts: 3 },
  schedule: ContinuationTimer = realTimer,
): Promise<AdapterRunResult> {
  let recovery: { id: string; tool: string } | undefined;
  const emitRecovery = async (ok: boolean) => {
    if (recovery) await input.onEvent({ id: ulid(), ts: Date.now(), type: "tool.finished", turnId: input.turnId, toolCallId: recovery.id, tool: recovery.tool, ok });
    recovery = undefined;
  };
  try {
    for (let attempt = 0; attempt < limits.attempts; attempt++) {
      input.signal?.throwIfAborted();
      const controller = new AbortController();
      const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
      let cancelIdle = () => {};
      let stopped: ContinuationStopReason | undefined;
      const stop = (reason: ContinuationStopReason) => { stopped ??= reason; controller.abort(); };
      const pending = new Set<string>();
      const touch = () => { cancelIdle(); cancelIdle = schedule(() => stop("inactivity"), pending.size ? limits.toolMs : limits.idleMs); };
      const progressed = activityProgress();
      const watcher = watch(input.projectDir, { recursive: true }, touch);
      const cancelDeadline = schedule(() => stop("attempt_deadline"), limits.attemptMs);
      watcher.on("error", () => stop("workspace_unwatchable"));
      let failed = false;
      let needsAction = false;
      const terminal: Parameters<AdapterRunInput["onEvent"]>[0][] = [];
      let result: AdapterRunResult;
      touch();
      try {
        result = await run({ ...input, signal,
          prompt: attempt === 0 ? input.prompt : `${input.prompt}\n\n<resume_incomplete_work>\nThe previous attempt did not finish. Continue the same requested deliverable in this directory. Inspect and reuse existing assets; do not regenerate completed images. Restore a missing entrypoint. Write a small valid file first, then extend it in small patches. Never delete and add the same path in one patch, and never delete the entrypoint before preparing its replacement. Verify the saved result before reporting completion.\n</resume_incomplete_work>`,
          onEvent: async (event) => {
            if (event.type === "tool.started") pending.add(event.toolCallId);
            if (event.type === "tool.finished") pending.delete(event.toolCallId);
            if (event.type === "tool.permission_required") needsAction = true;
            // A bare running ping proves nothing, and repeated reasoning is the same ping with text
            // attached; only output, tool and file activity or reasoning that advances is progress.
            if (event.type === "chat.thinking" ? progressed(event.text) : event.type !== "status.running") touch();
            if (event.type === "status.error") { failed = true; needsAction ||= !event.recoverable || (event.code !== undefined && event.code !== "turn_failed"); }
            if (event.type === "status.idle") {
              failed ||= event.stopReason === "error" || event.stopReason === "interrupted";
              needsAction ||= event.stopReason === "requires_action";
            }
            if (event.type === "status.idle" || event.type === "chat.message_end" || event.type === "status.error") terminal.push(event);
            else await input.onEvent(event);
          },
        });
      } catch (error) {
        input.signal?.throwIfAborted();
        // Only owned timeout cancellation is retryable here; permission,
        // filesystem and other unexpected exceptions must retain their authority.
        if (!controller.signal.aborted) throw error;
        result = { exitCode: 1 };
      } finally {
        cancelIdle(); cancelDeadline(); watcher.close();
      }
      input.signal?.throwIfAborted();
      const success = result.exitCode === 0 && !failed && !controller.signal.aborted && await complete();
      if (success || needsAction) {
        await emitRecovery(success);
        for (const event of terminal) await input.onEvent(event);
        return success ? result : { exitCode: 1 };
      }
      await emitRecovery(false);
      if (attempt + 1 === limits.attempts) {
        await input.onEvent({ id: ulid(), ts: Date.now(), type: "status.error", code: "turn_failed", message: "turn_failed", recoverable: true });
        return { exitCode: 1 };
      }
      recovery = { id: ulid(), tool: controller.signal.aborted ? "generation_resume_stalled" : "generation_resume_incomplete" };
      await input.onEvent({ id: ulid(), ts: Date.now(), type: "tool.started", turnId: input.turnId, toolCallId: recovery.id, tool: recovery.tool, input: { attempt: attempt + 2, maximum: limits.attempts, reason: stopped ?? "incomplete_output" } });
    }
    return { exitCode: 1 };
  } finally { await emitRecovery(false); }
}
