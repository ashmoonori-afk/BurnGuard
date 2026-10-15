import type { Browser } from "playwright-core";
import { launchChromium } from "../../src/services/export-render-session";

/**
 * Launches a test browser under a deadline that bounds the launch only. launchChromium ties its signal to the
 * browser connection (an abort closes the Node bridge connection), so an AbortSignal.timeout() handed to it also
 * ends the browser's life: when a slow launch plus the tests outlast the timer, every later call fails with
 * "Chromium connection aborted" (Windows x64 CI, 2026-10-15). The deadline here is cleared once the browser is up.
 */
export async function launchTestChromium(deadlineMs: number): Promise<Browser> {
  const launch = new AbortController();
  const deadline = setTimeout(() => { launch.abort(new Error(`Chromium did not launch within ${deadlineMs}ms`)); }, deadlineMs);
  try { return await launchChromium(launch.signal); } finally { clearTimeout(deadline); }
}
