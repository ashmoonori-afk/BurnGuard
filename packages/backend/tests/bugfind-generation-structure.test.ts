import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { summarizeDeckHtml } from "../src/harness/structure-extractor";

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const temps: string[] = [];
afterEach(async () => { for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function deckFile(html: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-bugfind-gen-deck-"));
  temps.push(dir);
  const file = path.join(dir, "deck.html");
  await writeFile(file, html, "utf8");
  return file;
}

describe("bugfind generation: deck structure summary", () => {
  test("Given a slide heading with an emoji at the snippet cut, When the deck is summarised for the prompt, Then the summary holds no lone UTF-16 surrogate", async () => {
    const heading = `${"a".repeat(56)}\u{1F680} launch plan for the quarter`;
    const summary = await summarizeDeckHtml(await deckFile(`<html><body><section data-slide><h1>${heading}</h1></section></body></html>`));
    expect(summary).not.toBeNull();
    expect(LONE_SURROGATE.test(summary!)).toBe(false);
  });

  test("Given a Korean deck, When the deck is summarised, Then the header's B figure is the file's UTF-8 byte size", async () => {
    const html = `<html><body><section data-slide><h1>분기 실적 보고</h1><p>매출과 영업이익 요약</p></section></body></html>`;
    const summary = await summarizeDeckHtml(await deckFile(html));
    const reported = /^deck\.html \u2014 ([\d,]+)B,/u.exec(summary ?? "")?.[1]?.replace(/,/g, "");
    expect(Number(reported)).toBe(Buffer.byteLength(html, "utf8"));
  });
});
