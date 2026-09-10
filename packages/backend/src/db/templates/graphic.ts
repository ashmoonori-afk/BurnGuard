import { DEFAULT_GRAPHIC_SET, type GraphicCanvasV1, type GraphicSetV1 } from "@bg/shared";
import { escapeHtml } from "./index";

export function renderGraphic(
  projectName: string,
  canvas: GraphicCanvasV1,
  graphicSet: GraphicSetV1 = DEFAULT_GRAPHIC_SET,
): string {
  const title = escapeHtml(projectName);
  const titleClass = [...projectName].length > 80 ? ' class="long-title"' : "";
  let artboards: string;
  switch (graphicSet.kind) {
    case "product_detail": {
      const sections = [
        ["detail-q1-persona", "Q1 · 고객의 장면", "지금 이 문제를 겪는 고객의 구체적인 순간으로 시작하세요."],
        ["detail-q2-arrival", "Q2 · 도착 장면", "고객이 실제로 얻게 될 결과를 보여주세요."],
        ["detail-q3-mechanism", "Q3 · 해결 방식", "기존 방식의 한계와 이 방식이 해결하는 원리를 설명하세요."],
        ["detail-q4-evidence", "Q4 · 가능한 증거", "실제 사례, 화면, 과정과 검증 가능한 근거를 배치하세요."],
        ["detail-q5-effort", "Q5 · 시간과 수고", "단계, 속도, 시행착오를 줄이는 지원을 설명하세요."],
        ["detail-q6-journey", "Q6 · 제공 여정", "결제 후 받는 경험을 순서대로 보여주세요."],
        ["detail-q7-risk", "Q7 · 위험 줄이기", "환불과 지원 범위에는 실제 정책이 필요합니다."],
        ["detail-q8-urgency", "Q8 · 지금 행동할 이유", "실제 긴급성 정보가 필요합니다."],
        ["detail-features", "구성과 혜택", "제품 구성과 사용자가 얻는 혜택을 정리하세요."],
        ["detail-payment-cta", "마지막 안내", "구매 전 확인 사항과 마지막 행동 안내로 완성하세요."],
      ] as const;
      artboards = `<main data-graphic-artboard id="frame-1-product-detail" style="width:860px;height:${canvas.height}px">${sections.map(([id, heading, copy]) => `<section data-bg-node-id="${id}"><p class="question">${heading}</p><h2>${copy}</h2></section>`).join("")}</main>`;
      break;
    }
    case "banner_set": {
      if (graphicSet.frames === undefined) throw new TypeError("Banner template requires frames");
      artboards = graphicSet.frames.map((frame, index) => `<section data-graphic-artboard id="frame-${index + 1}-banner" style="width:${frame.width}px;height:${frame.height}px"><div class="mark" data-bg-node-id="frame-${index + 1}-mark">${escapeHtml(frame.label)}</div><h1${titleClass} data-bg-node-id="frame-${index + 1}-title">${title}</h1><p data-bg-node-id="frame-${index + 1}-copy">하나의 메시지를 이 배너 규격에 맞게 완성하세요.</p></section>`).join("");
      break;
    }
    case "card_news":
    case "single":
    case "thumbnail":
    case "print":
      artboards = Array.from({ length: graphicSet.frame_count }, (_, index) => {
        const purpose = graphicSet.kind === "card_news" ? index === 0 ? "cover" : index === graphicSet.frame_count - 1 ? "cta" : "message" : "graphic";
        return `<section data-graphic-artboard id="frame-${index + 1}-${purpose}" style="width:${canvas.width}px;height:${canvas.height}px"><div class="mark" data-bg-node-id="frame-${index + 1}-mark">BurnGuard Graphic</div><h1${titleClass} data-bg-node-id="frame-${index + 1}-title">${title}</h1><p data-bg-node-id="frame-${index + 1}-copy">${purpose === "cover" ? "첫 장에서 한 가지 약속을 선명하게 보여주세요." : purpose === "cta" ? "마지막 장에서 다음 행동을 분명하게 안내하세요." : "이 장의 한 가지 메시지를 완성하세요."}</p></section>`;
      }).join("");
      break;
  }
  return `<!doctype html>
<html lang="ko">
<head>
  <link rel="stylesheet" href="fonts/fonts.css">
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    h1, h2, h3 { font-family: "Space Grotesk", "Pretendard", sans-serif; }
    code, pre, .number { font-family: "IBM Plex Mono", "Pretendard", monospace; font-variant-numeric: tabular-nums; }
    :root { color-scheme: light; --page-background: #ffffff; }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-width: ${canvas.width}px; min-height: ${canvas.height}px; background: var(--page-background); }
    body { font-family: "DM Sans", "Pretendard", sans-serif; color: #14213d; }
    [data-graphic-artboard] {
      position: relative;
      overflow: hidden;
      padding: clamp(24px, 7vw, 96px);
      display: grid;
      align-content: end;
      background: var(--page-background);
    }
    [data-graphic-artboard] + [data-graphic-artboard] { margin-top: 32px; }
    .mark { position: absolute; inset: clamp(24px, 7vw, 96px) auto auto clamp(24px, 7vw, 96px); font-size: clamp(12px, 1.4vw, 18px); font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #004fff; }
    h1 { min-width: 0; margin: 0; max-width: min(15ch, 100%); overflow-wrap: anywhere; font-size: clamp(36px, 8vw, 112px); line-height: 1.4; letter-spacing: -0.055em; }
    h1.long-title { max-width: 100%; font-size: clamp(12px, 2vw, 24px); line-height: 1.3; }
    p { margin: clamp(12px, 2vw, 28px) 0 0; max-width: 34em; font-size: clamp(14px, 2vw, 26px); line-height: 1.5; color: #405273; }
    #frame-1-product-detail { padding: 0; display: grid; grid-template-rows: repeat(10, minmax(0, 1fr)); align-content: stretch; }
    #frame-1-product-detail section { min-height: 0; padding: clamp(12px, 4vw, 48px); display: grid; align-content: center; border-bottom: 1px solid rgba(20, 33, 61, 0.15); }
    #frame-1-product-detail h2 { max-width: 18em; font-size: 40px; line-height: 1.35; }
    #frame-1-product-detail .question { color: #004fff; font-weight: 700; }
  </style>
</head>
<body>${artboards}</body>
</html>`;
}
