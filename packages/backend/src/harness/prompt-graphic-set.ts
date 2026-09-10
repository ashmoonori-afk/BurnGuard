import type { GraphicCanvasV1, GraphicDetailBriefV1, GraphicSetKind, GraphicSetV1 } from "@bg/shared";

const DETAIL_BRIEF_FIELDS = ["persona_pain", "arrival_scene", "mechanism", "evidence", "journey", "risk_reducers", "urgency"] as const;
const QUESTION_ORDER = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "features", "payment_cta"] as const;
const FORBIDDEN_HERO_OPENINGS = ["product name", "brand introduction", "feature slogan", "AI-based", "AI-powered", "fast analysis", "personalized", "all-in-one", "first in Korea"] as const;
/** Facebook Stories keeps roughly 14 percent of a 9:16 frame free of text at top and bottom. */
const STORY_SAFE_ZONE_CSS_PX = { top: 250, bottom: 250 } as const;

type Frame = { readonly sequence: number; readonly width_css_px: number; readonly height_css_px: number; readonly purpose: string; readonly label?: string };

/** Emits the graphic delivery contract and the per-kind authoring rules for a graphic project. */
export function appendGraphicOutputContext(lines: string[], canvas: GraphicCanvasV1, graphicSet: GraphicSetV1): void {
  const frames = buildFrames(canvas, graphicSet);
  const deliveryFormat = graphicSet.frame_count > 1 || graphicSet.kind === "product_detail" ? "png_zip" : "png";
  const safeZone = frames.some((frame) => frame.height_css_px * 9 >= frame.width_css_px * 16) ? { safe_zone_css_px: STORY_SAFE_ZONE_CSS_PX } : {};
  const detail = graphicSet.kind === "product_detail" ? { question_order: QUESTION_ORDER, forbidden_hero_openings: FORBIDDEN_HERO_OPENINGS } : {};
  lines.push("<burnguard-graphic-output-v1>");
  lines.push(JSON.stringify({
    schema_version: 1,
    kind: graphicSet.kind,
    width_css_px: canvas.width,
    height_css_px: canvas.height,
    artboard_count: graphicSet.frame_count,
    frames,
    delivery_format: deliveryFormat,
    ...safeZone,
    ...detail,
  }));
  lines.push("</burnguard-graphic-output-v1>");
  lines.push(`<burnguard-graphic-rules-v1 kind="${graphicSet.kind}">`);
  for (const rule of rulesForKind(graphicSet.kind, canvas)) lines.push(`- ${rule}`);
  if (graphicSet.kind === "product_detail") appendDetailBrief(lines, graphicSet.detail_brief);
  lines.push("</burnguard-graphic-rules-v1>");
  lines.push("- PNG is the export format, not a replacement for index.html. If generating a raster image, save it inside the output directory and reference it from the authored index.html.");
  lines.push("- Do not leave the starter message or a separate unreferenced PNG as the result. BurnGuard publishes the staged files after the turn finishes.");
}

function buildFrames(canvas: GraphicCanvasV1, graphicSet: GraphicSetV1): readonly Frame[] {
  if (graphicSet.kind === "banner_set" && graphicSet.frames !== undefined) {
    return graphicSet.frames.map((frame, index) => ({ sequence: index + 1, width_css_px: frame.width, height_css_px: frame.height, purpose: "banner", label: frame.label }));
  }
  const last = graphicSet.frame_count - 1;
  return Array.from({ length: graphicSet.frame_count }, (_unused, index) => ({
    sequence: index + 1,
    width_css_px: canvas.width,
    height_css_px: canvas.height,
    purpose: graphicSet.kind === "card_news" ? (index === 0 ? "cover" : index === last ? "cta" : "message") : graphicSet.kind,
  }));
}

function rulesForKind(kind: GraphicSetKind, canvas: GraphicCanvasV1): readonly string[] {
  switch (kind) {
    case "single":
    case "thumbnail":
      return [
        `Exact canvas: ${canvas.width} × ${canvas.height} CSS px.`,
        "Author exactly one finite artboard; do not add slides, deck runtime, or a second artboard.",
        "Replace the starter in index.html with the authored fixed-size artboard so the canvas can render the result. Keep exactly one [data-graphic-artboard] element.",
      ];
    case "card_news":
      return [
        `Author exactly ${canvas.width} × ${canvas.height} CSS px per artboard and exactly as many [data-graphic-artboard] sections as artboard_count, in declared order.`,
        "Every artboard is the same size; the first artboard is the cover and the last artboard is the call to action.",
        "One message per artboard: a single claim, no second topic, no continuation of the previous sentence.",
        "When the frame is 9:16, keep the top and bottom 250 CSS px free of text and logos.",
        "Give each artboard the id frame-{sequence}-{purpose} so the exporter keeps the declared order.",
      ];
    case "banner_set":
      return [
        "Author one [data-graphic-artboard] per declared frame size, in declared order, each at its own exact width and height.",
        "Every artboard carries the same single message, with layout and distinct imagery suited to its size. Reuse the same content image across sizes only when explicitly requested by the user.",
        "Keep the message and the call to action inside the artboard even at the smallest size; never let text overflow or clip.",
      ];
    case "print":
      return [
        "Use millimetre-accurate CSS sizes (mm units) for the artboard and mark the bleed area explicitly.",
        "The PDF is RGB. Never claim print-safe, CMYK, or PDF/X colour; state that the print shop converts colour.",
        "Keep critical content inside the safety margin; never place text across the trim line.",
      ];
    case "product_detail":
      return detailRules(canvas);
  }
}

function detailRules(canvas: GraphicCanvasV1): readonly string[] {
  return [
    `Structure: one artboard of exactly ${canvas.width} × ${canvas.height} CSS px; every top-level section is a [data-bg-node-id] block short enough to fit one slice; no position: fixed or sticky; no critical text within 40 px of a section edge.`,
    `Completion: author the entire ${canvas.height} CSS px height in this turn, from the hero through the final CTA/footer. Plan section heights whose sum equals ${canvas.height}; render and inspect top, middle, and bottom before finishing. Do not stop at the hero or a few sections, shorten the requested artboard, or pad the remainder with empty background, a giant spacer, or repeated filler. Redistribute substantive content and imagery across the full height.`,
    "Images: every product-detail section must contain a relevant, visible image by default, including supporting sections and the final CTA. Plan an image and its placement for each section before authoring. Reuse appropriate user-supplied product photos; generate missing imagery exclusively with Codex image generation and reference the saved assets from index.html. Vary crops and compositions; do not substitute CSS shapes, gradients, icons, empty placeholders, or the same repeated photo for section imagery. Omit an image only when there is genuinely no meaningful visual or usable placement, and briefly explain that exception. Never fabricate visual proof, testimonials, or before/after evidence. Inspect that all referenced images actually load before finishing.",
    "Brief editing: treat all detail_brief fields as raw source material, not final display copy. Use the LLM to summarize and polish even a full 500-character field into a concise section headline, supporting copy, and useful captions. Preserve concrete facts, benefits, constraints, and the user's intent; distribute remaining useful detail across the page instead of dumping the raw paragraph or dropping material facts. Do not ask the user to summarize it themselves or invent unsupported claims.",
    "Offer first: before writing any section, restate from detail_brief what the customer receives, which anxieties are removed, and why now. If the brief lacks it, write a marked placeholder and build the page around the offer, not around features.",
    "Hero: open with the persona's pain scene or arrival scene. Never open with the product name, a brand introduction, or a feature slogan such as AI-based, fast analysis, personalized, all-in-one, or first in Korea.",
    "Macro order: hook, evidence, expertise, mechanism, offer, then features last as supporting evidence.",
    "Section blueprint, one section each: Q1 is this for me (the persona's scene); Q2 what do I get (the concrete arrival scene the product can deliver); Q3 why this method (what was wrong with existing approaches and this mechanism); Q4 can I really do it (cases, previews, before/after, a teaser of the delivered screen); Q5 how hard and how long (stages, speed, templates and manuals that cut trial and error); Q6 exactly what do I receive (the journey in order, not an inventory); Q7 what if it fails (refund rule and exact support scope); Q8 why pay now (a concrete urgency device). Then features, then the payment call to action.",
    "Copy: every sentence must answer \"so what is in it for me?\"; translate boasts such as \"20 years of experience\" into the customer's outcome instead of deleting them; list the product composition as benefits, not inventory; make the four value signals (clear result, \"I can do it too\", speed, low effort) each appear at least once; state a difference from existing methods, because without one the customer compares on price only; cut every word the decision does not need; keep promises keepable and emphasize how fast the change starts.",
    "Anxiety placement: at each scroll position name the customer's silent objection and answer it in that same section.",
    "Placeholders: evidence, testimonials, refund terms, and urgency values that are absent from detail_brief are rendered as visibly marked \"supply real data\" placeholders. Never invent numbers, reviews, or refund terms.",
    "Self-review: before finishing, re-read the copy as a suspicious version of the persona and rewrite every sentence that fails the \"so what\" test.",
    "Iteration: limit scope only for an explicitly localized edit. Initial creation, completion requests, and whole-page redesign must finish all sections through the final CTA in one turn; never stop after one region.",
  ];
}

function appendDetailBrief(lines: string[], brief: GraphicDetailBriefV1 | undefined): void {
  if (brief === undefined) return;
  for (const field of DETAIL_BRIEF_FIELDS) {
    const value = brief[field];
    if (value !== undefined) lines.push(`- detail_brief.${field}: ${value}`);
  }
}
