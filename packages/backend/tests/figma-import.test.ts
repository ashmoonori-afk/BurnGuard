import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  listFigmaImportableNodes,
  mapFigmaTokens,
  parseFigmaImportDocument,
  stageFigmaExport,
  type FigmaExportAsset,
} from "../src/services/figma-import";
import {
  AcquisitionLimitError,
  ExtractionAcquisitionError,
  acquisitionLimits,
} from "../src/services/extraction-acquisition";
import { FigmaImportError } from "../src/services/figma-import-errors";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function fixtureDocument(): unknown {
  return {
    name: "Checkout library",
    version: "42",
    lastModified: "2026-09-27T10:15:00Z",
    styles: {
      "S:heading": { name: "type/heading", styleType: "TEXT" },
      "S:accent": { name: "color/accent", styleType: "FILL" },
    },
    variables: {
      "V:space-panel": { name: "space/panel", resolvedType: "FLOAT" },
    },
    document: {
      id: "0:0",
      name: "Document",
      type: "DOCUMENT",
      children: [{
        id: "1:0",
        name: "Components",
        type: "CANVAS",
        children: [{
          id: "1:1",
          name: "Section",
          type: "GROUP",
          children: [{
            id: "1:2",
            name: "Checkout / Desktop",
            type: "FRAME",
            absoluteBoundingBox: { x: 10, y: 20, width: 1440, height: 900 },
            layoutMode: "VERTICAL",
            primaryAxisAlignItems: "MIN",
            counterAxisAlignItems: "CENTER",
            primaryAxisSizingMode: "FIXED",
            counterAxisSizingMode: "AUTO",
            itemSpacing: -8,
            paddingTop: 24,
            cornerRadius: 12,
            styles: { fill: "S:accent" },
            boundVariables: {
              paddingTop: { type: "VARIABLE_ALIAS", id: "V:space-panel" },
            },
            fills: [{ type: "SOLID", color: { r: 0, g: 0.31, b: 1 } }],
            children: [{
              id: "1:3",
              name: "Title",
              type: "TEXT",
              characters: "Pay securely",
              styles: { text: "S:heading" },
              style: {
                fontFamily: "Inter",
                fontSize: 24,
                fontWeight: 700,
                lineHeightPx: 32,
                letterSpacing: -0.4,
                textCase: "UPPER",
                textDecoration: "NONE",
              },
            }],
          }, {
            id: "1:4",
            name: "Primary button",
            type: "COMPONENT",
            fills: [{ type: "SOLID", color: { r: 1, g: 0.2, b: 0.1 } }],
          }, {
            id: "1:5",
            name: "Button instance",
            type: "INSTANCE",
          }],
        }],
      }],
    },
  };
}

describe("Figma import model", () => {
  test("Given nested selectable nodes When parsed Then geometry layout text typography styles and variables are preserved", () => {
    const document = parseFigmaImportDocument(fixtureDocument());

    const nodes = listFigmaImportableNodes(document);
    const frame = document.document.children[0]?.children[0]?.children[0];

    expect(nodes.map((node) => node.node_id)).toEqual(["1:2", "1:4", "1:5"]);
    expect(frame).toEqual(expect.objectContaining({
      id: "1:2",
      absoluteBoundingBox: { x: 10, y: 20, width: 1440, height: 900 },
      layoutMode: "VERTICAL",
      primaryAxisAlignItems: "MIN",
      counterAxisAlignItems: "CENTER",
      primaryAxisSizingMode: "FIXED",
      counterAxisSizingMode: "AUTO",
      itemSpacing: -8,
      styles: { fill: "S:accent" },
      boundVariableIds: { paddingTop: ["V:space-panel"] },
    }));
    expect(frame?.children[0]).toEqual(expect.objectContaining({
      characters: "Pay securely",
      style: {
        fontFamily: "Inter",
        fontSize: 24,
        fontWeight: 700,
        lineHeightPx: 32,
        letterSpacing: -0.4,
        textCase: "UPPER",
        textDecoration: "NONE",
      },
    }));
  });

  test("Given a nested export beyond the node cap When parsed Then it fails with a bounded acquisition error", () => {
    expect(() =>
      parseFigmaImportDocument(
        fixtureDocument(),
        acquisitionLimits({ parsedItems: 3 }),
      )
    ).toThrow(AcquisitionLimitError);
  });

  test("Given malformed nested Figma data When parsed Then the boundary fails with a stable code", () => {
    const malformed = fixtureDocument();
    if (
      typeof malformed !== "object" ||
      malformed === null ||
      !("document" in malformed)
    ) throw new Error("fixture_unavailable");
    const document = malformed.document;
    if (
      typeof document !== "object" ||
      document === null ||
      !("children" in document) ||
      !Array.isArray(document.children)
    ) throw new Error("fixture_unavailable");
    document.children = [{
      id: "../escape",
      name: "Page",
      type: "CANVAS",
      children: [],
    }];

    expect(() => parseFigmaImportDocument(malformed)).toThrow(
      expect.objectContaining({ code: "invalid_figma_export" }),
    );
  });
});

describe("Figma token mapping", () => {
  test("Given identity-backed and equal-valued tokens When mapped Then identity wins and font size never maps to spacing", () => {
    const document = parseFigmaImportDocument(fixtureDocument());

    const mapping = mapFigmaTokens(document, ["1:2"], `
      :root {
        --color-accent: #004fff;
        --space-panel: 24px;
        --type-heading: 24px;
        --font-heading-size: 24px;
        --font-heading-weight: 700;
        --font-heading-family: Inter;
        --line-height-heading: 32px;
        --tracking-heading: -0.4px;
        --radius-card: 12px;
        --space-negative: -8px;
      }
    `);

    expect(mapping.matches).toContainEqual({
      kind: "color",
      value: "#004fff",
      token: "--color-accent",
      node_ids: ["1:2"],
    });
    expect(mapping.matches).toContainEqual({
      kind: "font_size",
      value: "24px",
      token: "--font-heading-size",
      node_ids: ["1:3"],
    });
    expect(mapping.matches).not.toContainEqual(
      expect.objectContaining({ kind: "font_size", token: "--space-panel" }),
    );
    expect(mapping.matches).toContainEqual({
      kind: "spacing",
      value: "24px",
      token: "--space-panel",
      node_ids: ["1:2"],
    });
    expect(mapping.matches).toContainEqual({
      kind: "spacing",
      value: "-8px",
      token: "--space-negative",
      node_ids: ["1:2"],
    });
  });
});

describe("Figma export staging", () => {
  test("Given a selected nested frame and exported asset When staged Then immutable source files and provenance are written into the operation stage", async () => {
    const stageDir = await mkdtemp(path.join(tmpdir(), "bg-figma-stage-"));
    roots.push(stageDir);
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const assets: readonly FigmaExportAsset[] = [{
      relative_path: "exports/Checkout Desktop.png",
      bytes: pngBytes,
      media_type: "image/png",
    }];

    const result = await stageFigmaExport({
      stage_dir: stageDir,
      source_file_name: "checkout.json",
      document: parseFigmaImportDocument(fixtureDocument()),
      node_ids: ["1:2"],
      assets,
      pinned_tokens_css: ":root { --space-panel: 24px; }",
      imported_at: "2026-09-27T12:00:00.000Z",
      signal: new AbortController().signal,
    });
    const manifest = JSON.parse(
      await readFile(path.join(stageDir, result.manifest_path), "utf8"),
    );

    expect(manifest.provenance).toEqual(expect.objectContaining({
      source: "export",
      source_file_name: "checkout.json",
      file_version: "42",
      last_modified: "2026-09-27T10:15:00Z",
    }));
    expect(manifest.policy).toEqual(expect.objectContaining({
      trust: "untrusted",
      never_overwrite: true,
      never_copy_into_authored_output: true,
    }));
    expect(manifest.nodes[0]).toEqual(expect.objectContaining({
      node_id: "1:2",
      node_type: "FRAME",
      asset_path: expect.stringMatching(
        /^references\/figma\/.+\/assets\/checkout-desktop\.png$/u,
      ),
    }));
  });

  test("Given an asset path traversal When staged Then no source bundle is written", async () => {
    const stageDir = await mkdtemp(path.join(tmpdir(), "bg-figma-traversal-"));
    roots.push(stageDir);

    const action = stageFigmaExport({
      stage_dir: stageDir,
      source_file_name: "checkout.json",
      document: parseFigmaImportDocument(fixtureDocument()),
      node_ids: ["1:2"],
      assets: [{
        relative_path: "../outside.png",
        bytes: new Uint8Array([1]),
        media_type: "image/png",
      }],
      pinned_tokens_css: "",
      imported_at: "2026-09-27T12:00:00.000Z",
      signal: new AbortController().signal,
    });

    await expect(action).rejects.toBeInstanceOf(FigmaImportError);
  });

  test("Given an aborted request When staging begins Then no bounded unit is processed", async () => {
    const stageDir = await mkdtemp(path.join(tmpdir(), "bg-figma-abort-"));
    roots.push(stageDir);
    const controller = new AbortController();
    controller.abort(new ExtractionAcquisitionError("acquisition_aborted"));

    const action = stageFigmaExport({
      stage_dir: stageDir,
      source_file_name: "checkout.json",
      document: parseFigmaImportDocument(fixtureDocument()),
      node_ids: ["1:2"],
      assets: [],
      pinned_tokens_css: "",
      imported_at: "2026-09-27T12:00:00.000Z",
      signal: controller.signal,
    });

    await expect(action).rejects.toMatchObject({
      code: "acquisition_aborted",
    });
  });
});
