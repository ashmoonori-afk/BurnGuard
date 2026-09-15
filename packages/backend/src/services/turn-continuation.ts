import { watch } from "node:fs";
import type { AdapterRunInput, AdapterRunResult } from "../adapters/types";
import { ulid } from "ulid";

/** Retries stay inside the same unpublished stage and session reservation. */
export async function runWithContinuation(
  input: AdapterRunInput,
  run: (input: AdapterRunInput) => Promise<AdapterRunResult>,
  complete: () => Promise<boolean>,
  limits = { idleMs: 120_000, toolMs: 600_000, attemptMs: 900_000, attempts: 3 },
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
      let idle: ReturnType<typeof setTimeout>;
      const pending = new Set<string>();
      const touch = () => { clearTimeout(idle); idle = setTimeout(() => controller.abort(), pending.size ? limits.toolMs : limits.idleMs); };
      const watcher = watch(input.projectDir, { recursive: true }, touch);
      const deadline = setTimeout(() => controller.abort(), limits.attemptMs);
      watcher.on("error", () => controller.abort());
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
            if (event.type !== "chat.thinking" && event.type !== "status.running") touch();
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
        clearTimeout(idle!); clearTimeout(deadline); watcher.close();
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
      await input.onEvent({ id: ulid(), ts: Date.now(), type: "tool.started", turnId: input.turnId, toolCallId: recovery.id, tool: recovery.tool, input: { attempt: attempt + 2, maximum: limits.attempts } });
    }
    return { exitCode: 1 };
  } finally { await emitRecovery(false); }
}
