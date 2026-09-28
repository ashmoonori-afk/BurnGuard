import { describe, expect, test } from "bun:test";
import { FigmaExportPreviewError, parseFigmaExportPreview } from "@/components/project/figma-export-preview";

describe("Figma export preview", () => {
  test("Given a REST file document When previewed Then top-level frames and components retain parsed fields", () => {
    const preview = parseFigmaExportPreview({
      name: "Checkout",
      version: "9",
      lastModified: "2026-09-27T10:15:00Z",
      document: {
        children: [{
          name: "Library",
          type: "CANVAS",
          children: [
            { id: "1:2", name: "Checkout", type: "FRAME" },
            { id: "1:3", name: "Primary button", type: "COMPONENT" },
            { id: "1:4", name: "Decoration", type: "RECTANGLE" },
          ],
        }],
      },
    });

    expect(preview).toEqual({
      name: "Checkout",
      version: "9",
      last_modified: "2026-09-27T10:15:00Z",
      nodes: [
        { node_id: "1:2", name: "Checkout", node_type: "FRAME", page_name: "Library" },
        { node_id: "1:3", name: "Primary button", node_type: "COMPONENT", page_name: "Library" },
      ],
    });
  });

  test("Given a malformed export with no selectable nodes When previewed Then it fails closed", () => {
    expect(() => parseFigmaExportPreview({
      name: "Empty",
      version: "1",
      lastModified: "2026-09-27T10:15:00Z",
      document: { children: [{ name: "Page", type: "CANVAS", children: [{ id: "../escape", name: "Bad", type: "FRAME" }] }] },
    })).toThrow(FigmaExportPreviewError);
  });

  test("Given a REST nodes response When previewed Then wrapped selected components are available", () => {
    const preview = parseFigmaExportPreview({
      name: "Checkout",
      version: "10",
      lastModified: "2026-09-27T11:15:00Z",
      nodes: {
        "2:1": { document: { id: "2:1", name: "Card", type: "COMPONENT" } },
      },
    });

    expect(preview.nodes).toEqual([
      { node_id: "2:1", name: "Card", node_type: "COMPONENT", page_name: "Selected nodes" },
    ]);
  });
});
