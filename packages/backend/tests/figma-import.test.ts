import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  importFigmaExport,
  listFigmaImportableNodes,
  mapFigmaTokens,
  parseFigmaImportDocument,
  type FigmaExportAsset,
} from "../src/services/figma-import";
import { AcquisitionLimitError, acquisitionLimits } from "../src/services/extraction-acquisition";
import { FigmaImportError } from "../src/services/figma-import-errors";
import { parseFigmaImportUrl } from "../src/services/figma-import-client";
import {
  figmaFetchDependencies,
  importFigmaApi,
  inspectFigmaApiImport,
  type FigmaImportApiDependencies,
} from "../src/services/figma-import-api";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function fixtureDocument(): unknown {
  return {
    name: "Checkout library",
    version: "42",
    lastModified: "2026-09-27T10:15:00Z",
    document: {
      id: "0:0",
      name: "Document",
      type: "DOCUMENT",
      children: [{
        id: "1:0",
        name: "Components",
        type: "CANVAS",
        children: [
          {
            id: "1:2",
            name: "Checkout / Desktop",
            type: "FRAME",
            itemSpacing: 16,
            paddingTop: 24,
            fills: [{ type: "SOLID", color: { r: 0, g: 0.31, b: 1 } }],
            children: [{
              id: "1:3",
              name: "Title",
              type: "TEXT",
              style: { fontFamily: "Inter", fontSize: 32, fontWeight: 700 },
            }],
          },
          {
            id: "1:4",
            name: "Primary button",
            type: "COMPONENT",
            fills: [{ type: "SOLID", color: { r: 1, g: 0.2, b: 0.1 } }],
          },
          { id: "1:5", name: "Loose rectangle", type: "RECTANGLE" },
        ],
      }],
    },
  };
}

describe("Figma import source parsing", () => {
  test("Given a Figma URL with node-id When parsed Then the decoded node selector is retained", () => {
    const parsed = parseFigmaImportUrl("https://www.figma.com/design/abc123XYZ/Checkout?node-id=1-2");

    expect(parsed).toEqual({ fileKey: "abc123XYZ", nodeId: "1:2" });
  });

  test("Given a file export When its top-level nodes are listed Then only frames and components are selectable", () => {
    const document = parseFigmaImportDocument(fixtureDocument());

    const nodes = listFigmaImportableNodes(document);

    expect(nodes).toEqual([
      { node_id: "1:2", name: "Checkout / Desktop", node_type: "FRAME", page_name: "Components" },
      { node_id: "1:4", name: "Primary button", node_type: "COMPONENT", page_name: "Components" },
    ]);
  });

  test("Given malformed nested Figma data When parsed Then the boundary fails with a stable code", () => {
    const malformed = fixtureDocument() as { document: { children: unknown[] } };
    malformed.document.children = [{ id: "../escape", name: "Page", type: "CANVAS", children: [] }];

    expect(() => parseFigmaImportDocument(malformed)).toThrow(
      expect.objectContaining({ code: "invalid_figma_export" }),
    );
  });
});

describe("Figma REST import", () => {
  test("Given canned Figma REST responses When a URL is inspected and imported Then only selected nodes and image assets are persisted", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "bg-figma-api-"));
    roots.push(projectDir);
    const requests: string[] = [];
    const fetcher = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/v1/images/")) {
        return Response.json({ images: { "1:2": "https://figma-assets.example/frame.png" } });
      }
      return Response.json(fixtureDocument());
    };
    const client = figmaFetchDependencies(fetcher);
    const dependencies: FigmaImportApiDependencies = {
      getToken: async () => "test-token",
      fetchDocument: client.fetchDocument,
      fetchImageUrls: client.fetchImageUrls,
      fetchAsset: async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    };
    const controller = new AbortController();

    const inspection = await inspectFigmaApiImport({
      source_url: "https://www.figma.com/design/abc123XYZ/Checkout?node-id=1-2",
      signal: controller.signal,
      dependencies,
    });
    const result = await importFigmaApi({
      project_dir: projectDir,
      source_url: "https://www.figma.com/design/abc123XYZ/Checkout?node-id=1-2",
      node_ids: ["1:2"],
      pinned_tokens_css: ":root { --space-panel: 24px; }",
      imported_at: "2026-09-27T12:00:00.000Z",
      signal: controller.signal,
      dependencies,
    });

    expect(inspection.selected_node_id).toBe("1:2");
    expect(inspection.nodes.map((node) => node.node_id)).toEqual(["1:2", "1:4"]);
    expect(result.imported_asset_count).toBe(1);
    expect(requests).toEqual([
      "https://api.figma.com/v1/files/abc123XYZ?depth=2",
      "https://api.figma.com/v1/files/abc123XYZ/nodes?ids=1%3A2",
      "https://api.figma.com/v1/images/abc123XYZ?ids=1%3A2&format=png&scale=2",
    ]);
  });
});

describe("Figma token mapping", () => {
  test("Given selected nodes and pinned CSS tokens When mapped Then matches and unmatched values remain explicit", () => {
    const document = parseFigmaImportDocument(fixtureDocument());
    const selected = listFigmaImportableNodes(document).map((node) => node.node_id);

    const mapping = mapFigmaTokens(document, selected, `
      :root {
        --color-accent: #004fff;
        --space-panel: 24px;
        --type-heading-size: 32px;
        --type-heading-weight: 700;
        --font-sans: Inter;
      }
    `);

    expect(mapping.matches).toEqual([
      { kind: "color", value: "#004fff", token: "--color-accent", node_ids: ["1:2"] },
      { kind: "font_family", value: "Inter", token: "--font-sans", node_ids: ["1:3"] },
      { kind: "font_size", value: "32px", token: "--type-heading-size", node_ids: ["1:3"] },
      { kind: "font_weight", value: "700", token: "--type-heading-weight", node_ids: ["1:3"] },
      { kind: "spacing", value: "24px", token: "--space-panel", node_ids: ["1:2"] },
    ]);
    expect(mapping.unmatched).toEqual([
      { kind: "color", value: "#ff331a", node_ids: ["1:4"] },
      { kind: "spacing", value: "16px", node_ids: ["1:2"] },
    ]);
  });
});

describe("Figma export import", () => {
  test("Given a selected frame and exported asset When imported Then bounded source files and provenance are published", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "bg-figma-import-"));
    roots.push(projectDir);
    const document = parseFigmaImportDocument(fixtureDocument());
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const assets: readonly FigmaExportAsset[] = [{
      relative_path: "exports/Checkout Desktop.png",
      bytes: pngBytes,
      media_type: "image/png",
    }];

    const result = await importFigmaExport({
      project_dir: projectDir,
      file_key: "abc123XYZ",
      document,
      node_ids: ["1:2"],
      assets,
      pinned_tokens_css: ":root { --space-panel: 24px; }",
      imported_at: "2026-09-27T12:00:00.000Z",
    });
    const manifest = JSON.parse(await readFile(path.join(projectDir, result.manifest_path), "utf8"));

    expect(manifest.provenance).toEqual(expect.objectContaining({
      source: "export",
      file_key: "abc123XYZ",
      file_version: "42",
      last_modified: "2026-09-27T10:15:00Z",
      imported_at: "2026-09-27T12:00:00.000Z",
    }));
    expect(manifest.provenance.document_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.nodes).toEqual([
      expect.objectContaining({ node_id: "1:2", node_type: "FRAME", asset_path: "assets/checkout-desktop.png" }),
    ]);
    expect(await readFile(path.join(projectDir, path.dirname(result.manifest_path), "assets/checkout-desktop.png"))).toEqual(Buffer.from(pngBytes));
  });

  test("Given an asset path traversal When imported Then no bytes escape or source bundle is published", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "bg-figma-traversal-"));
    roots.push(projectDir);
    const outside = path.join(projectDir, "..", `outside-${crypto.randomUUID()}.txt`);
    await writeFile(outside, "sentinel", "utf8");
    roots.push(outside);

    const action = importFigmaExport({
      project_dir: projectDir,
      file_key: "abc123XYZ",
      document: parseFigmaImportDocument(fixtureDocument()),
      node_ids: ["1:2"],
      assets: [{ relative_path: "../outside.png", bytes: new Uint8Array([1]), media_type: "image/png" }],
      pinned_tokens_css: "",
      imported_at: "2026-09-27T12:00:00.000Z",
    });

    await expect(action).rejects.toBeInstanceOf(FigmaImportError);
    expect(await readFile(outside, "utf8")).toBe("sentinel");
  });

  test("Given aggregate export assets above the acquisition limit When imported Then publication is rejected before writing", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "bg-figma-limit-"));
    roots.push(projectDir);
    const limits = acquisitionLimits({ assets: 1, assetBytes: 4, publicationBytes: 4 });

    const action = importFigmaExport({
      project_dir: projectDir,
      file_key: "abc123XYZ",
      document: parseFigmaImportDocument(fixtureDocument()),
      node_ids: ["1:2"],
      assets: [{ relative_path: "frame.png", bytes: new Uint8Array(5), media_type: "image/png" }],
      pinned_tokens_css: "",
      imported_at: "2026-09-27T12:00:00.000Z",
      limits,
    });

    await expect(action).rejects.toBeInstanceOf(AcquisitionLimitError);
  });
});
