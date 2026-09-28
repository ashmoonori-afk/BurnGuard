import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
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

  test("Given duplicate node IDs in separate branches When parsed Then the boundary rejects the ambiguous export", () => {
    const duplicate = fixtureDocument();
    if (
      typeof duplicate !== "object" ||
      duplicate === null ||
      !("document" in duplicate) ||
      typeof duplicate.document !== "object" ||
      duplicate.document === null ||
      !("children" in duplicate.document) ||
      !Array.isArray(duplicate.document.children)
    ) throw new Error("fixture_unavailable");
    duplicate.document.children.push({
      id: "1:2",
      name: "Duplicate",
      type: "CANVAS",
      children: [],
    });

    expect(() => parseFigmaImportDocument(duplicate)).toThrow(
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
      normalized_document_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }));
    expect(manifest.policy).toEqual(expect.objectContaining({
      trust: "untrusted",
      uploaded_document: "not_preserved",
      document_digest: "normalized_model",
      never_overwrite: true,
      never_copy_into_authored_output: true,
    }));
    expect(manifest.provenance.document_sha256).toBeUndefined();
    expect(manifest.policy.original_file).toBeUndefined();
    expect(manifest.policy.original_hash).toBeUndefined();
    expect(manifest.nodes[0]).toEqual(expect.objectContaining({
      node_id: "1:2",
      node_type: "FRAME",
      asset_path: expect.stringMatching(
        /^references\/figma\/.+\/assets\/checkout-desktop-[a-f0-9]{16}\.png$/u,
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

describe("Figma import manifest bounds", () => {
  test("Given node ids whose readable file names collide When staged Then each node gets its own file", async () => {
    // Given
    const stageDir = await mkdtemp(path.join(tmpdir(), "bg-figma-collide-"));
    roots.push(stageDir);
    const document = parseFigmaImportDocument({
      name: "Collisions",
      version: "1",
      lastModified: "2026-09-27T10:15:00Z",
      document: {
        id: "0:0", name: "Document", type: "DOCUMENT",
        children: [{
          id: "1:0", name: "Page", type: "CANVAS",
          children: [
            { id: "a:b-c", name: "First", type: "FRAME" },
            { id: "a-b:c", name: "Second", type: "FRAME" },
          ],
        }],
      },
    });

    // When
    const result = await stageFigmaExport({
      stage_dir: stageDir,
      source_file_name: "collisions.json",
      document,
      node_ids: ["a:b-c", "a-b:c"],
      assets: [],
      pinned_tokens_css: "",
      imported_at: "2026-09-27T12:00:00.000Z",
      signal: new AbortController().signal,
    });
    const manifest = JSON.parse(await readFile(path.join(stageDir, result.manifest_path), "utf8"));

    // Then
    const nodePaths = manifest.nodes.map((node: { readonly node_path: string }) => node.node_path);
    expect(new Set(nodePaths).size).toBe(2);
    for (const nodePath of nodePaths) {
      expect(JSON.parse(await readFile(path.join(stageDir, nodePath), "utf8")).id).toBeString();
    }
  });

  test("Given a valid export with a very large token mapping When staged Then the manifest stays within the reference policy limit", async () => {
    // Given
    const stageDir = await mkdtemp(path.join(tmpdir(), "bg-figma-large-mapping-"));
    roots.push(stageDir);
    const children = Array.from({ length: 900 }, (_, index) => ({
      id: `2:${index + 1}`,
      name: `Swatch ${index + 1}`,
      type: "FRAME",
      fills: [{ type: "SOLID", color: { r: (index % 30) / 30, g: Math.floor(index / 30) / 30, b: 0.5 } }],
    }));
    const document = parseFigmaImportDocument({
      name: "Palette",
      version: "1",
      lastModified: "2026-09-27T10:15:00Z",
      document: {
        id: "0:0", name: "Document", type: "DOCUMENT",
        children: [{ id: "1:0", name: "Page", type: "CANVAS", children: [{ id: "1:1", name: "Board", type: "FRAME", children }] }],
      },
    });

    // When
    const result = await stageFigmaExport({
      stage_dir: stageDir,
      source_file_name: "palette.json",
      document,
      node_ids: ["1:1"],
      assets: [],
      pinned_tokens_css: "",
      imported_at: "2026-09-27T12:00:00.000Z",
      signal: new AbortController().signal,
    });
    const raw = await readFile(path.join(stageDir, result.manifest_path));
    const manifest = JSON.parse(raw.toString("utf8"));

    // Then
    expect(raw.byteLength).toBeLessThanOrEqual(1_000_000);
    expect(result.unmatched_token_count).toBeGreaterThan(512);
    expect(manifest.token_mapping.unmatched).toHaveLength(512);
    expect(manifest.token_mapping.total_unmatched).toBe(result.unmatched_token_count);
    expect(manifest.token_mapping.omitted_unmatched).toBe(result.unmatched_token_count - 512);
  });
});

describe("Figma import asset naming", () => {
  test("Given non-Latin asset and node names When staged Then each node keeps its own asset and names never collide", async () => {
    // Given
    const stageDir = await mkdtemp(path.join(tmpdir(), "bg-figma-unicode-"));
    roots.push(stageDir);
    const document = parseFigmaImportDocument({
      name: "Unicode",
      version: "1",
      lastModified: "2026-09-27T10:15:00Z",
      document: {
        id: "0:0", name: "Document", type: "DOCUMENT",
        children: [{
          id: "1:0", name: "Page", type: "CANVAS",
          children: [
            { id: "3:1", name: "Σχέδιο", type: "FRAME" },
            { id: "3:2", name: "Экран", type: "FRAME" },
          ],
        }],
      },
    });

    // When
    const result = await stageFigmaExport({
      stage_dir: stageDir,
      source_file_name: "unicode.json",
      document,
      node_ids: ["3:1", "3:2"],
      assets: [
        { relative_path: "exports/Σχέδιο.png", bytes: new Uint8Array([137, 80, 78, 71, 1]), media_type: "image/png" },
        { relative_path: "exports/Экран.png", bytes: new Uint8Array([137, 80, 78, 71, 2]), media_type: "image/png" },
      ],
      pinned_tokens_css: "",
      imported_at: "2026-09-27T12:00:00.000Z",
      signal: new AbortController().signal,
    });
    const manifest = JSON.parse(await readFile(path.join(stageDir, result.manifest_path), "utf8"));
    const byId = new Map(manifest.nodes.map((node: { readonly node_id: string; readonly asset_path: string | null; readonly asset_sha256: string | null }) => [node.node_id, node]));

    // Then
    const first = byId.get("3:1") as { readonly asset_path: string; readonly asset_sha256: string };
    const second = byId.get("3:2") as { readonly asset_path: string; readonly asset_sha256: string };
    expect(first.asset_path).not.toBe(second.asset_path);
    expect(first.asset_sha256).not.toBe(second.asset_sha256);
    expect([...await readFile(path.join(stageDir, first.asset_path))]).toEqual([137, 80, 78, 71, 1]);
    expect([...await readFile(path.join(stageDir, second.asset_path))]).toEqual([137, 80, 78, 71, 2]);
  });
});

describe("Figma import asset assignment and serialization bounds", () => {
  function pairDocument(first: { readonly id: string; readonly name: string }, second: { readonly id: string; readonly name: string }) {
    return parseFigmaImportDocument({
      name: "Pairs",
      version: "1",
      lastModified: "2026-09-27T10:15:00Z",
      document: {
        id: "0:0", name: "Document", type: "DOCUMENT",
        children: [{ id: "1:0", name: "Page", type: "CANVAS", children: [
          { ...first, type: "FRAME" },
          { ...second, type: "FRAME" },
        ] }],
      },
    });
  }
  const png = (tail: number) => new Uint8Array([137, 80, 78, 71, tail]);

  test("Given an id-named and a name-matching asset When staged Then the exact node-id match wins", async () => {
    // Given
    const stageDir = await mkdtemp(path.join(tmpdir(), "bg-figma-id-first-"));
    roots.push(stageDir);

    // When
    const result = await stageFigmaExport({
      stage_dir: stageDir,
      source_file_name: "pairs.json",
      document: pairDocument({ id: "4:1", name: "Hero" }, { id: "4:2", name: "Other" }),
      node_ids: ["4:1"],
      assets: [
        { relative_path: "exports/Hero.png", bytes: png(1), media_type: "image/png" },
        { relative_path: "exports/4-1.png", bytes: png(2), media_type: "image/png" },
      ],
      pinned_tokens_css: "",
      imported_at: "2026-09-27T12:00:00.000Z",
      signal: new AbortController().signal,
    });
    const manifest = JSON.parse(await readFile(path.join(stageDir, result.manifest_path), "utf8"));

    // Then
    expect([...await readFile(path.join(stageDir, manifest.nodes[0].asset_path))]).toEqual([137, 80, 78, 71, 2]);
  });

  test("Given two selected nodes sharing a name and one matching asset When staged Then the ambiguous mapping is refused", async () => {
    // Given
    const stageDir = await mkdtemp(path.join(tmpdir(), "bg-figma-ambiguous-"));
    roots.push(stageDir);

    // When
    const action = stageFigmaExport({
      stage_dir: stageDir,
      source_file_name: "pairs.json",
      document: pairDocument({ id: "5:1", name: "Card" }, { id: "5:2", name: "Card" }),
      node_ids: ["5:1", "5:2"],
      assets: [{ relative_path: "exports/Card.png", bytes: png(3), media_type: "image/png" }],
      pinned_tokens_css: "",
      imported_at: "2026-09-27T12:00:00.000Z",
      signal: new AbortController().signal,
    });

    // Then
    await expect(action).rejects.toMatchObject({ code: "ambiguous_figma_asset" });
  });

  test("Given selections whose serialized size passes the publication limit When staged Then it fails before writing", async () => {
    // Given
    const stageDir = await mkdtemp(path.join(tmpdir(), "bg-figma-serialized-limit-"));
    roots.push(stageDir);

    // When
    const action = stageFigmaExport({
      stage_dir: stageDir,
      source_file_name: "checkout.json",
      document: parseFigmaImportDocument(fixtureDocument()),
      node_ids: ["1:2", "1:4"],
      assets: [],
      pinned_tokens_css: "",
      imported_at: "2026-09-27T12:00:00.000Z",
      signal: new AbortController().signal,
      limits: acquisitionLimits({ publicationBytes: 64 }),
    });

    // Then
    await expect(action).rejects.toMatchObject({ limit: "publication_bytes" });
    expect(await readdir(stageDir)).toEqual([]);
  });
});
