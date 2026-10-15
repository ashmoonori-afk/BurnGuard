import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RENDER_PHASE_DEADLINE_MS, RenderPhaseError, type PhaseClock } from "../src/services/export-render-phase";
import { renderToPng } from "../src/services/export-png";
import { RenderSessionError } from "../src/services/export-render-session";

/** Fires the fonts deadline as soon as that phase starts; every other phase keeps a deadline that never fires. */
const fontsDeadlineFires: PhaseClock = {
  schedule: (ms, fire) => {
    if (ms === RENDER_PHASE_DEADLINE_MS.fonts) queueMicrotask(fire);
    return () => undefined;
  },
};
// document.fonts.ready never settles, so only the injected deadline can end the fonts phase.
const HANGING_FONTS = `<!doctype html><html><head><script>Object.defineProperty(document.fonts,"ready",{get:()=>new Promise(()=>{})})</script></head><body><h1>Synthetic</h1></body></html>`;

let root: string;
beforeAll(async () => { root = await mkdtemp(path.join(tmpdir(), "bg-phase-")); await writeFile(path.join(root, "index.html"), HANGING_FONTS); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

const pngInput = (signal: AbortSignal, phaseClock?: PhaseClock) => ({ stagedDir: root, entrypoint: "index.html", outputPath: path.join(root, "out.png"), width: 320, height: 200, dpr: 1 as const, deck: false, signal, ...(phaseClock === undefined ? {} : { phaseClock }) });

describe("render phase codes reach non-PDF callers", () => {
  test("Given a PNG export whose fonts phase never settles, When its deadline fires, Then the typed phase code surfaces with fixed copy", async () => {
    const error = await renderToPng(pngInput(new AbortController().signal, fontsDeadlineFires)).then(() => null, (reason: unknown) => reason);
    expect(error).toBeInstanceOf(RenderSessionError);
    expect(error).toMatchObject({ code: "render_timeout_fonts" });
    expect((error as RenderSessionError).message).toBe(new RenderPhaseError("fonts", "timeout").message);
  }, 90_000);

  test("Given a PNG export that is already cancelled, When it starts, Then cancellation stays render_aborted", async () => {
    const controller = new AbortController(); controller.abort();
    const error = await renderToPng(pngInput(controller.signal, fontsDeadlineFires)).then(() => null, (reason: unknown) => reason);
    expect(error).toMatchObject({ code: "render_aborted" });
  }, 90_000);
});

describe("render phase failures never carry the browser message", () => {
  test("Given a phase that throws a message with a private path, When it is retyped, Then the message is fixed copy and the cause is kept aside", () => {
    const cause = new Error("page.evaluate: crashed at /Users/someone/private/file.html");
    const error = new RenderPhaseError("layout", "failed", cause);
    expect(error.message).not.toContain("/Users");
    expect(error.code).toBe("render_failed_layout");
    expect(error.cause).toBe(cause);
  });
});
