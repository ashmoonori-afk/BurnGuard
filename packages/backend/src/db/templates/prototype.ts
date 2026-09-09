import { escapeHtml } from "./index";

export function renderPrototype(projectName: string): string {
  const title = escapeHtml(projectName);
  return `<!doctype html>
<html lang="en">
<head>
  <link rel="stylesheet" href="fonts/fonts.css">
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    h1, h2, h3 { font-family: "Space Grotesk", "Pretendard", sans-serif; }
    code, pre, .number { font-family: "IBM Plex Mono", "Pretendard", monospace; font-variant-numeric: tabular-nums; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "DM Sans", "Pretendard", sans-serif; background: #f6f1e8; color: #18232d; }
    main { min-height: 100vh; display: grid; place-items: center; padding: clamp(20px, 5vw, 48px); }
    section { width: 100%; min-width: 0; max-width: 920px; overflow-wrap: anywhere; background: #fffdf9; border: 1px solid #e7dece; border-radius: 24px; padding: clamp(24px, 6vw, 56px); box-shadow: 0 20px 60px rgba(24,35,45,0.08); }
    .eyebrow { color: #a84129; text-transform: uppercase; letter-spacing: 0.16em; font-size: 12px; margin-bottom: 20px; }
    h1 { margin: 0; font-size: clamp(32px, 6vw, 52px); line-height: 1.15; letter-spacing: -0.04em; }
    p { margin-top: 20px; font-size: 18px; line-height: 1.7; color: #52616c; }
  </style>
</head>
<body>
  <main>
    <section data-bg-node-id="starter-root">
      <div class="eyebrow">BurnGuard Starter</div>
      <h1 data-bg-node-id="starter-title">Start a new prototype</h1>
      <p data-bg-node-id="starter-copy">Project: ${title}. Send your first prompt in chat to generate the first revision.</p>
    </section>
  </main>
</body>
</html>`;
}
