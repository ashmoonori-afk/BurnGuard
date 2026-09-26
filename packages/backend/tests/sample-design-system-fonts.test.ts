import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveRepoRoot } from "../src/lib/paths";

const SAMPLE = path.join(resolveRepoRoot(), "design system sample");

/** Local files each @font-face family in fonts.css points at. */
function localFaces(css: string): ReadonlyMap<string, readonly string[]> {
  const faces = new Map<string, string[]>();
  for (const [, block] of css.matchAll(/@font-face\s*\{([^}]*)\}/gu)) {
    const family = /font-family:\s*'([^']+)'/u.exec(block!)?.[1];
    const files = [...block!.matchAll(/url\('\.\/([^']+)'\)/gu)].map((match) => match[1]!);
    if (family !== undefined) faces.set(family, [...(faces.get(family) ?? []), ...files]);
  }
  return faces;
}

test("Given the sample fonts stylesheet When scanned Then it references no remote font and every token's first family is a local face whose file exists", async () => {
  const css = await readFile(path.join(SAMPLE, "fonts", "fonts.css"), "utf8");
  const tokens = await readFile(path.join(SAMPLE, "colors_and_type.css"), "utf8");

  expect(css).not.toMatch(/https?:\/\//u);
  expect(css).not.toMatch(/@import/u);
  const faces = localFaces(css);
  const families = [...tokens.matchAll(/--font-[\w-]+:\s*'([^']+)'/gu)].map((match) => match[1]!);
  expect(families).toContain("IBM Plex Mono");
  for (const family of families) {
    const files = faces.get(family);
    expect(files, family).toBeDefined();
    expect(files!.length, family).toBeGreaterThan(0);
    for (const file of files!) expect(existsSync(path.join(SAMPLE, "fonts", file)), `${family} -> ${file}`).toBe(true);
  }
  expect(existsSync(path.join(SAMPLE, "fonts", "IBMPlexMono-OFL.txt"))).toBe(true);
});
