import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LOGO_SOURCE_ATTRIBUTE, type LogoActionV1, type LogoManifestV1 } from "@bg/shared";
import {
  assertLogoDeliverables,
  LogoDeliverableError,
  MAX_GUIDELINE_PAGES,
  REQUIRED_GUIDELINE_PAGES,
  readLogoManifest,
  validateLogoSvg,
} from "../src/services/logo-deliverables";
import { LOGO_PAGE } from "@bg/shared";
import { pdfRasterBudgetFitsPages } from "../src/services/export-pdf-contract";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x0d]);
const STARTER = [
  "<!doctype html><html><body>",
  '<section data-graphic-artboard id="frame-1-logo-brief" style="width:1920px;height:1080px">',
  '<h1 data-bg-node-id="logo-brief">누림</h1>',
  "<p>Four logo candidates will appear here after the first turn.</p>",
  "</section></body></html>",
].join("");

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function stage(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "burnguard-logo-deliverables-"));
  directories.push(directory);
  return directory;
}

function manifestOf(rounds: number, selected: LogoManifestV1["selected"] = null): LogoManifestV1 {
  return {
    schema_version: 1,
    rounds: Array.from({ length: rounds }, (_, index) => ({
      round: index + 1,
      candidates: Array.from({ length: 4 }, (_, position) => ({
        id: `candidate-${position + 1}`,
        file: `explorations/round-${index + 1}/candidate-${position + 1}.png`,
        logo_type: "combination" as const,
        prompt: "flat vector mark on a plain ground",
        rationale: "balanced counterform",
      })),
    })),
    selected,
  };
}

async function writeManifest(dir: string, value: unknown): Promise<void> {
  await mkdir(path.join(dir, "explorations"), { recursive: true });
  await writeFile(
    path.join(dir, "explorations", "manifest.json"),
    typeof value === "string" ? value : JSON.stringify(value),
  );
}

async function writeCandidates(
  dir: string,
  round: number,
  overrides: Readonly<Record<string, Buffer | null>> = {},
): Promise<void> {
  const roundDir = path.join(dir, "explorations", `round-${round}`);
  await mkdir(roundDir, { recursive: true });
  for (let index = 1; index <= 4; index += 1) {
    const id = `candidate-${index}`;
    const bytes = id in overrides ? overrides[id] : PNG_BYTES;
    if (bytes === null || bytes === undefined) continue;
    await writeFile(path.join(roundDir, `${id}.png`), bytes);
  }
}

function guidelines(pages: number): string {
  const sections = Array.from(
    { length: pages },
    (_, index) => `<section data-graphic-artboard id="page-${index + 1}" style="width:1920px;height:1080px"><h1>Page ${index + 1}</h1></section>`,
  ).join("");
  return `<!doctype html><html lang="ko"><body>${sections}</body></html>`;
}

function logoSvg(source: string, body = '<path d="M0 0H512V512H0Z"/>', attributes = 'viewBox="0 0 512 512"'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" ${attributes} ${LOGO_SOURCE_ATTRIBUTE}="${source}">${body}</svg>`;
}

function svgDetail(text: string): string {
  try {
    validateLogoSvg(text);
  } catch (error) {
    if (error instanceof LogoDeliverableError) return error.detail;
    throw error;
  }
  return "ok";
}

async function exploreStage(options: { readonly rounds?: number; readonly pages?: number } = {}): Promise<string> {
  const dir = await stage();
  const rounds = options.rounds ?? 2;
  await writeManifest(dir, manifestOf(rounds));
  for (let round = 1; round <= rounds; round += 1) await writeCandidates(dir, round);
  await writeFile(path.join(dir, "index.html"), guidelines(options.pages ?? 1));
  return dir;
}

const selection: LogoActionV1 = { action: "select", round: 1, candidate_id: "candidate-2" };

async function finalizeStage(options: {
  readonly svg?: string | null;
  readonly pages?: number;
  readonly selected?: LogoManifestV1["selected"];
} = {}): Promise<string> {
  const dir = await stage();
  const selected = options.selected === undefined ? { round: 1, candidate_id: "candidate-2" } : options.selected;
  await writeManifest(dir, manifestOf(1, selected));
  await writeCandidates(dir, 1);
  await writeFile(path.join(dir, "index.html"), guidelines(options.pages ?? 8));
  const svg = options.svg === undefined ? logoSvg("explorations/round-1/candidate-2.png") : options.svg;
  if (svg !== null) await writeFile(path.join(dir, "logo.svg"), svg);
  return dir;
}

describe("logo manifest reader", () => {
  test("Given no manifest When read Then null is returned", async () => {
    expect(await readLogoManifest(await stage())).toBeNull();
  });

  test("Given a manifest When read Then it is parsed", async () => {
    const dir = await stage();
    await writeManifest(dir, manifestOf(1));
    expect(await readLogoManifest(dir)).toEqual(manifestOf(1));
  });

  test("Given unparseable JSON When read Then a typed deliverable error is thrown", async () => {
    const dir = await stage();
    await writeManifest(dir, "{ not json");
    await expect(readLogoManifest(dir)).rejects.toMatchObject({
      code: "logo_deliverables_missing",
      detail: "manifest_invalid:json",
    });
  });

  test("Given a manifest that breaks the contract When read Then the field path is reported", async () => {
    const dir = await stage();
    await writeManifest(dir, { schema_version: 1, rounds: [{ round: 1, candidates: [] }], selected: null });
    await expect(readLogoManifest(dir)).rejects.toMatchObject({
      code: "logo_deliverables_missing",
      detail: "manifest_invalid:rounds.0.candidates",
    });
  });
});

describe("logo explore deliverables", () => {
  test("Given a complete explore round When asserted Then it passes", async () => {
    const dir = await exploreStage();
    await expect(assertLogoDeliverables(dir, "explore", null, STARTER)).resolves.toBeUndefined();
  });

  test("Given no manifest When asserted Then the turn is refused", async () => {
    const dir = await stage();
    await writeFile(path.join(dir, "index.html"), guidelines(1));
    await expect(assertLogoDeliverables(dir, "explore", null, STARTER)).rejects.toMatchObject({
      code: "logo_deliverables_missing",
      detail: "manifest_missing",
    });
  });

  test("Given the last round missing a candidate file When asserted Then that candidate is named", async () => {
    const dir = await stage();
    await writeManifest(dir, manifestOf(2));
    await writeCandidates(dir, 1);
    await writeCandidates(dir, 2, { "candidate-3": null });
    await writeFile(path.join(dir, "index.html"), guidelines(1));
    await expect(assertLogoDeliverables(dir, "explore", null, STARTER)).rejects.toMatchObject({
      code: "logo_deliverables_missing",
      detail: "candidate_missing:candidate-3",
    });
  });

  test("Given an earlier round is incomplete When asserted Then only the last round is gated", async () => {
    const dir = await stage();
    await writeManifest(dir, manifestOf(2));
    await writeCandidates(dir, 1, { "candidate-1": null });
    await writeCandidates(dir, 2);
    await writeFile(path.join(dir, "index.html"), guidelines(1));
    await expect(assertLogoDeliverables(dir, "explore", null, STARTER)).resolves.toBeUndefined();
  });

  test("Given an empty candidate file When asserted Then it is refused", async () => {
    const dir = await stage();
    await writeManifest(dir, manifestOf(1));
    await writeCandidates(dir, 1, { "candidate-2": Buffer.alloc(0) });
    await writeFile(path.join(dir, "index.html"), guidelines(1));
    await expect(assertLogoDeliverables(dir, "explore", null, STARTER)).rejects.toMatchObject({
      code: "logo_deliverables_missing",
      detail: "candidate_empty:candidate-2",
    });
  });

  test("Given a candidate that is not a PNG When asserted Then the magic bytes refuse it", async () => {
    const dir = await stage();
    await writeManifest(dir, manifestOf(1));
    await writeCandidates(dir, 1, { "candidate-1": Buffer.from("<svg xmlns='x'/>", "utf8") });
    await writeFile(path.join(dir, "index.html"), guidelines(1));
    await expect(assertLogoDeliverables(dir, "explore", null, STARTER)).rejects.toMatchObject({
      code: "logo_deliverables_missing",
      detail: "candidate_not_png:candidate-1",
    });
  });

  test("Given a directory in place of a candidate file When asserted Then it is refused", async () => {
    const dir = await stage();
    await writeManifest(dir, manifestOf(1));
    await writeCandidates(dir, 1, { "candidate-4": null });
    await mkdir(path.join(dir, "explorations", "round-1", "candidate-4.png"), { recursive: true });
    await writeFile(path.join(dir, "index.html"), guidelines(1));
    await expect(assertLogoDeliverables(dir, "explore", null, STARTER)).rejects.toMatchObject({
      code: "logo_deliverables_missing",
      detail: "candidate_not_file:candidate-4",
    });
  });

  test("Given no guidelines entrypoint When asserted Then it is refused", async () => {
    const dir = await stage();
    await writeManifest(dir, manifestOf(1));
    await writeCandidates(dir, 1);
    await expect(assertLogoDeliverables(dir, "explore", null, STARTER)).rejects.toMatchObject({
      code: "logo_deliverables_missing",
      detail: "guidelines_missing",
    });
  });

  test("Given an untouched starter When asserted Then the no-op turn is refused", async () => {
    const dir = await stage();
    await writeManifest(dir, manifestOf(1));
    await writeCandidates(dir, 1);
    await writeFile(path.join(dir, "index.html"), STARTER);
    await expect(assertLogoDeliverables(dir, "explore", null, STARTER)).rejects.toMatchObject({
      code: "logo_deliverables_missing",
      detail: "starter_unchanged",
    });
  });
});

describe("logo finalize deliverables", () => {
  test("Given a complete finalize turn When asserted Then it passes", async () => {
    const dir = await finalizeStage();
    await expect(assertLogoDeliverables(dir, "finalize", selection)).resolves.toBeUndefined();
  });

  test("Given no select action When asserted Then the selection is required", async () => {
    const dir = await finalizeStage();
    await expect(assertLogoDeliverables(dir, "finalize", null)).rejects.toMatchObject({
      code: "logo_deliverables_missing",
      detail: "selection_missing",
    });
    await expect(assertLogoDeliverables(dir, "finalize", { action: "regenerate" })).rejects.toMatchObject({
      code: "logo_deliverables_missing",
      detail: "selection_missing",
    });
  });

  test("Given a selection the manifest does not contain When asserted Then it is refused", async () => {
    const dir = await finalizeStage();
    await expect(assertLogoDeliverables(dir, "finalize", { action: "select", round: 2, candidate_id: "candidate-1" })).rejects.toMatchObject({
      code: "logo_deliverables_missing",
      detail: "selection_unknown",
    });
  });

  test("Given the manifest did not record the selection When asserted Then it is refused", async () => {
    const unrecorded = await finalizeStage({ selected: null });
    await expect(assertLogoDeliverables(unrecorded, "finalize", selection)).rejects.toMatchObject({
      code: "logo_deliverables_missing",
      detail: "selection_not_recorded",
    });
    const mismatched = await finalizeStage({ selected: { round: 1, candidate_id: "candidate-4" } });
    await expect(assertLogoDeliverables(mismatched, "finalize", selection)).rejects.toMatchObject({
      code: "logo_deliverables_missing",
      detail: "selection_not_recorded",
    });
  });

  test("Given the selected candidate PNG is gone When asserted Then it is refused", async () => {
    const dir = await finalizeStage();
    await rm(path.join(dir, "explorations", "round-1", "candidate-2.png"));
    await expect(assertLogoDeliverables(dir, "finalize", selection)).rejects.toMatchObject({
      code: "logo_deliverables_missing",
      detail: "candidate_missing:candidate-2",
    });
  });

  test("Given no master SVG When asserted Then it is refused", async () => {
    const dir = await finalizeStage({ svg: null });
    await expect(assertLogoDeliverables(dir, "finalize", selection)).rejects.toMatchObject({
      code: "logo_deliverables_missing",
      detail: "svg_missing",
    });
  });

  test("Given an SVG built from another candidate When asserted Then the source attribute must match", async () => {
    const mismatched = await finalizeStage({ svg: logoSvg("explorations/round-1/candidate-3.png") });
    await expect(assertLogoDeliverables(mismatched, "finalize", selection)).rejects.toMatchObject({
      code: "logo_deliverables_missing",
      detail: "svg_source_mismatch",
    });
    const missing = await finalizeStage({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path d="M0 0H8V8H0Z"/></svg>' });
    await expect(assertLogoDeliverables(missing, "finalize", selection)).rejects.toMatchObject({
      code: "logo_deliverables_missing",
      detail: "svg_source_missing",
    });
  });

  test("Given fewer than eight guideline artboards When asserted Then it is refused", async () => {
    const dir = await finalizeStage({ pages: 7 });
    await expect(assertLogoDeliverables(dir, "finalize", selection)).rejects.toMatchObject({
      code: "logo_deliverables_missing",
      detail: "guidelines_pages",
    });
  });

  test("Given an unsafe SVG on disk When asserted Then the validator detail surfaces", async () => {
    const dir = await finalizeStage({ svg: logoSvg("explorations/round-1/candidate-2.png", '<script>alert(1)</script>') });
    await expect(assertLogoDeliverables(dir, "finalize", selection)).rejects.toMatchObject({
      code: "logo_deliverables_missing",
      detail: "svg_forbidden_element:script",
    });
  });
});

describe("logo svg validator", () => {
  test("Given a clean vector mark Then it validates", () => {
    expect(svgDetail(logoSvg("explorations/round-1/candidate-2.png"))).toBe("ok");
    expect(svgDetail(`<?xml version="1.0" encoding="UTF-8"?>\n<!-- generated -->\n${logoSvg("explorations/round-1/candidate-1.png")}`)).toBe("ok");
  });

  test.each([
    ["<html><body><svg viewBox=\"0 0 8 8\"></svg></body></html>", "svg_root_invalid"],
    ['<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H8V8H0Z"/></svg>', "svg_viewbox_missing"],
    ['<svg viewBox="0 0 8 8"><image href="mark.png"/></svg>', "svg_forbidden_element:image"],
    ['<svg viewBox="0 0 8 8"><script>x</script></svg>', "svg_forbidden_element:script"],
    ['<svg viewBox="0 0 8 8"><foreignObject><p>x</p></foreignObject></svg>', "svg_forbidden_element:foreignObject"],
    ['<svg viewBox="0 0 8 8"><text x="0">누림</text></svg>', "svg_forbidden_element:text"],
    ['<svg viewBox="0 0 8 8"><use href="https://evil.test/a.svg#m"/></svg>', "svg_external_reference"],
    ['<svg viewBox="0 0 8 8"><path xlink:href="data:image/png;base64,AAA" d="M0 0"/></svg>', "svg_external_reference"],
    ['<svg viewBox="0 0 8 8"><path fill="url(#grad)" d="M0 0"/></svg>', "svg_url_reference"],
    ['<svg viewBox="0 0 8 8" onload="x()"><path d="M0 0"/></svg>', "svg_event_handler"],
    ['<!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 8 8"><path d="M0 0"/></svg>', "svg_doctype"],
  ])("Given %p Then the violation is %p", (text, detail) => {
    expect(svgDetail(text)).toBe(detail);
  });

  test("Given an internal use reference Then it is allowed", () => {
    expect(svgDetail('<svg viewBox="0 0 8 8"><defs><path id="m" d="M0 0"/></defs><use href="#m"/></svg>')).toBe("ok");
  });

  test("Given an SVG above one mebibyte Then it is refused", () => {
    const filler = "0".repeat(1024 * 1024);
    expect(svgDetail(`<svg viewBox="0 0 8 8"><path d="M${filler}"/></svg>`)).toBe("svg_too_large");
  });
});

describe("logo guideline page cap", () => {
  test("Given the page bounds Then they are the exportable window of the artboard PDF raster budget", () => {
    const points = { width: LOGO_PAGE.width * 0.75, height: LOGO_PAGE.height * 0.75 };
    expect(REQUIRED_GUIDELINE_PAGES).toBe(8);
    expect(pdfRasterBudgetFitsPages(Array.from({ length: MAX_GUIDELINE_PAGES }, () => points))).toBe(true);
    expect(pdfRasterBudgetFitsPages(Array.from({ length: MAX_GUIDELINE_PAGES + 1 }, () => points))).toBe(false);
  });

  test("Given exactly the maximum page count When asserted Then it passes", async () => {
    const dir = await finalizeStage({ pages: MAX_GUIDELINE_PAGES });
    await expect(assertLogoDeliverables(dir, "finalize", selection)).resolves.toBeUndefined();
  });

  test("Given one page more than the PDF budget allows When asserted Then it is refused before export", async () => {
    const dir = await finalizeStage({ pages: MAX_GUIDELINE_PAGES + 1 });
    await expect(assertLogoDeliverables(dir, "finalize", selection)).rejects.toMatchObject({ detail: "guidelines_pages_over" });
  });
});
