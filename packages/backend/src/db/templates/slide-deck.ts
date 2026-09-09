import { escapeHtml } from "./index";

export interface SlideDeckOptions {
  use_speaker_notes?: boolean;
}

/**
 * Initial slide deck skeleton. The `<section data-slide>` convention is the
 * shared contract between:
 *   - deck-stage.js runtime (pagination + keyboard nav)      — P2.2
 *   - Claude Code deck-aware prompt builder (SKILL-deck.md)  — P2.3
 *   - PDF/PPTX exporters                                     — P2.7 / P2.8
 *
 * Before the runtime loads, every slide stacks vertically (valid HTML preview).
 * Once the runtime boots it sets `data-deck-ready` on <body>, a CSS rule hides
 * non-active slides, and keyboard nav takes over. This graceful-degradation
 * ordering matters: a canvas that opens the file directly (without Vite/proxy)
 * should still render something readable.
 */
export function renderSlideDeck(
  projectName: string,
  options: SlideDeckOptions,
): string {
  const title = escapeHtml(projectName);
  const useSpeakerNotes = Boolean(options.use_speaker_notes);

  const notesBlock = (body: string) =>
    useSpeakerNotes
      ? `\n      <aside class="deck-notes" data-speaker-notes>${body}</aside>`
      : "";

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
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "DM Sans", "Pretendard", sans-serif;
      background:
        radial-gradient(circle at top right, rgba(224, 107, 76, 0.16), transparent 24%),
        radial-gradient(circle at bottom left, rgba(26, 35, 48, 0.12), transparent 28%),
        linear-gradient(180deg, #f6f1e8 0%, #efe6d8 100%);
      color: #18232d;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image:
        linear-gradient(rgba(24, 35, 45, 0.05) 1px, transparent 1px),
        linear-gradient(90deg, rgba(24, 35, 45, 0.05) 1px, transparent 1px);
      background-size: 32px 32px;
      opacity: 0.45;
    }

    /* Before deck-stage.js boots every slide is visible stacked; after boot,
       body[data-deck-ready] kicks in and only the active slide renders. */
    body[data-deck-ready] .deck-slide:not([data-active]) {
      display: none;
    }
    body[data-deck-ready] .deck-slide {
      position: fixed;
      inset: 0;
    }

    .deck-slide {
      aspect-ratio: 16 / 9;
      width: 100%;
      max-height: 100vh;
      background: #ffffff;
      padding: clamp(24px, 6vw, 64px);
      display: grid;
      place-items: center;
      border-bottom: 1px solid #e7dece;
      box-shadow: 0 24px 60px rgba(24, 35, 45, 0.14);
    }
    .deck-slide > .deck-body {
      min-width: 0;
      overflow-wrap: anywhere;
      max-width: 920px;
      width: 100%;
    }
    .deck-slide.deck-cover {
      background: linear-gradient(180deg, #0b0d12 0%, #1a2330 100%);
      color: #ffffff;
    }
    .deck-slide.deck-closing {
      background: #f6f1e8;
    }
    .eyebrow {
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #a84129;
      margin-bottom: 20px;
    }
    .deck-slide.deck-cover .eyebrow {
      color: rgba(255, 255, 255, 0.7);
    }
    h1, h2 {
      margin: 0;
      letter-spacing: -0.03em;
    }
    h1 { font-size: clamp(32px, 6vw, 64px); line-height: 1.15; }
    h2 { font-size: clamp(28px, 5vw, 44px); line-height: 1.15; }
    p {
      margin-top: 24px;
      font-size: 20px;
      line-height: 1.55;
      color: inherit;
      opacity: 0.85;
    }
    .deck-slide.deck-cover p { color: rgba(255, 255, 255, 0.75); }

    .deck-notes {
      display: block;
      margin-top: 24px;
      padding: 12px 16px;
      border-left: 3px solid #e06b4c;
      background: rgba(224, 107, 76, 0.06);
      font-size: 13px;
      line-height: 1.55;
      color: #52616c;
    }
    body[data-deck-ready] .deck-notes { display: none; }
    body[data-deck-ready][data-presenter] .deck-notes { display: block; }
  </style>
</head>
<body>
  <section data-slide class="deck-slide deck-cover" data-bg-node-id="slide-1">
    <div class="deck-body">
      <div class="eyebrow" data-bg-node-id="slide-1-eyebrow">BurnGuard Deck</div>
      <h1 data-bg-node-id="slide-1-title">${title}</h1>
      <p data-bg-node-id="slide-1-subtitle">Send your first prompt in chat to expand this deck.</p>${notesBlock("Opening cue: introduce the topic and set the stakes.")}
    </div>
  </section>

  <section data-slide class="deck-slide" data-bg-node-id="slide-2">
    <div class="deck-body">
      <div class="eyebrow" data-bg-node-id="slide-2-eyebrow">Section 01</div>
      <h2 data-bg-node-id="slide-2-title">Your first slide</h2>
      <p data-bg-node-id="slide-2-body">Replace this content via chat. Use arrow keys or space to navigate once the deck runtime loads.</p>${notesBlock("Talk through the key point in 30 seconds.")}
    </div>
  </section>

  <section data-slide class="deck-slide deck-closing" data-bg-node-id="slide-3">
    <div class="deck-body">
      <div class="eyebrow" data-bg-node-id="slide-3-eyebrow">Closing</div>
      <h2 data-bg-node-id="slide-3-title">Thanks</h2>
      <p data-bg-node-id="slide-3-body">End of deck. Append more &lt;section data-slide&gt; blocks to grow it.</p>${notesBlock("Invite questions.")}
    </div>
  </section>

  <script src="runtime/deck-stage.js" defer></script>
</body>
</html>`;
}
