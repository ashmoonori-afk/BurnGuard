import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { resolveStaticClosure } from "../src/services/export-closure";
import { parseCssSource } from "../src/services/extraction-css-parser";

// A `sourceMappingURL` comment must never make the CSS parser open a file on
// the host: untrusted CSS arrives from websites, cloned repositories, uploads,
// and generated artifacts. The sentinel is deliberately not JSON so a parser
// that follows the annotation fails loudly instead of silently succeeding.
const SENTINEL = "BG_SOURCE_MAP_SENTINEL not json";

describe("css source map boundary", () => {
  test("Given CSS annotated with a same-directory .map When the extraction parser runs Then declarations are returned and the map is never consulted", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-css-map-"));
    try {
      await writeFile(path.join(root, "evil.map"), SENTINEL, "utf8");
      const content = "a{color:red}\n/*# sourceMappingURL=evil.map */";
      for (const annotation of [content, content.replace("evil.map", path.join(root, "evil.map"))]) {
        const result = await parseCssSource({ content: annotation, sourceId: path.join(root, "input.css") });
        expect(result.issues).toEqual([]);
        expect(result.declarations.map((declaration) => [declaration.property, declaration.value])).toEqual([["color", "red"]]);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("Given a project stylesheet annotated with a sibling .map When the export closure resolves from that directory Then the closure succeeds without reading the map", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-export-css-map-"));
    const previousCwd = process.cwd();
    try {
      await mkdir(path.join(root, "styles"));
      await writeFile(path.join(root, "index.html"), '<html><body><link rel="stylesheet" href="styles/main.css"></body></html>', "utf8");
      await writeFile(path.join(root, "styles/main.css"), "body{color:#123}\n/*# sourceMappingURL=main.css.map */", "utf8");
      await writeFile(path.join(root, "styles/main.css.map"), SENTINEL, "utf8");
      // The closure parses with `from: <relative path>`; resolving that path
      // against the project directory is the realistic export working directory.
      process.chdir(root);
      const closure = await resolveStaticClosure(root, "index.html", await inspectCanonicalTree(root));
      expect(closure.referenced_paths).toEqual(["styles/main.css"]);
    } finally {
      process.chdir(previousCwd);
      await rm(root, { recursive: true, force: true });
    }
  });
});
