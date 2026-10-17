import { describe, expect, test } from "bun:test";
import { RenderPhaseError, runRenderPhase, type PhaseClock } from "../src/services/export-render-phase";

/** A clock whose deadline fires only when the test says so, so nothing waits on real time. */
function manualClock(): { readonly clock: PhaseClock; readonly fire: () => void; readonly scheduled: () => number | null; readonly cancelled: () => boolean } {
  let fire: (() => void) | null = null; let ms: number | null = null; let cancelled = false;
  return {
    clock: { schedule: (delay, callback) => { ms = delay; fire = callback; return () => { cancelled = true; }; } },
    fire: () => { fire?.(); },
    scheduled: () => ms,
    cancelled: () => cancelled,
  };
}

describe("render phase deadline", () => {
  for (const phase of ["load", "fonts", "layout", "raster", "write"] as const) {
    test(`Given a ${phase} phase that never resolves, When its deadline fires, Then it rejects with the typed timeout code and aborts the work`, async () => {
      const manual = manualClock();
      let workSignal: AbortSignal | null = null;
      const pending = runRenderPhase(phase, (signal) => { workSignal = signal; return new Promise<never>(() => undefined); }, { signal: new AbortController().signal, deadlineMs: 5, clock: manual.clock });
      const settled = pending.then(() => null, (error: unknown) => error);
      manual.fire();
      const error = await settled;
      expect(error).toBeInstanceOf(RenderPhaseError);
      expect(error).toMatchObject({ code: `render_timeout_${phase}`, phase, kind: "timeout" });
      expect(manual.scheduled()).toBe(5);
      expect(workSignal).not.toBeNull();
      expect((workSignal as AbortSignal | null)?.aborted).toBe(true);
    });
  }

  test("Given a phase that finishes in time, When it resolves, Then the value is returned and the timer is cancelled", async () => {
    const manual = manualClock();
    await expect(runRenderPhase("layout", async () => 42, { signal: new AbortController().signal, clock: manual.clock })).resolves.toBe(42);
    expect(manual.cancelled()).toBe(true);
  });

  test("Given a phase that throws a plain error, When it fails, Then the failure is typed with that phase", async () => {
    const manual = manualClock();
    const error = await runRenderPhase("raster", async () => { throw new Error("browser crashed"); }, { signal: new AbortController().signal, clock: manual.clock }).then(() => null, (reason: unknown) => reason);
    expect(error).toMatchObject({ code: "render_failed_raster", phase: "raster", kind: "failed" });
  });

  test("Given the caller cancels during a phase, When the work rejects, Then cancellation is not retyped as a phase failure", async () => {
    const manual = manualClock();
    const controller = new AbortController();
    const cause = new DOMException("cancelled", "AbortError");
    const pending = runRenderPhase("fonts", (signal) => new Promise<never>((_resolve, reject) => { signal.addEventListener("abort", () => { reject(cause); }, { once: true }); }), { signal: controller.signal, clock: manual.clock });
    const settled = pending.then(() => null, (reason: unknown) => reason);
    controller.abort();
    expect(await settled).toBe(cause);
  });

  test("Given an already cancelled signal, When a phase starts, Then it never runs the work", async () => {
    const controller = new AbortController(); controller.abort();
    let ran = false;
    const error = await runRenderPhase("write", async () => { ran = true; }, { signal: controller.signal, clock: manualClock().clock }).then(() => null, (reason: unknown) => reason);
    expect(ran).toBe(false);
    expect(error).not.toBeInstanceOf(RenderPhaseError);
  });
});
