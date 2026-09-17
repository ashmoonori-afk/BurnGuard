import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generationOutputComplete } from "../src/services/generation-output";

test("Given saved output, then completion rejects empty content, unfinished units and missing local imagery", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-output-"));
  const runtime = '<script src="/runtime/deck-stage.js" defer></script>';
  try {
    for (const html of ["", "<style>body{color:red}</style><script>render()</script>", '<section data-bg-unit="1">Pending</section>', '<section data-bg-unit="1" data-bg-complete="true"><div data-bg-placeholder>Pending</div></section>', '<h1>Product</h1><img src="missing.png">', '<h1>Product</h1><div style="background:url(missing.webp)"></div>']) {
      await writeFile(path.join(dir, "index.html"), html);
      expect(await generationOutputComplete(dir, "index.html", "prototype")).toBe(false);
    }
    for (const html of [`<section data-slide>1 / 29</section>${runtime}`, `<section data-slide><aside data-speaker-notes>Hidden copy</aside></section>${runtime}`, `<section data-slide>One<section data-slide>Nested</section></section>${runtime}`, "<section data-slide>Missing runtime</section>"]) {
      await writeFile(path.join(dir, "index.html"), html);
      expect(await generationOutputComplete(dir, "index.html", "slide_deck")).toBe(false);
    }
    await writeFile(path.join(dir, "image.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
    await writeFile(path.join(dir, "index.html"), `<section data-slide data-bg-unit="1" data-bg-complete="true"><h1>Product</h1><img src="image.svg"></section>${runtime}`);
    expect(await generationOutputComplete(dir, "index.html", "slide_deck", 1)).toBe(true);
    expect(await generationOutputComplete(dir, "index.html", "slide_deck", 2)).toBe(false);
    await writeFile(path.join(dir, "index.html"), '<div style="width:100px;height:100px;background-image:url(image.svg)"></div>');
    expect(await generationOutputComplete(dir, "index.html", "graphic")).toBe(true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
