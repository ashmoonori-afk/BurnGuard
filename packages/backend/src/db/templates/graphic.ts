import type { GraphicCanvasV1 } from "@bg/shared";
import { escapeHtml } from "./index";

export function renderGraphic(
  projectName: string,
  canvas: GraphicCanvasV1,
): string {
  const title = escapeHtml(projectName);
  const titleClass = [...projectName].length > 80 ? ' class="long-title"' : "";
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
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      width: ${canvas.width}px;
      height: ${canvas.height}px;
      overflow: hidden;
    }
    body {
      font-family: "DM Sans", "Pretendard", sans-serif;
      background: #eaf0ff;
      color: #14213d;
    }
    [data-graphic-artboard] {
      position: relative;
      width: ${canvas.width}px;
      height: ${canvas.height}px;
      overflow: hidden;
      padding: clamp(24px, 7vw, 96px);
      display: grid;
      align-content: end;
      background:
        radial-gradient(circle at 82% 18%, rgba(0, 79, 255, 0.28), transparent 26%),
        linear-gradient(145deg, #f8fbff 0%, #dce8ff 100%);
    }
    .mark {
      position: absolute;
      inset: clamp(24px, 7vw, 96px) auto auto clamp(24px, 7vw, 96px);
      font-size: clamp(12px, 1.4vw, 18px);
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #004fff;
    }
    h1 {
      min-width: 0;
      margin: 0;
      max-width: min(15ch, 100%);
      overflow-wrap: anywhere;
      font-size: clamp(36px, 8vw, 112px);
      line-height: 1.4;
      letter-spacing: -0.055em;
    }
    h1.long-title {
      max-width: 100%;
      font-size: clamp(12px, 2vw, 24px);
      line-height: 1.3;
    }
    p {
      margin: clamp(12px, 2vw, 28px) 0 0;
      max-width: 34em;
      font-size: clamp(14px, 2vw, 26px);
      line-height: 1.5;
      color: #405273;
    }
  </style>
</head>
<body>
  <main data-graphic-artboard data-bg-node-id="graphic-artboard">
    <div class="mark" data-bg-node-id="graphic-mark">BurnGuard Graphic</div>
    <h1${titleClass} data-bg-node-id="graphic-title">${title}</h1>
    <p data-bg-node-id="graphic-copy">첫 메시지로 이 한 장의 그래픽을 완성하세요. Start with one clear visual message.</p>
  </main>
</body>
</html>`;
}
