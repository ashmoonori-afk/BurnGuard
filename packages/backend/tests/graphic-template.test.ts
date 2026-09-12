import { describe, expect, test } from "bun:test";
import { parse } from "node-html-parser";
import { renderInitialArtifact } from "../src/db/templates";

describe("initial graphic template", () => {
  test.each([780, 860, 1000])("product-detail initializer retains requested width %i", (width) => {
    const html = renderInitialArtifact({
      name: "Product dimensions",
      type: "graphic",
      options: {
        graphic_canvas: { schema_version: 1, width, height: 16_000 },
        graphic_set: { schema_version: 1, kind: "product_detail", frame_count: 1 },
      },
    });
    expect(parse(html).querySelectorAll("[data-graphic-artboard]").map(frame => frame.getAttribute("style")))
      .toEqual([`width:${width}px;height:16000px`]);
  });

  test("Given a graphic canvas When rendered Then one exact server-owned artboard is emitted", () => {
    const html = renderInitialArtifact({
      name: "행사 포스터",
      type: "graphic",
      options: { graphic_canvas: { schema_version: 1, width: 1080, height: 1920 } },
    });
    const root = parse(html);

    expect(root.querySelectorAll("[data-graphic-artboard]")).toHaveLength(1);
    expect(html).toContain("width: 1080px");
    expect(html).toContain("height: 1920px");
    expect(root.querySelectorAll("[data-bg-node-id]").length).toBeGreaterThanOrEqual(3);
    expect(root.textContent.trim().length).toBeGreaterThan(20);
    expect(html).not.toContain("data-slide");
    expect(html).not.toContain("deck-stage.js");
  });

  test("Given a card-news set When rendered Then ordered cover message and CTA artboards are emitted", () => {
    // Given / When
    const html = renderInitialArtifact({
      name: "캠페인",
      type: "graphic",
      options: {
        graphic_canvas: { schema_version: 1, width: 1080, height: 1080 },
        graphic_set: { schema_version: 1, kind: "card_news", frame_count: 4 },
      },
    });
    const root = parse(html);

    // Then
    expect(root.querySelectorAll("[data-graphic-artboard]").map((node) => node.id)).toEqual([
      "frame-1-cover",
      "frame-2-message",
      "frame-3-message",
      "frame-4-cta",
    ]);
  });

  test("Given a mixed banner set When rendered Then every artboard keeps its frame dimensions", () => {
    // Given / When
    const html = renderInitialArtifact({
      name: "배너 캠페인",
      type: "graphic",
      options: {
        graphic_canvas: { schema_version: 1, width: 1200, height: 1200 },
        graphic_set: {
          schema_version: 1,
          kind: "banner_set",
          frame_count: 2,
          frames: [
            { width: 1200, height: 628, label: "wide" },
            { width: 1080, height: 1080, label: "square" },
          ],
        },
      },
    });
    const frames = parse(html).querySelectorAll("[data-graphic-artboard]");

    // Then
    expect(frames.map((frame) => frame.getAttribute("style"))).toEqual([
      "width:1200px;height:628px",
      "width:1080px;height:1080px",
    ]);
  });

  test("Given a product-detail set When rendered Then one 860-wide artboard opens with persona Q1 and contains Q1 through Q8", () => {
    // Given / When
    const html = renderInitialArtifact({
      name: "비밀 상품명",
      type: "graphic",
      options: {
        graphic_canvas: { schema_version: 1, width: 860, height: 12_000 },
        graphic_set: { schema_version: 1, kind: "product_detail", frame_count: 1 },
      },
    });
    const root = parse(html);
    const artboards = root.querySelectorAll("[data-graphic-artboard]");
    const sections = artboards[0]?.querySelectorAll("[data-bg-node-id]") ?? [];

    // Then
    expect(artboards).toHaveLength(1);
    expect(artboards[0]?.getAttribute("style")).toContain("width:860px");
    expect(sections.map((section) => section.getAttribute("data-bg-node-id"))).toEqual([
      "detail-q1-persona",
      "detail-q2-arrival",
      "detail-q3-mechanism",
      "detail-q4-evidence",
      "detail-q5-effort",
      "detail-q6-journey",
      "detail-q7-risk",
      "detail-q8-urgency",
      "detail-features",
      "detail-payment-cta",
    ]);
    expect(sections[0]?.textContent).not.toContain("비밀 상품명");
  });
});
