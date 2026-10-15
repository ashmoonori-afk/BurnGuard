import { keepAbortSignalArmed } from "../lib/abort-signal";

/** Phases of one render that can fail or hang after the browser is chosen; `launch` is owned by `launchChromium`. */
export type RenderFailurePhase = "launch" | "load" | "fonts" | "layout" | "raster" | "write";
export type RenderPhaseCode = `render_timeout_${RenderFailurePhase}` | `render_failed_${RenderFailurePhase}`;

/** Bounded per-phase deadlines. `launch` has its own capped attempts in `export-render-session.ts`. */
export const RENDER_PHASE_DEADLINE_MS: Readonly<Record<Exclude<RenderFailurePhase, "launch">, number>> = {
  load: 30_000,
  fonts: 15_000,
  layout: 15_000,
  raster: 60_000,
  write: 15_000,
};

export class RenderPhaseError extends Error {
  readonly name = "RenderPhaseError";
  readonly code: RenderPhaseCode;
  constructor(readonly phase: RenderFailurePhase, readonly kind: "timeout" | "failed", message: string) {
    super(message);
    this.code = `render_${kind}_${phase}`;
  }
}

/** Timer seam so a never-resolving phase is exercised without waiting. */
export type PhaseClock = { readonly schedule: (ms: number, fire: () => void) => () => void };
export const SYSTEM_PHASE_CLOCK: PhaseClock = {
  schedule: (ms, fire) => { const timer = setTimeout(fire, ms); return () => { clearTimeout(timer); }; },
};

/**
 * Runs one render phase under its own deadline. A phase that outlives the deadline rejects with a typed timeout
 * code and aborts the signal handed to the work; a caller abort passes through untouched so cancellation stays
 * cancellation. Any other failure is typed with the phase unless it already carries a domain error.
 */
export async function runRenderPhase<T>(
  phase: Exclude<RenderFailurePhase, "launch">,
  work: (signal: AbortSignal) => Promise<T>,
  options: { readonly signal: AbortSignal; readonly deadlineMs?: number; readonly clock?: PhaseClock },
): Promise<T> {
  keepAbortSignalArmed(options.signal);
  options.signal.throwIfAborted();
  const own = new AbortController();
  const combined = AbortSignal.any([options.signal, own.signal]);
  const clock = options.clock ?? SYSTEM_PHASE_CLOCK;
  let cancelTimer: () => void = () => undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    cancelTimer = clock.schedule(options.deadlineMs ?? RENDER_PHASE_DEADLINE_MS[phase], () => {
      own.abort();
      reject(new RenderPhaseError(phase, "timeout", `Render timed out at phase ${phase}`));
    });
  });
  try {
    return await Promise.race([work(combined), expired]);
  } catch (error) {
    if (error instanceof RenderPhaseError || options.signal.aborted) throw error;
    if (error instanceof Error && typeof Reflect.get(error, "code") === "string") throw error;
    throw new RenderPhaseError(phase, "failed", error instanceof Error ? error.message : String(error));
  } finally {
    cancelTimer();
  }
}
