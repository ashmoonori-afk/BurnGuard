import { expect, test } from "bun:test";
import { parseDesignBriefV1 } from "@bg/shared";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generationOutputComplete } from "../src/services/generation-output";
import * as context from "../src/services/context";
import { parseStoredProjectOptions } from "../src/services/project-options";

const brief = {
  schema_version: 1,
  output_type: "slide_deck",
  audience: "Customers",
  objective: "Explain the supplied brochure",
  content_source: "attached",
  locale: "ko",
  brand_mode: "selected_design_system",
  visual_mood: "formal",
  density: "balanced",
  output_size: "widescreen-16x9",
} as const;

test("Given attached slide content When one-to-one mapping is requested Then the parsed brief preserves that contract", () => {
  expect(parseDesignBriefV1({ ...brief, source_page_mapping: "one_to_one" }))
    .toMatchObject({ source_page_mapping: "one_to_one" });
});

test("Given an explicit restructuring choice When parsing the brief Then it is not replaced with one-to-one mapping", () => {
  expect(parseDesignBriefV1({ ...brief, source_page_mapping: "restructure" }))
    .toMatchObject({ source_page_mapping: "restructure" });
});

test("Given an unsupported source mapping When parsing the brief Then it is rejected rather than silently ignored", () => {
  expect(() => parseDesignBriefV1({ ...brief, source_page_mapping: "auto" })).toThrow();
  expect(() => parseDesignBriefV1({ ...brief, source_page_mapping: true })).toThrow();
});

test("Given no attached deck source When one-to-one mapping is requested Then the invalid combination is rejected", () => {
  expect(() => parseDesignBriefV1({ ...brief, content_source: "none", source_page_mapping: "one_to_one" })).toThrow();
  expect(() => parseDesignBriefV1({ ...brief, output_type: "prototype", source_page_mapping: "one_to_one" })).toThrow();
});

test("Given a legacy brief When parsing it Then no new mapping policy is invented", () => {
  expect(parseDesignBriefV1(brief)).toEqual(brief);
});

test("Given a stored source-mapping contract When it is malformed Then loading cannot silently remove the mapping policy", () => {
  expect(() => parseStoredProjectOptions(JSON.stringify({
    design_brief: { ...brief, source_page_mapping: "unknown" },
  }))).toThrow();
  expect(() => parseStoredProjectOptions(JSON.stringify({
    design_brief: { ...brief, source_page_mapping: "one_to_one", audience: "" },
  }))).toThrow();
});

test("Given selected content documents When capturing one-to-one pages Then server metadata fixes the count and excludes design references", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-source-count-"));
  const source = path.join(dir, "source.pdf");
  const reference = path.join(dir, "reference.pdf");
  const metadata = { kind: "pdf", page_count: 8, fonts: [], colors: [], notes: [], headings: [], bodies: [], pages: [] };
  try {
    await writeFile(`${source}.summary.json`, JSON.stringify(metadata));
    await writeFile(`${reference}.summary.json`, JSON.stringify({ ...metadata, page_count: 12 }));
    const inputs = [
      { id: "content", file_path: source, mime_type: "application/pdf", source_role: "ordinary_content" as const, created_at: 1 },
      { id: "design-reference", file_path: reference, mime_type: "application/pdf", source_role: "immutable_reference" as const, created_at: 2 },
    ];
    expect(await context.readDeckSourcePages(inputs, "one_to_one")).toEqual(
      Array.from({ length: 8 }, (_, index) => ({ attachmentId: "content", page: index + 1 })),
    );
    expect(await context.readDeckSourcePages(inputs, "restructure")).toBeUndefined();
    expect(await context.readDeckSourcePages(inputs, undefined)).toBeUndefined();
    await writeFile(`${source}.summary.json`, JSON.stringify({ ...metadata, page_count: 81 }));
    await expect(context.readDeckSourcePages(inputs, "one_to_one")).rejects.toThrow();
    await expect(context.readDeckSourcePages([], "one_to_one")).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test.each(["requested", "reverse_requested", "persisted"] as const)("Given multiple source documents When mapping %s order Then source order is independent of context recency", async (mode) => {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-source-order-"));
  const first = { id: "first", file_path: path.join(dir, "first.pdf"), mime_type: "application/pdf", source_role: "ordinary_content" as const, created_at: 1 };
  const second = { ...first, id: "second", file_path: path.join(dir, "second.pdf"), created_at: 2 };
  const reference = { ...first, id: "reference", file_path: path.join(dir, "reference.pdf"), source_role: "immutable_reference" as const, created_at: 3 };
  try {
    for (const source of [first, second]) await writeFile(`${source.file_path}.summary.json`, JSON.stringify({
      kind: "pdf", page_count: 2, fonts: [], colors: [], notes: [], headings: [], bodies: [], pages: [],
    }));
    const requested = mode === "persisted" ? [] : mode === "requested"
      ? [first.file_path, reference.file_path, second.file_path] : [second.file_path, first.file_path];
    const expected = mode === "reverse_requested" ? [second, first] : [first, second];
    expect(await context.readDeckSourcePages([second, reference, first], "one_to_one", requested))
      .toEqual(expected.flatMap(source => [1, 2].map(page => ({ attachmentId: source.id, page }))));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Given captured source pages When validating generated slides Then missing duplicate reordered or foreign bindings cannot complete", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-source-map-"));
  const sourcePages = [{ attachmentId: "source-document", page: 1 }, { attachmentId: "source-document", page: 2 }];
  try {
    for (const binding of [
      [{ attachmentId: "source-document", page: 1 }, { attachmentId: "source-document", page: 1 }],
      [{ attachmentId: "source-document", page: 2 }, { attachmentId: "source-document", page: 1 }],
      [{ attachmentId: "other-document", page: 1 }, { attachmentId: "other-document", page: 2 }],
      [{ attachmentId: "", page: 0 }, { attachmentId: "", page: 0 }],
      sourcePages,
    ]) {
      await writeFile(path.join(dir, "deck.html"), binding.map((source, index) =>
        `<section class="deck-slide" data-slide data-bg-unit="${index + 1}" data-bg-complete="true" data-bg-source-attachment="${source.attachmentId}" data-bg-source-page="${source.page}"><h1>Content ${index + 1}</h1></section>`
      ).join("") + '<script src="runtime/deck-stage.js"></script>');
      expect(await generationOutputComplete(dir, "deck.html", "slide_deck", 2, sourcePages)).toBe(binding === sourcePages);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
