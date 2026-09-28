import { describe, expect, test } from "bun:test";
import { FIGMA_IMPORT_LIMITS } from "@bg/shared/figma-import";
import {
  FigmaExportPreviewError,
  parseFigmaExportPreview,
  readFigmaExportPreview,
  updateFigmaSelection,
  validateFigmaExportAssets,
} from "@/components/project/figma-export-preview";

function fixtureDocument(children: readonly unknown[]): unknown {
  return {
    name: "Checkout",
    version: "9",
    lastModified: "2026-09-27T10:15:00Z",
    document: {
      children: [{
        id: "1:0",
        name: "Library",
        type: "CANVAS",
        children,
      }],
    },
  };
}

describe("Figma export preview", () => {
  test("Given nested frames components sets and instances When previewed Then every selectable node retains its page", () => {
    const preview = parseFigmaExportPreview(fixtureDocument([{
      id: "1:1",
      name: "Section",
      type: "GROUP",
      children: [{
        id: "1:2",
        name: "Checkout",
        type: "FRAME",
        children: [{
          id: "1:3",
          name: "Primary button",
          type: "COMPONENT",
        }],
      }, {
        id: "1:4",
        name: "Buttons",
        type: "COMPONENT_SET",
      }, {
        id: "1:5",
        name: "Button instance",
        type: "INSTANCE",
      }],
    }]));

    expect(preview.nodes).toEqual([
      { node_id: "1:2", name: "Checkout", node_type: "FRAME", page_name: "Library" },
      { node_id: "1:3", name: "Primary button", node_type: "COMPONENT", page_name: "Library" },
      { node_id: "1:4", name: "Buttons", node_type: "COMPONENT_SET", page_name: "Library" },
      { node_id: "1:5", name: "Button instance", node_type: "INSTANCE", page_name: "Library" },
    ]);
  });

  test("Given an oversized JSON file When previewed Then it fails before reading text", async () => {
    let reads = 0;
    const file = {
      size: FIGMA_IMPORT_LIMITS.documentBytes + 1,
      text: async () => {
        reads += 1;
        return "{}";
      },
    };

    await expect(readFigmaExportPreview(file)).rejects.toBeInstanceOf(
      FigmaExportPreviewError,
    );
    expect(reads).toBe(0);
  });

  test("Given more nodes than the shared cap When previewed Then traversal fails closed", () => {
    const nodes = Array.from(
      { length: FIGMA_IMPORT_LIMITS.nodes + 1 },
      (_, index) => ({
        id: `1:${index + 1}`,
        name: `Node ${index}`,
        type: "FRAME",
      }),
    );

    expect(() => parseFigmaExportPreview(fixtureDocument(nodes))).toThrow(
      FigmaExportPreviewError,
    );
  });

  test("Given names beyond the shared string cap When previewed Then unbounded text is rejected", () => {
    expect(() =>
      parseFigmaExportPreview(fixtureDocument([{
        id: "1:2",
        name: "x".repeat(FIGMA_IMPORT_LIMITS.stringChars + 1),
        type: "FRAME",
      }]))
    ).toThrow(FigmaExportPreviewError);
  });

  test("Given duplicate node IDs in separate branches When previewed Then the ambiguous export is rejected", () => {
    expect(() =>
      parseFigmaExportPreview(fixtureDocument([{
        id: "1:2",
        name: "First",
        type: "FRAME",
      }, {
        id: "1:2",
        name: "Second",
        type: "COMPONENT",
      }]))
    ).toThrow(FigmaExportPreviewError);
  });

  test("Given more exported assets than the shared cap When validated Then the folder is rejected", () => {
    const files = Array.from(
      { length: FIGMA_IMPORT_LIMITS.assets + 1 },
      () => ({ size: 1 }),
    );

    expect(() => validateFigmaExportAssets(files)).toThrow(
      FigmaExportPreviewError,
    );
  });

  test("Given the shared selection cap is already selected When another node is checked Then selection stays bounded and reports the limit", () => {
    const current = Array.from(
      { length: FIGMA_IMPORT_LIMITS.selection },
      (_, index) => `1:${index}`,
    );

    const update = updateFigmaSelection(current, "2:1", true);

    expect(update).toEqual({
      selected: current,
      limitReached: true,
    });
  });

  test("Given a selection-limit warning When a selected node is unchecked Then the warning clears and the node is removed", () => {
    const current = ["1:1", "1:2"];

    const update = updateFigmaSelection(current, "1:2", false);

    expect(update).toEqual({
      selected: ["1:1"],
      limitReached: false,
    });
  });

  test("Given a REST nodes response When previewed Then nested wrapped nodes are available", () => {
    const preview = parseFigmaExportPreview({
      name: "Checkout",
      version: "10",
      lastModified: "2026-09-27T11:15:00Z",
      nodes: {
        "2:1": {
          document: {
            id: "2:1",
            name: "Group",
            type: "GROUP",
            children: [{
              id: "2:2",
              name: "Card",
              type: "COMPONENT",
            }],
          },
        },
      },
    });

    expect(preview.nodes).toEqual([
      { node_id: "2:2", name: "Card", node_type: "COMPONENT", page_name: "Selected nodes" },
    ]);
  });
});
