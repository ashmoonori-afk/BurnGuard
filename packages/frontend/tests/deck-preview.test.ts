import { expect, test } from "bun:test";
import { buildSandboxedArtifactSrcDoc } from "../src/components/canvas/frame-bridge";

const html = `<!doctype html><html><head><style>
body{margin:0}.deck-slide{width:1920px;height:1080px;background:#fff}
[data-slide]:not([data-active]){display:none}
.placeholder{width:2400px;height:1400px;background:#ddd}
</style></head><body>
<section class="deck-slide" data-slide data-active><div class="placeholder" data-bg-node-id="placeholder">1 / 2</div></section>
<section class="deck-slide" data-slide><h1 data-bg-node-id="heading">Finished content</h1></section>
</body></html>`;

test.skipIf(process.env.BG_BROWSER_SMOKE !== "1")("Given oversized slides and placeholders, then sandbox preview fits every frame size and preserves hit coordinates", async () => {
  const child = Bun.spawn(["node", "packages/frontend/tests/fixtures/deck-preview-browser.mjs"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const deadline = setTimeout(() => child.kill(), 25_000);
  try {
    child.stdin.write(JSON.stringify({ html: buildSandboxedArtifactSrcDoc(html, "http://localhost/deck.html") }));
    child.stdin.end();
    const [code, output, errors] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(errors).toBe("");
    expect(code).toBe(0);
    expect(JSON.parse(output)).toEqual({ fit: true, resize: true, switch: true, growth: true, hit: true });
  } finally { clearTimeout(deadline); child.kill(); }
}, 30_000);
