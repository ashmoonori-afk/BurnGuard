import { describe, expect, test } from "bun:test";
import { SEEDED_PROJECT_HTML } from "../src/db/seeded-project-html";
import projectFixture from "../src/fixtures/projects-list.json";

const fixtures = projectFixture as Array<{
  id: string;
  name: string;
  type: string;
  archived_at: number | null;
}>;

describe("SEEDED_PROJECT_HTML", () => {
  test("covers every non-archived fixture project", () => {
    const expectedIds = fixtures
      .filter((p) => p.archived_at == null)
      .map((p) => p.id);
    for (const id of expectedIds) {
      expect(SEEDED_PROJECT_HTML[id]).toBeString();
      expect(SEEDED_PROJECT_HTML[id].length).toBeGreaterThan(500);
    }
  });

  test("does not waste bytes on archived fixtures", () => {
    // Archived rows are hidden from the user, so seeding an HTML file
    // for them just bloats the binary. The seed loop already skips the
    // file write for archived rows; this guards against future drift.
    const archivedIds = fixtures
      .filter((p) => p.archived_at != null)
      .map((p) => p.id);
    for (const id of archivedIds) {
      expect(SEEDED_PROJECT_HTML[id]).toBeUndefined();
    }
  });

  test("decks reference their bundled runtime for offline audit and export", () => {
    const deckIds = fixtures
      .filter((p) => p.type === "slide_deck" && p.archived_at == null)
      .map((p) => p.id);
    for (const id of deckIds) {
      const html = SEEDED_PROJECT_HTML[id];
      expect(html).toContain('script src="runtime/deck-stage.js"');
      expect(html).toContain("data-slide");
    }
  });

  test("non-deck artifacts do not falsely declare deck structure", () => {
    const nonDeckIds = fixtures
      .filter((p) => p.type !== "slide_deck" && p.archived_at == null)
      .map((p) => p.id);
    for (const id of nonDeckIds) {
      const html = SEEDED_PROJECT_HTML[id];
      expect(html).not.toContain("data-slide");
      expect(html).not.toContain("/runtime/deck-stage.js");
    }
  });

  test("every artifact starts with a doctype and a viewport meta", () => {
    // Both ensure the file actually renders as a webpage rather than as
    // quirks-mode soup, and that mobile preview in canvas behaves.
    for (const html of Object.values(SEEDED_PROJECT_HTML)) {
      expect(html.toLowerCase().startsWith("<!doctype html>")).toBe(true);
      expect(html).toContain('name="viewport"');
    }
  });

  test("every artifact carries a brand statement that it is a sample", () => {
    // The footer line tells future readers — including the agent — that
    // this is bundled placeholder content, not real customer data. The
    // wording can vary but the word "sample" must be present somewhere.
    for (const [id, html] of Object.entries(SEEDED_PROJECT_HTML)) {
      expect(html.toLowerCase()).toContain("sample");
    }
  });
});
