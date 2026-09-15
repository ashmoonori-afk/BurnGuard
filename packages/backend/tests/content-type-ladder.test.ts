import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CONTENT_TYPE_FLOOR_PX, contentTypeStepsFor, extractDesignSystemSurface } from "@bg/shared";
import { bundledDesignSystems } from "../src/data/bundled-design-systems";
import { resolveRepoRoot } from "../src/lib/paths";

/** Short sides the product actually ships, from banner sets up to a card-news frame. */
const FRAMES = [
  { name: "leaderboard 970x250", short: 250 },
  { name: "kakao bizboard 1029x258", short: 258 },
  { name: "wide banner 1200x300", short: 300 },
  { name: "naver mobile DA 1250x560", short: 560 },
  { name: "card news 1080x1350", short: 1080 },
  { name: "story 1080x1920", short: 1080 },
] as const;

async function contentTokens(slug: string): Promise<Record<string, number>> {
  const css = await readFile(path.join(resolveRepoRoot(), "design system themes", slug, "surfaces", "content.css"), "utf8");
  const tokens = extractDesignSystemSurface(css, "", "content").tokens;
  return Object.fromEntries(Object.entries(tokens).map(([name, value]) => [name, Number.parseFloat(value)]));
}

/**
 * The content type ramp is authored at a 1080px base and scaled by the frame's shorter side, with a
 * 12px readability floor. On a banner the floor bites: body and caption both land on exactly 12px, so
 * a contract that promises four steps silently delivers three. The right move on a small frame is
 * fewer steps, not smaller ones, so the ladder drops a step instead of duplicating one.
 */
describe("Content type ladder", () => {
  test("Given any shipped frame, then every step the ladder prescribes is a distinct size", async () => {
    const collapsed: string[] = [];
    for (const { slug } of bundledDesignSystems) {
      const tokens = await contentTokens(slug);
      const base = tokens["--content-base"]!;
      for (const frame of FRAMES) {
        const scale = frame.short / base;
        const sizes = contentTypeStepsFor(frame.short, base).map((step) =>
          Math.max(CONTENT_TYPE_FLOOR_PX, tokens[`--content-type-${step}`]! * scale).toFixed(2),
        );
        if (new Set(sizes).size !== sizes.length) collapsed.push(`${slug} @ ${frame.name}: ${sizes.join("/")}`);
      }
    }
    expect({ collapsed: collapsed.length, examples: collapsed.slice(0, 3) }).toEqual({ collapsed: 0, examples: [] });
  });

  test("Given the measured thresholds, then the ladder drops steps exactly where the floor bites", () => {
    // Derived from every shipped theme: four steps stay distinct at 433px, three at 250px, two at 116px.
    expect(contentTypeStepsFor(1080, 1080)).toEqual(["hero", "sub", "body", "caption"]);
    expect(contentTypeStepsFor(560, 1080)).toEqual(["hero", "sub", "body", "caption"]);
    expect(contentTypeStepsFor(300, 1080)).toEqual(["hero", "sub", "caption"]);
    expect(contentTypeStepsFor(258, 1080)).toEqual(["hero", "sub", "caption"]);
    expect(contentTypeStepsFor(120, 1080)).toEqual(["hero", "caption"]);
    // The ladder is expressed against the authored base, so a theme with a different base scales with it.
    expect(contentTypeStepsFor(600, 2160)).toEqual(["hero", "sub", "caption"]);
  });

  test("Given the shipped requirement, then it names the ladder rather than leaving the floor to silently flatten steps", async () => {
    const source = await readFile(
      path.join(resolveRepoRoot(), "packages", "backend", "src", "harness", "prompt-design-system.ts"),
      "utf8",
    );
    // Machine-consumed values, not prose: the thresholds the ladder actually switches on.
    expect(source).toContain("440");
    expect(source).toContain("250");
    // A token the generator writes into 47 systems and the prompt ships must have a stated job; the
    // wildcard families (--content-type-*, --slide-type-*) are covered by their own clauses, but
    // --content-columns had none, so it rode into every graphic prompt meaning nothing.
    expect(source, "--content-columns needs a stated use").toContain("--content-columns");
  });
});
