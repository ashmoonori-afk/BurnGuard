import { expect, test } from "bun:test";
import { DECK_STAGE_JS } from "../src/runtime/deck-stage";
import { PDF_PRINT_CSS } from "../src/services/export-pdf-contract";

test.skipIf(process.env.BG_BROWSER_SMOKE !== "1")("Given 29 classless slides, then the runtime shows one full artboard and preserves navigation, insertion and printing", async () => {
  const child = Bun.spawn(["node", "packages/backend/tests/fixtures/deck-stage-browser.mjs"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const deadline = setTimeout(() => child.kill(), 25_000);
  try {
    child.stdin.write(JSON.stringify({ runtime: DECK_STAGE_JS, printCss: PDF_PRINT_CSS }));
    child.stdin.end();
    const [code, output, errors] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(errors).toBe("");
    expect(code).toBe(0);
    expect(JSON.parse(output)).toMatchObject({ slides: 29, visible: 1, navigation: true, insertedSlide: true, printSlides: 30 });
  } finally { clearTimeout(deadline); child.kill(); }
}, 30_000);
