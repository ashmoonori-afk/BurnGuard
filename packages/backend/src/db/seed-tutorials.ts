import { copyBundledFonts } from "../data/bundled-fonts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ulid } from "ulid";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "./client";
import { getSqlite } from "./sqlite-client";
import { ArtifactCoordinator, ArtifactOperationError } from "../services/artifact-coordinator";
import { projectsTable, sessionsTable } from "./schema";
import { projectsDir } from "../lib/paths";
import { DECK_STAGE_JS } from "../runtime/deck-stage";

import { promptSampleDesignSystemId, seedPromptSampleDesignSystem } from "./seed-sample-design-systems";
export { promptSampleDesignSystemId } from "./seed-sample-design-systems";
import { landingSectionStyles, renderLandingSections } from "./sample-landing-sections";

export const TUTORIAL_TAG = "[burnguard:tutorial]";

export const PROTOTYPE_TUTORIAL_NAME = `${TUTORIAL_TAG} Prototype demo`;
export const DECK_TUTORIAL_NAME = `${TUTORIAL_TAG} Slide deck demo`;

export const PROMPT_SAMPLE_TAG = "[burnguard:prompt-sample]";

export interface PromptSample {
  slug: string;
  name: string;
  layout: "split-saas" | "liquid-orb" | "editorial" | "cinematic" | "dashboard";
  eyebrow: string;
  headline: string;
  subhead: string;
  theme: {
    bg: string;
    fg: string;
    muted: string;
    accent: string;
    panel: string;
  };
  prompt: string;
}

export function getPromptSampleBySlug(slug: string): PromptSample | null {
  const sample = PROMPT_SAMPLES.find((s) => s.slug === slug);
  if (!sample) return null;
  return sample.layout === "dashboard" ? sample : { ...sample, prompt: `${sample.prompt}\n\nBuild at least six complete vertical sections: hero, features, workflow, use case, pricing, and FAQ. Use substantive product-specific copy, responsive layouts, and the matching design-system palette. Navigation and footer do not count.` };
}

export const PROMPT_SAMPLES: PromptSample[] = [
  {
    slug: "clearinvoice-static-saas",
    name: `${PROMPT_SAMPLE_TAG} ClearInvoice static SaaS`,
    layout: "split-saas",
    eyebrow: "Static SaaS hero",
    headline: "Manage your online store while saving 3x operating cost.",
    subhead:
      "A dark billing-product landing page that works as a single HTML file with only inline HTML and CSS.",
    theme: {
      bg: "#050505",
      fg: "#ffffff",
      muted: "rgba(255,255,255,0.72)",
      accent: "#ff5b1f",
      panel: "rgba(255,255,255,0.08)",
    },
    prompt: `Build a self-contained single-file HTML/CSS landing page for a billing SaaS called ClearInvoice.

Use only one index.html file. Put all CSS in one <style> tag and avoid external runtime dependencies.

Visual direction:
- Dark background, premium software dashboard mood.
- Add a thin 5px top gradient bar from #ccf through #e7d04c to #31fb78.
- Navigation: logo on the left, links Features / Pricing / Reviews centered, Sign In and Sign Up on the right.
- Hero layout: left copy, right dashboard-style billing card stack.
- Headline: "Manage your online store while saving 3x operating cost."
- Subhead: "ClearInvoice takes the hassle out of billing with easy-to-use tools."
- Primary CTA: orange gradient #FF3300 to #EE7926 with glow and inner stroke.
- Secondary CTA: white glass button.
- Social proof: three overlapping initials and "Trusted by 210k+ stores worldwide".

Use data-bg-node-id on headline, subhead, both CTAs, dashboard card, and social proof so BurnGuard edit mode can target them.`,
  },
  {
    slug: "taskly-liquid-glass",
    name: `${PROMPT_SAMPLE_TAG} Taskly liquid glass`,
    layout: "liquid-orb",
    eyebrow: "White liquid-glass hero",
    headline: "Work smarter, achieve faster",
    subhead:
      "A premium white landing page with a strong liquid-glass navbar, electric blue orb video, social proof, and logo cloud.",
    theme: {
      bg: "#f8fbff",
      fg: "#09111f",
      muted: "rgba(9,17,31,0.64)",
      accent: "#0084ff",
      panel: "rgba(255,255,255,0.72)",
    },
    prompt: `Build a self-contained single-file HTML/CSS landing page for Taskly.

Use only one index.html file. Simulate the "glassy orb" with layered CSS radial gradients and blur.

Core layout:
- White background with layered blue glow in the top-left.
- Max-width 1600px content.
- Responsive two-column desktop layout, single-column mobile layout.

Navbar:
- Sticky centered liquid-glass pill at top 30px.
- Logo "Taskly", links Home / Features / Company / Pricing, and a glassy SignUp button.
- Use backdrop blur, rgba white background, rounded 16px, outer stroke, and inset highlight.

Hero:
- Headline: "Work smarter, achieve faster"
- Subheadline: "Effortlessly manage your projects, collaborate with your team, and achieve your goals with our intuitive task management tool."
- Add a "Rated 4.9/5 by 2700+ customers" badge with five orange stars.
- CTA: "Get Started Now" in translucent electric blue with white circular arrow icon.
- Bottom logo row: "Trusted by Top-tier product companies" plus five grayscale text logos.

Use data-bg-node-id on navbar, headline, CTA, orb, social proof, and logo row.`,
  },
  {
    slug: "mindloop-monochrome",
    name: `${PROMPT_SAMPLE_TAG} Mindloop monochrome`,
    layout: "editorial",
    eyebrow: "Newsletter platform",
    headline: "Mindloop",
    subhead:
      "A pure black monochrome newsletter landing page with liquid glass, serif italic accents, and motion-led storytelling.",
    theme: {
      bg: "#000000",
      fg: "#ffffff",
      muted: "rgba(255,255,255,0.62)",
      accent: "#9aa7a4",
      panel: "rgba(255,255,255,0.045)",
    },
    prompt: `Build a self-contained single-file HTML/CSS landing page for Mindloop, a newsletter and content platform.

Use only one index.html file with inline CSS. Use local/system fonts only.

Theme:
- Pure black background (#000) and white foreground.
- No colorful gradients.
- Editorial monochrome, calm, precise, premium.

Layout:
- Magazine-style asymmetric grid.
- Large title "Mindloop" with one italic accent word in a serif fallback.
- Short description explaining a focused newsletter platform.
- Email capture form with black/white contrast.
- Three editorial cards: "Write", "Curate", "Publish".

Liquid glass:
- Use subtle rgba white panels, backdrop blur, inset highlight, and a thin gradient border mask.

Use data-bg-node-id on headline, accent word, description, email form, and all three cards.`,
  },
  {
    slug: "velorah-cinematic",
    name: `${PROMPT_SAMPLE_TAG} Velorah cinematic hero`,
    layout: "cinematic",
    eyebrow: "Fullscreen video hero",
    headline: "Where dreams rise through the silence.",
    subhead:
      "A cinematic single-page hero with full-screen looping video, glassmorphic navigation, Instrument Serif typography, and minimal overlays.",
    theme: {
      bg: "#002c42",
      fg: "#ffffff",
      muted: "rgba(255,255,255,0.66)",
      accent: "#d7e9f5",
      panel: "rgba(255,255,255,0.055)",
    },
    prompt: `Build a self-contained single-file HTML/CSS landing page for Velorah.

Use only one index.html file with inline CSS and no external JavaScript.

Fonts:
- Use system sans for body.
- Use bundled DM Serif Display with Gowun Batang for Korean cinematic headings; use Pretendard for readable Korean body text. Load fonts/fonts.css and keep local font files with exports.

Navigation:
- Glassmorphic nav over the hero.
- Logo "Velorah" with a small superscript mark.
- Links: Home, Studio, About, Journal, Reach Us.
- CTA: "Begin Journey".

Hero:
- Full viewport hero.
- Use a CSS-only atmospheric background instead of video: dark navy base, soft vertical light beam, film grain via repeating gradients.
- H1: "Where dreams rise through the silence."
- Subtext: "We're designing tools for deep thinkers, bold creators, and quiet rebels. Amid the chaos, we build digital spaces for sharp focus and inspired work."
- CTA: "Begin Journey".

Layout:
- Minimalist, cinematic, vertically centered.
- Avoid decorative blobs. Use the background atmosphere for depth.

Use data-bg-node-id on logo, nav CTA, headline, subtext, and hero CTA.`,
  },
  {
    slug: "daon-korean-saas",
    name: `${PROMPT_SAMPLE_TAG} Daon Korean SaaS landing`,
    layout: "editorial",
    eyebrow: "한국어 SaaS 랜딩",
    headline: "다온",
    subhead:
      "한국 스타트업 풍 SaaS 랜딩 페이지 — 단일 HTML 파일, 한국어 카피, Pretendard 한글 타이포 + 미니멀 monochrome.",
    theme: {
      bg: "#fafafa",
      fg: "#0a0a0a",
      muted: "rgba(10,10,10,0.62)",
      accent: "#1a3aff",
      panel: "rgba(10,10,10,0.04)",
    },
    prompt: `한국 SaaS 스타트업 "다온"의 단일 파일 랜딩 페이지를 만들어줘.

전체 HTML/CSS 를 하나의 index.html 안에 인라인으로 넣고 외부 의존성은 쓰지 마.

브랜드 보이스:
- 다온은 자영업자 / 1인 기업가의 정산·세금·매출 관리를 도와주는 SaaS.
- 톤은 차분하고 신뢰감 있게 — 과장 없이, 숫자와 사실 위주.
- 모든 카피는 한국어. 영문 혼용 최소화.

비주얼 톤:
- 오프-화이트 배경 (#fafafa), 잉크블랙 텍스트 (#0a0a0a).
- 강조 컬러는 액션블루 #1a3aff, 인터랙티브 요소에만.
- 한국어 본문은 Pretendard 또는 시스템 한글 폰트 fallback (Apple SD Gothic Neo, Noto Sans KR).
- 제목은 약간 큰 굵은 무게 (700 이상), 자간 약간 좁게.
- 그라디언트 / 텍스처 / 일러스트레이션은 사용 금지. 여백과 타이포로 만 구성.

구조:
1. 상단 네비 — 좌측 "다온" 워드마크, 가운데 [기능 / 가격 / 고객사례 / 자료실], 우측 [로그인][무료로 시작하기].
2. 히어로 — 왼쪽: 헤드라인 "정산은 다온이, 사장은 매장에." + 서브헤드 "은행 / 카드사 / PG 정산을 자동으로 모으고, 세금까지 한 번에." + CTA [무료로 시작하기] + 보조 CTA [데모 보기]. 오른쪽: 정산 요약 카드 mockup (이번 달 정산 / 예상 세금 / 카드사별 수수료).
3. 사회적 증거 한 줄 — "전국 12,400+ 자영업자가 다온을 쓰고 있어요." (숫자는 변경 가능)
4. 기능 3카드 — "정산 자동 매핑", "세금 1-탭 신고", "매장별 손익 대시보드".
5. 가격 — 무료 / 프로 (월 19,000원) / 비즈니스 (월 49,000원) 3티어, 한국 원화 표기.
6. CTA 밴드 — "지금 시작하면 첫 30일 무료" + 가입 버튼.
7. 푸터 — 회사 정보, 사업자등록번호 (placeholder), 개인정보처리방침, 이용약관.

모든 가시 텍스트 요소에 data-bg-node-id 부여 (예: data-bg-node-id="hero-headline"), BurnGuard Edit 모드에서 바로 잡을 수 있게.`,
  },
  {
    slug: "pulse-fund-ops-dashboard",
    name: `${PROMPT_SAMPLE_TAG} Pulse fund-ops dashboard`,
    layout: "dashboard",
    eyebrow: "Admin / analytics dashboard",
    headline: "Pulse · Fund operations console",
    subhead:
      "An institutional fund-ops dashboard — KPI tiles, holdings table, recent activity feed, and a sidebar navigation. Single HTML file, no external scripts.",
    theme: {
      bg: "#0e1117",
      fg: "#f5f7fb",
      muted: "rgba(245,247,251,0.62)",
      accent: "#3b82f6",
      panel: "#161b24",
    },
    prompt: `Build a self-contained single-file HTML/CSS dashboard for an institutional fund-operations console called Pulse.

Use only one index.html with inline CSS. No external scripts, no frameworks.

Genre: this is NOT a marketing landing page. It's an internal admin / analytics dashboard the operations team would actually use.

Layout shell:
- Dark editorial palette: background #0e1117, surface #161b24, text #f5f7fb, accent #3b82f6, success #2f7a4f, danger #b03a3a.
- Tabular numerals everywhere a number can be compared (font-feature-settings: 'tnum').
- 240px fixed left sidebar with the brand "Pulse", a list of nav items (Overview / Holdings / Reconciliation / Cash / Reports / Settings), and a small user pill at the bottom.
- Top bar: page title on the left ("Overview · April 25, 2026"), a date-range selector pill in the middle, and a small avatar + status dot on the right.

Content of the Overview page:
1. Four KPI tiles in a single row — "AUM under advisement", "Net management margin (TTM)", "Open reconciliation breaks", "Cash buffer (90d)". Each tile shows the headline number, a delta vs. last period with an arrow and "improved" / "worsened" text in addition to green/red, and a 1-line label. Use mock numbers consistent with the Series A / quarterly review samples (AUM ~ $1.21B, margin ~ 2.39%, breaks ~ 7, cash buffer ~ 36 months).
2. A "Top holdings" table — 6 rows. Columns: Position, Strategy, Quarter return, MTD, AUM share. Use mixed positive / negative quarter returns coloured green / red.
3. A "Recent activity" feed on the right — 5 items (e.g., "Reconciliation break #112 cleared by ops · 14 minutes ago", "Trade ticket NVC-2841 settled · 1 hour ago", etc.) with timestamp.
4. Footer line: small print, "Sample dashboard artifact in BurnGuard. Numbers are illustrative."

Hover and focus states:
- Sidebar items hover to a slightly lighter surface.
- Table rows hover to highlight subtly.
- KPI tiles use a 1px accent left border on hover.

Accessibility:
- Real semantic HTML (<nav>, <main>, <table>, <thead>, <tbody>, <th scope="col">).
- Sufficient contrast on muted text.
- Reflow at 320 CSS pixels; keep the comparison table as a bounded horizontal-scroll exception.
- Respect prefers-reduced-motion and keep pointer targets at least 24 by 24 CSS pixels or equivalently spaced.

Use data-bg-node-id on the page title, every KPI tile (parent + value + delta + label), every table row (parent + cells), and every activity feed item.`,
  },
];

/**
 * Fixed HTML for the prototype tutorial. A single-page artifact that renders
 * end-to-end through the html_zip export and mirrors what a Phase 1 prompt
 * might produce. Kept self-contained — no external fonts or scripts — so
 * the offline export works verbatim.
 */
export const PROTOTYPE_TUTORIAL_HTML = `<!doctype html>
<html lang="en">
<head>
<link rel="stylesheet" href="fonts/fonts.css">
  <meta charset="utf-8">
  <title>Prototype tutorial</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { color-scheme: light; --ink: #111827; --accent: #b74328; }
    body {
      margin: 0;
      font-family: "DM Sans", "Pretendard", system-ui, sans-serif;
      background: #FAFAF7;
      color: var(--ink);
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 48px;
    }
    main { max-width: 640px; text-align: center; }
    .eyebrow {
      color: var(--accent);
      font-size: 12px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 48px;
      line-height: 1.05;
      letter-spacing: -0.02em;
      margin: 0 0 16px;
    }
    p { font-size: 16px; line-height: 1.6; color: #4B5563; }
    .cta {
      display: inline-block;
      margin-top: 24px;
      padding: 10px 18px;
      background: var(--ink);
      color: white;
      border-radius: 999px;
      text-decoration: none;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow" data-bg-node-id="eyebrow">BurnGuard tutorial</div>
    <h1 data-bg-node-id="headline">Edit this headline in Edit mode.</h1>
    <p data-bg-node-id="body">This prototype artifact ships with every fresh install so you can try comment, edit, and export without waiting on a CLI turn.</p>
    <a class="cta" href="#" data-bg-node-id="cta">Try the canvas</a>
  </main>
</body>
</html>
`;

/**
 * Fixed HTML for the slide-deck tutorial. Three slides matching the
 * `[data-slide]` contract so deck-stage activates it and PDF/PPTX export
 * iterate over real content. Runtime script path is relative on purpose
 * (not `/runtime/deck-stage.js`) so offline staging works without the
 * exporter rewriting it.
 */
export const DECK_TUTORIAL_HTML = `<!doctype html>
<html lang="en">
<head>
<link rel="stylesheet" href="fonts/fonts.css">
  <meta charset="utf-8">
  <title>Deck tutorial</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { color-scheme: dark; --ink: #F5F5F7; --accent: #E06B4C; }
    body {
      margin: 0;
      background: #101318;
      color: var(--ink);
      font-family: "DM Sans", "Pretendard", system-ui, sans-serif;
    }
    body[data-deck-ready] .deck-slide:not([data-active]) {
      display: none;
    }
    body[data-deck-ready] .deck-slide {
      display: grid;
      place-items: center;
      min-height: 100vh;
      padding: 48px;
      text-align: center;
    }
    .deck-slide h1 {
      font-size: 96px;
      line-height: 1;
      letter-spacing: -0.02em;
      margin: 0 0 16px;
    }
    .deck-slide h2 {
      font-size: 56px;
      line-height: 1.05;
      margin: 0 0 12px;
      color: var(--accent);
    }
    .deck-slide p {
      font-size: 20px;
      line-height: 1.6;
      color: rgba(245,245,247,0.75);
      max-width: 720px;
    }
    .eyebrow {
      color: var(--accent);
      font-size: 12px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      margin-bottom: 24px;
    }
  </style>
</head>
<body>
  <section data-slide class="deck-slide" data-bg-node-id="slide-1">
    <div>
      <div class="eyebrow" data-bg-node-id="slide-1-eyebrow">BurnGuard tutorial</div>
      <h1 data-bg-node-id="slide-1-title">Ship decks faster.</h1>
      <p data-bg-node-id="slide-1-body">Three slides, editable in-place. Try arrow keys to navigate.</p>
    </div>
  </section>
  <section data-slide class="deck-slide" data-bg-node-id="slide-2">
    <div>
      <h2 data-bg-node-id="slide-2-title">What just happened?</h2>
      <p data-bg-node-id="slide-2-body">The runtime script toggles <code>data-active</code> on one slide at a time. PDF and PPTX export override that gate so every slide prints.</p>
    </div>
  </section>
  <section data-slide class="deck-slide" data-bg-node-id="slide-3">
    <div>
      <h2 data-bg-node-id="slide-3-title">Try exporting.</h2>
      <p data-bg-node-id="slide-3-body">Open the Export menu and pick HTML zip, PDF, or PowerPoint. PDF and PPTX need a Chromium install — Settings has a one-click button.</p>
    </div>
  </section>
  <script src="runtime/deck-stage.js"></script>
</body>
</html>
`;

/**
 * Creates the two built-in tutorial projects if they aren't already in the
 * DB. Idempotent — matches by the tagged name so a manually-deleted tutorial
 * won't be recreated (the user owns it once they've touched it).
 */
export async function seedTutorialsOnce(): Promise<void> {
  const db = getDb();
  const existing = await db
    .select({
      id: projectsTable.id,
      name: projectsTable.name,
      dirPath: projectsTable.dirPath,
      entrypoint: projectsTable.entrypoint,
      currentRevision: projectsTable.currentRevision,
      currentDigest: projectsTable.currentDigest,
    })
    .from(projectsTable);
  const now = Date.now();
  const currentPromptSampleNames = new Set(
    PROMPT_SAMPLES.map((sample) => sample.name),
  );
  const existingByName = new Map(existing.map((row) => [row.name, row]));
  for (const row of existing) {
    if (
      row.name.startsWith(PROMPT_SAMPLE_TAG) &&
      !currentPromptSampleNames.has(row.name)
    ) {
      await db
        .update(projectsTable)
        .set({ archivedAt: now, updatedAt: now })
        .where(eq(projectsTable.name, row.name));
    }
  }

  const existingPrototype = existingByName.get(PROTOTYPE_TUTORIAL_NAME);
  if (existingPrototype) {
    await copyBundledFonts(existingPrototype.dirPath);
  } else {
    await writeTutorialProject({
      name: PROTOTYPE_TUTORIAL_NAME,
      type: "prototype",
      entrypoint: "index.html",
      html: PROTOTYPE_TUTORIAL_HTML,
    });
  }
  const existingDeck = existingByName.get(DECK_TUTORIAL_NAME);
  if (existingDeck) {
    await copyBundledFonts(existingDeck.dirPath);
  } else {
    await writeTutorialProject({
      name: DECK_TUTORIAL_NAME,
      type: "slide_deck",
      entrypoint: "deck.html",
      html: DECK_TUTORIAL_HTML,
    });
  }
  for (const sample of PROMPT_SAMPLES) {
    await seedPromptSampleDesignSystem(sample, renderPromptSampleHtml(sample));
    const existingSample = existingByName.get(sample.name);
    if (existingSample) {
      await syncPromptSampleProject({
        id: existingSample.id,
        name: sample.name,
        dirPath: existingSample.dirPath,
        entrypoint: existingSample.entrypoint,
        html: renderPromptSampleHtml(sample),
        currentRevision: existingSample.currentRevision,
        currentDigest: existingSample.currentDigest,
      });
      await db.update(projectsTable).set({ designSystemId: promptSampleDesignSystemId(sample.slug) }).where(and(eq(projectsTable.id, existingSample.id), isNull(projectsTable.designSystemId)));
      continue;
    }
    await writeTutorialProject({
      name: sample.name,
      designSystemId: promptSampleDesignSystemId(sample.slug),
      type: "from_template",
      entrypoint: "index.html",
      html: renderPromptSampleHtml(sample),
    });
  }
}

export function renderPromptSampleHtml(sample: PromptSample): string {
  switch (sample.layout) {
    case "split-saas":
      return renderSplitSaasSample(sample);
    case "liquid-orb":
      return renderLiquidOrbSample(sample);
    case "editorial":
      return renderEditorialSample(sample);
    case "cinematic":
      return renderCinematicSample(sample);
    case "dashboard":
      return renderDashboardSample(sample);
  }
}

function renderSplitSaasSample(sample: PromptSample): string {
  return renderPromptSampleDocument({
    sample,
    colorScheme: "dark",
    styles: `
    body {
      margin: 0;
      min-height: 100vh;
      background: #050505;
      color: var(--fg);
      font-family: "DM Sans", "Pretendard", system-ui, sans-serif;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0 0 auto;
      height: 5px;
      background: linear-gradient(90deg, #ccf, #e7d04c, #31fb78);
      z-index: 5;
    }
    .page { width: min(1220px, calc(100vw - 40px)); margin: 0 auto; padding: 38px 0; }
    .topbar { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 20px; margin-bottom: 68px; }
    .brand { font-weight: 800; letter-spacing: -0.04em; }
    .links { display: flex; gap: 22px; color: var(--muted); font-size: 13px; }
    .auth { justify-self: end; display: flex; gap: 10px; }
    .pill { border: 1px solid var(--line); border-radius: 999px; padding: 10px 15px; background: rgba(255,255,255,0.06); color: var(--fg); text-decoration: none; }
    .pill.hot { background: linear-gradient(135deg, #ff3300, #ee7926); box-shadow: 0 18px 42px rgba(255,91,31,0.34); }
    .hero { display: grid; grid-template-columns: 0.92fr 1.08fr; gap: 42px; align-items: center; }
    .copy h1 { margin: 16px 0 18px; max-width: 650px; font-size: clamp(50px, 7vw, 92px); line-height: 0.9; letter-spacing: -0.075em; }
    .eyebrow { color: var(--accent); font-size: 12px; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase; }
    .subhead { max-width: 520px; color: var(--muted); font-size: 18px; line-height: 1.7; }
    .actions { display: flex; flex-wrap: wrap; gap: 12px; margin: 30px 0; }
    .avatars { display: flex; align-items: center; gap: 14px; color: var(--muted); }
    .avatar-stack { display: flex; }
    .avatar { display: grid; place-items: center; width: 38px; height: 38px; margin-right: -10px; border: 2px solid #050505; border-radius: 50%; background: var(--fg); color: #050505; font-weight: 800; }
    .dashboard { position: relative; min-height: 520px; border: 1px solid var(--line); border-radius: 34px; padding: 24px; background: radial-gradient(circle at 20% 0%, rgba(255,91,31,0.24), transparent 28rem), rgba(255,255,255,0.055); box-shadow: 0 30px 110px rgba(0,0,0,0.55); overflow: hidden; }
    .invoice-card { position: absolute; inset: 52px 36px auto auto; width: min(420px, 76%); border: 1px solid rgba(255,255,255,0.18); border-radius: 28px; padding: 26px; background: rgba(14,14,14,0.78); backdrop-filter: blur(22px); box-shadow: 0 26px 70px rgba(0,0,0,0.38); }
    .row { display: flex; justify-content: space-between; gap: 20px; padding: 14px 0; border-bottom: 1px solid rgba(255,255,255,0.08); color: var(--muted); }
    .total { margin-top: 20px; font-size: 42px; font-weight: 900; letter-spacing: -0.05em; }
    .float-card { position: absolute; left: 28px; bottom: 46px; width: 260px; border-radius: 24px; padding: 20px; background: #fff; color: #111; box-shadow: 0 28px 70px rgba(0,0,0,0.35); }
    .bar { height: 10px; margin-top: 14px; border-radius: 999px; background: linear-gradient(90deg, #ff3300 72%, #e8e8e8 72%); }
    .info { display: grid; grid-template-columns: 0.62fr 1fr; gap: 18px; margin-top: 36px; }
    ${commonInfoStyles()}
    @media (max-width: 900px) { .topbar, .hero, .info { grid-template-columns: 1fr; } .links { flex-wrap: wrap; } .auth { justify-self: start; } .dashboard { min-height: 430px; } .invoice-card { position: relative; inset: auto; width: 100%; } .float-card { position: relative; left: auto; bottom: auto; margin-top: 18px; } }
    `,
    body: `
    <main class="page">
      <nav class="topbar" data-bg-node-id="sample-navbar">
        <div class="brand">ClearInvoice</div>
        <div class="links"><span>Features</span><span>Pricing</span><span>Reviews</span></div>
        <div class="auth"><a class="pill" href="#">Sign In</a><a class="pill hot" href="#" data-bg-node-id="sample-nav-cta">Sign Up</a></div>
      </nav>
      <section class="hero">
        <div class="copy">
          <div class="eyebrow" data-bg-node-id="sample-eyebrow">${escapeHtml(sample.eyebrow)}</div>
          <h1 data-bg-node-id="sample-headline">${escapeHtml(sample.headline)}</h1>
          <p class="subhead" data-bg-node-id="sample-subhead">${escapeHtml(sample.subhead)}</p>
          <div class="actions"><a class="pill hot" href="#" data-bg-node-id="sample-primary-cta">Start billing</a><a class="pill" href="#prompt" data-bg-node-id="sample-secondary-cta">View prompt</a></div>
          <div class="avatars" data-bg-node-id="sample-social-proof"><span class="avatar-stack"><span class="avatar">A</span><span class="avatar">J</span><span class="avatar">M</span></span><span>Trusted by 210k+ stores worldwide</span></div>
        </div>
        <div class="dashboard" data-bg-node-id="sample-dashboard-card">
          <div class="invoice-card"><div class="row"><span>Invoice volume</span><strong>$84,219</strong></div><div class="row"><span>Automation saved</span><strong>312 hrs</strong></div><div class="row"><span>Failed payments</span><strong>1.8%</strong></div><div class="total">3x lower ops cost</div></div>
          <div class="float-card"><strong>Realtime reconciliation</strong><p>Payments, invoices, and disputes stay aligned without extra headcount.</p><div class="bar"></div></div>
        </div>
      </section>
      <section class="info">${renderUsageCard()}${renderPromptCard(sample)}</section>
    </main>
    `,
  });
}

function renderLiquidOrbSample(sample: PromptSample): string {
  return renderPromptSampleDocument({
    sample,
    colorScheme: "light",
    styles: `
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 12% 0%, rgba(96,177,255,0.36), transparent 34rem), #f8fbff; color: #09111f; font-family: "DM Sans", "Pretendard", system-ui, sans-serif; }
    .page { width: min(1600px, calc(100vw - 40px)); margin: 0 auto; padding: 30px 0 46px; }
    .nav { position: sticky; top: 30px; z-index: 3; width: fit-content; margin: 0 auto 96px; display: flex; align-items: center; gap: 28px; padding: 12px 14px 12px 20px; border: 1px solid rgba(255,255,255,0.72); border-radius: 16px; background: rgba(255,255,255,0.36); backdrop-filter: blur(36px); box-shadow: inset 0 1px 0 rgba(255,255,255,0.9), 0 18px 70px rgba(0,132,255,0.13); }
    .brand { font-weight: 900; letter-spacing: -0.05em; }
    .links { display: flex; gap: 20px; color: rgba(9,17,31,0.62); font-size: 13px; }
    .signup, .cta { border: 1px solid rgba(0,132,255,0.2); border-radius: 999px; background: rgba(0,132,255,0.78); color: #fff; text-decoration: none; font-weight: 800; }
    .signup { padding: 10px 15px; }
    .hero { display: grid; grid-template-columns: 0.92fr 1.08fr; align-items: center; gap: 20px; min-height: 610px; }
    .badge { width: fit-content; border: 1px solid rgba(9,17,31,0.08); border-radius: 999px; padding: 9px 13px; background: rgba(255,255,255,0.64); box-shadow: 0 12px 40px rgba(0,0,0,0.05); color: rgba(9,17,31,0.72); }
    .stars { color: #ff8a00; letter-spacing: 0.08em; }
    h1 { margin: 24px 0 18px; max-width: 640px; font-size: clamp(56px, 8vw, 118px); line-height: 0.92; letter-spacing: -0.08em; }
    .subhead { max-width: 620px; color: rgba(9,17,31,0.64); font-size: 19px; line-height: 1.7; }
    .cta { display: inline-flex; align-items: center; gap: 13px; margin-top: 30px; padding: 15px 18px 15px 22px; box-shadow: 0 18px 44px rgba(0,132,255,0.25); }
    .arrow { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: #fff; color: #0061bd; }
    .orb-wrap { display: grid; place-items: center; min-height: 560px; }
    .orb { width: min(560px, 82vw); aspect-ratio: 1; border-radius: 50%; background: radial-gradient(circle at 34% 25%, #fff 0 8%, rgba(255,255,255,0.1) 18%), radial-gradient(circle at 58% 32%, #74d7ff, transparent 23%), radial-gradient(circle at 42% 64%, #725cff, transparent 28%), radial-gradient(circle at 68% 68%, #00a3ff, transparent 26%), radial-gradient(circle, rgba(255,255,255,0.7), rgba(0,132,255,0.28) 58%, transparent 72%); filter: saturate(1.35) contrast(1.05); box-shadow: 0 50px 130px rgba(0,132,255,0.22), inset -30px -40px 80px rgba(0,43,155,0.22); }
    .logos { margin-top: 34px; padding: 24px 0 0; border-top: 1px solid rgba(9,17,31,0.08); color: rgba(9,17,31,0.48); }
    .logo-row { display: flex; flex-wrap: wrap; gap: 28px; margin-top: 14px; font-weight: 900; filter: grayscale(1); opacity: 0.64; }
    .info { display: grid; grid-template-columns: 1fr 1.4fr; gap: 18px; margin-top: 50px; }
    ${commonInfoStyles("light")}
    @media (max-width: 900px) { .nav, .links { flex-wrap: wrap; } .hero, .info { grid-template-columns: 1fr; } .nav { width: auto; } }
    `,
    body: `
    <main class="page">
      <nav class="nav" data-bg-node-id="sample-navbar"><span class="brand">Taskly</span><span class="links"><span>Home</span><span>Features</span><span>Company</span><span>Pricing</span></span><a class="signup" href="#">SignUp</a></nav>
      <section class="hero">
        <div>
          <div class="badge" data-bg-node-id="sample-social-proof"><span class="stars">*****</span> Rated 4.9/5 by 2700+ customers</div>
          <h1 data-bg-node-id="sample-headline">${escapeHtml(sample.headline)}</h1>
          <p class="subhead" data-bg-node-id="sample-subhead">${escapeHtml(sample.subhead)}</p>
          <a class="cta" href="#" data-bg-node-id="sample-primary-cta">Get Started Now <span class="arrow">-&gt;</span></a>
        </div>
        <div class="orb-wrap"><div class="orb" data-bg-node-id="sample-orb"></div></div>
      </section>
      <section class="logos" data-bg-node-id="sample-logo-row"><span>Trusted by Top-tier product companies</span><div class="logo-row"><span>Northstar</span><span>Arc Labs</span><span>Flux</span><span>Vesta</span><span>Kinfolk</span></div></section>
      <section class="info">${renderUsageCard()}${renderPromptCard(sample)}</section>
    </main>
    `,
  });
}

function renderEditorialSample(sample: PromptSample): string {
  const korean = sample.slug === "daon-korean-saas";
  return renderPromptSampleDocument({
    sample,
    colorScheme: "dark",
    styles: `
    body { margin: 0; min-height: 100vh; background: #000; color: #fff; font-family: "DM Sans", "Pretendard", system-ui, sans-serif; }
    .page { width: min(1180px, calc(100vw - 38px)); margin: 0 auto; padding: 54px 0; }
    .masthead { display: flex; justify-content: space-between; gap: 20px; padding-bottom: 24px; border-bottom: 1px solid rgba(255,255,255,0.14); color: rgba(255,255,255,0.62); font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; }
    .grid { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 28px; margin-top: 46px; }
    h1 { margin: 0; font-size: clamp(72px, 14vw, 180px); line-height: 0.82; letter-spacing: -0.095em; }
    .accent-word { display: block; margin-top: 10px; font-family: "DM Serif Display", "Gowun Batang", Georgia, serif; font-style: italic; font-weight: 400; letter-spacing: -0.07em; color: rgba(255,255,255,0.76); }
    .desc { max-width: 580px; margin: 36px 0 0; color: rgba(255,255,255,0.64); font-size: 19px; line-height: 1.75; }
    .signup { display: flex; gap: 10px; max-width: 520px; margin-top: 34px; padding: 8px; border: 1px solid rgba(255,255,255,0.16); border-radius: 999px; background: rgba(255,255,255,0.045); backdrop-filter: blur(18px); }
    .signup span { flex: 1; color: rgba(255,255,255,0.5); padding: 13px 16px; }
    .signup button { border: 0; border-radius: 999px; padding: 0 20px; background: #fff; color: #000; font-weight: 900; }
    .cards { display: grid; gap: 14px; align-self: end; }
    .feature { position: relative; border: 1px solid rgba(255,255,255,0.14); border-radius: 28px; padding: 26px; background: rgba(255,255,255,0.045); box-shadow: inset 0 1px 0 rgba(255,255,255,0.12); }
    .feature::before { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; background: linear-gradient(135deg, rgba(255,255,255,0.18), transparent 38%); mask: linear-gradient(#000, transparent); }
    .feature strong { display: block; margin-bottom: 12px; font-size: 22px; }
    .feature p { margin: 0; color: rgba(255,255,255,0.58); line-height: 1.65; }
    .info { display: grid; grid-template-columns: 0.8fr 1.2fr; gap: 18px; margin-top: 44px; }
    ${commonInfoStyles()}
    @media (max-width: 900px) { .grid, .info { grid-template-columns: 1fr; } .signup { border-radius: 24px; flex-direction: column; } .signup button { min-height: 44px; } }
    `,
    body: `
    <main class="page">
      <header class="masthead"><span>${escapeHtml(sample.eyebrow)}</span><span>Prompt sample / no framework</span></header>
      <section class="grid">
        <div>
          <h1 data-bg-node-id="sample-headline">${escapeHtml(sample.headline)}<span class="accent-word" data-bg-node-id="sample-accent-word">${korean ? "정산은 다온이, 사장은 매장에." : "for focused publishing"}</span></h1>
          <p class="desc" data-bg-node-id="sample-description">${escapeHtml(sample.subhead)}</p>
          <form class="signup" data-bg-node-id="sample-email-form"><span>you@example.com</span><button type="button">${korean ? "무료로 시작하기" : "Join the loop"}</button></form>
        </div>
        <div class="cards">
          <article class="feature" data-bg-node-id="sample-card-write"><strong>${korean ? "정산 내역 확인" : "Write"}</strong><p>${korean ? "입금 예정 금액과 실제 내역을 한 화면에서 비교해요." : "Draft issues in a quiet interface that keeps structure visible and noise out."}</p></article>
          <article class="feature" data-bg-node-id="sample-card-curate"><strong>${korean ? "수수료 검토" : "Curate"}</strong><p>${korean ? "예상과 다른 항목만 모아 차근차근 확인해요." : "Collect links, notes, and references into one editorial queue."}</p></article>
          <article class="feature" data-bg-node-id="sample-card-publish"><strong>${korean ? "월간 자료 공유" : "Publish"}</strong><p>${korean ? "정산 내역을 내려받아 담당자에게 전달해요." : "Send polished newsletters with a deliberate cadence and clean archive."}</p></article>
        </div>
      </section>
      <section class="info">${renderUsageCard()}${renderPromptCard(sample)}</section>
    </main>
    `,
  });
}

function renderCinematicSample(sample: PromptSample): string {
  return renderPromptSampleDocument({
    sample,
    colorScheme: "dark",
    styles: `
    body { margin: 0; min-height: 100vh; color: #fff; background: #002c42; font-family: "DM Sans", "Pretendard", system-ui, sans-serif; }
    .hero { position: relative; min-height: 100vh; display: grid; place-items: center; overflow: hidden; padding: 28px; }
    .hero::before { content: ""; position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 0%, rgba(215,233,245,0.28), transparent 34%), linear-gradient(90deg, rgba(0,0,0,0.54), transparent 32%, transparent 68%, rgba(0,0,0,0.44)), linear-gradient(180deg, rgba(0,44,66,0.1), #00131e); }
    .hero::after { content: ""; position: absolute; inset: 0; opacity: 0.16; background-image: repeating-linear-gradient(0deg, rgba(255,255,255,0.12) 0 1px, transparent 1px 5px); mix-blend-mode: overlay; pointer-events: none; }
    .nav { position: absolute; top: 28px; left: 50%; z-index: 2; transform: translateX(-50%); width: min(1120px, calc(100vw - 42px)); display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 14px 18px; border: 1px solid rgba(255,255,255,0.18); border-radius: 999px; background: rgba(255,255,255,0.08); backdrop-filter: blur(20px); }
    .logo { font-family: "DM Serif Display", "Gowun Batang", Georgia, serif; font-size: 24px; letter-spacing: -0.04em; }
    .logo sup { font-size: 12px; color: rgba(255,255,255,0.58); }
    .links { display: flex; gap: 22px; color: rgba(255,255,255,0.66); font-size: 13px; }
    .journey { justify-self: end; border: 1px solid rgba(255,255,255,0.24); border-radius: 999px; padding: 10px 16px; color: #fff; background: rgba(255,255,255,0.08); text-decoration: none; }
    .copy { position: relative; z-index: 1; width: min(960px, 100%); text-align: center; padding-top: 74px; }
    h1 { margin: 0 auto; max-width: 950px; font-family: "DM Serif Display", "Gowun Batang", Georgia, serif; font-weight: 400; font-size: clamp(62px, 10vw, 150px); line-height: 0.9; letter-spacing: -0.075em; text-wrap: balance; }
    .subtext { max-width: 720px; margin: 28px auto 0; color: rgba(255,255,255,0.72); font-size: 18px; line-height: 1.75; }
    .hero-cta { display: inline-flex; margin-top: 34px; border: 1px solid rgba(255,255,255,0.26); border-radius: 999px; padding: 14px 20px; color: #002c42; background: rgba(255,255,255,0.86); text-decoration: none; font-weight: 900; }
    .info { position: relative; z-index: 1; width: min(1120px, calc(100vw - 42px)); margin: -120px auto 54px; display: grid; grid-template-columns: 0.78fr 1.22fr; gap: 18px; }
    ${commonInfoStyles()}
    @media (max-width: 900px) { .nav { position: relative; top: auto; left: auto; transform: none; grid-template-columns: 1fr; gap: 12px; border-radius: 24px; } .links { flex-wrap: wrap; } .journey { justify-self: start; } .info { grid-template-columns: 1fr; margin-top: -40px; } }
    `,
    body: `
    <main class="hero">
      <nav class="nav" data-bg-node-id="sample-navbar"><span class="logo" data-bg-node-id="sample-logo">Velorah<sup>01</sup></span><span class="links"><span>Home</span><span>Studio</span><span>About</span><span>Journal</span><span>Reach Us</span></span><a class="journey" href="#" data-bg-node-id="sample-nav-cta">Begin Journey</a></nav>
      <section class="copy"><h1 data-bg-node-id="sample-headline">${escapeHtml(sample.headline)}</h1><p class="subtext" data-bg-node-id="sample-subtext">${escapeHtml(sample.subhead)}</p><a class="hero-cta" href="#" data-bg-node-id="sample-hero-cta">Begin Journey</a></section>
    </main>
    <section class="info">${renderUsageCard()}${renderPromptCard(sample)}</section>
    `,
  });
}

function renderDashboardSample(sample: PromptSample): string {
  return renderPromptSampleDocument({
    sample,
    colorScheme: "dark",
    styles: `
    body { margin: 0; min-height: 100vh; color: #f5f7fb; background: #0e1117; font-family: "DM Sans", "Pretendard", system-ui, sans-serif; font-feature-settings: 'tnum'; }
    .shell { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }
    .sidebar { background: #0a0d12; border-right: 1px solid rgba(255,255,255,0.06); padding: 24px 16px; display: flex; flex-direction: column; }
    .brand { font-weight: 800; font-size: 20px; letter-spacing: -0.02em; margin-bottom: 28px; padding: 0 8px; }
    .brand .dot { display: inline-block; width: 8px; height: 8px; background: #3b82f6; border-radius: 50%; margin-right: 8px; vertical-align: middle; }
    .nav-item { display: block; padding: 10px 12px; color: rgba(245,247,251,0.62); border-radius: 6px; font-size: 14px; text-decoration: none; margin-bottom: 2px; }
    .nav-item.active { color: #f5f7fb; background: #161b24; }
    .nav-item:hover { background: rgba(255,255,255,0.04); color: #f5f7fb; }
    .user-pill { margin-top: auto; padding: 10px 12px; background: #161b24; border-radius: 8px; font-size: 13px; display: flex; align-items: center; gap: 10px; }
    .avatar { color: #071b39; width: 28px; height: 28px; border-radius: 50%; background: #3b82f6; display: grid; place-items: center; font-weight: 700; font-size: 12px; }
    main { padding: 24px 32px; }
    .topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 28px; }
    .page-title { font-size: 24px; font-weight: 700; letter-spacing: -0.01em; }
    .date-pill { background: #161b24; padding: 8px 14px; border-radius: 999px; font-size: 13px; color: rgba(245,247,251,0.62); border: 1px solid rgba(255,255,255,0.06); }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 28px; }
    .kpi { background: #161b24; padding: 20px; border-radius: 10px; border-left: 1px solid transparent; transition: border-color 120ms; }
    .kpi:hover { border-left-color: #3b82f6; }
    .kpi .num { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; }
    .kpi .delta { font-size: 13px; margin: 6px 0; }
    .kpi .delta.up { color: #4ad07c; }
    .kpi .delta.down { color: #ff7a85; }
    .kpi .label { font-size: 12px; color: rgba(245,247,251,0.55); }
    .panels { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; margin-bottom: 28px; }
    .panel { background: #161b24; border-radius: 10px; padding: 20px; }
    .table-panel { overflow-x: auto; }
    .panel h3 { margin: 0 0 16px; font-size: 14px; font-weight: 600; color: rgba(245,247,251,0.78); text-transform: uppercase; letter-spacing: 0.08em; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 10px 0; color: rgba(245,247,251,0.55); border-bottom: 1px solid rgba(255,255,255,0.06); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
    td { padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
    tr:hover td { background: rgba(255,255,255,0.02); }
    .num-col { text-align: right; }
    .up { color: #4ad07c; }
    .down { color: #ff7a85; }
    .feed-item { padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 13px; }
    .feed-item:last-child { border-bottom: none; }
    .feed-item .time { color: rgba(245,247,251,0.45); font-size: 12px; margin-top: 4px; }
    footer { padding: 16px 0 0; color: rgba(245,247,251,0.4); font-size: 12px; }
    .info { display: grid; grid-template-columns: 0.6fr 1.4fr; gap: 18px; margin-top: 28px; }
    ${commonInfoStyles()}
    @media (max-width: 900px) { .shell { grid-template-columns: 1fr; } .sidebar { display: none; } .kpi-grid { grid-template-columns: repeat(2, 1fr); } .panels { grid-template-columns: 1fr; } .info { grid-template-columns: 1fr; } }
    @media (max-width: 480px) { main { padding: 20px 14px; } .topbar, .kpi-grid { display: grid; grid-template-columns: 1fr; gap: 12px; } table { table-layout: fixed; } th,td { overflow-wrap: anywhere; } }
    @media (prefers-reduced-motion: reduce) { .kpi { transition: none; } }
    `,
    body: `
    <div class="shell">
      <aside class="sidebar" data-bg-node-id="dashboard-sidebar">
        <div class="brand" data-bg-node-id="dashboard-brand"><span class="dot"></span>Pulse</div>
        <a class="nav-item active" href="#" data-bg-node-id="nav-overview">Overview</a>
        <a class="nav-item" href="#" data-bg-node-id="nav-holdings">Holdings</a>
        <a class="nav-item" href="#" data-bg-node-id="nav-recon">Reconciliation</a>
        <a class="nav-item" href="#" data-bg-node-id="nav-cash">Cash</a>
        <a class="nav-item" href="#" data-bg-node-id="nav-reports">Reports</a>
        <a class="nav-item" href="#" data-bg-node-id="nav-settings">Settings</a>
        <div class="user-pill" data-bg-node-id="user-pill"><div class="avatar">M</div><div><div>Min Park</div><div style="color:var(--dashboard-muted);font-size:12px;">Operations</div></div></div>
      </aside>
      <main>
        <div class="topbar" data-bg-node-id="topbar">
          <div class="page-title" data-bg-node-id="page-title">${escapeHtml(sample.headline)}</div>
          <div class="date-pill" data-bg-node-id="date-pill">Last 30 days · Apr 25, 2026</div>
        </div>
        <div class="kpi-grid">
          <div class="kpi" data-bg-node-id="kpi-aum"><div class="num" data-bg-node-id="kpi-aum-value">$1.21B</div><div class="delta up" data-bg-node-id="kpi-aum-delta">▲ +8.4% QoQ · improved</div><div class="label" data-bg-node-id="kpi-aum-label">AUM under advisement</div></div>
          <div class="kpi" data-bg-node-id="kpi-margin"><div class="num" data-bg-node-id="kpi-margin-value">2.39%</div><div class="delta up" data-bg-node-id="kpi-margin-delta">▲ +118 bps TTM · improved</div><div class="label" data-bg-node-id="kpi-margin-label">Net management margin</div></div>
          <div class="kpi" data-bg-node-id="kpi-breaks"><div class="num" data-bg-node-id="kpi-breaks-value">7</div><div class="delta down" data-bg-node-id="kpi-breaks-delta">▼ +2 vs last week · worsened</div><div class="label" data-bg-node-id="kpi-breaks-label">Open reconciliation breaks</div></div>
          <div class="kpi" data-bg-node-id="kpi-cash"><div class="num" data-bg-node-id="kpi-cash-value">36 mo</div><div class="delta" data-bg-node-id="kpi-cash-delta">— held · unchanged</div><div class="label" data-bg-node-id="kpi-cash-label">Cash buffer (90d)</div></div>
        </div>
        <div class="panels">
          <section class="panel table-panel" data-bg-node-id="panel-holdings">
            <h3>Top holdings</h3>
            <table data-bg-node-id="holdings-table">
              <thead><tr><th>Position</th><th>Strategy</th><th class="num-col">Quarter</th><th class="num-col">MTD</th><th class="num-col">AUM share</th></tr></thead>
              <tbody>
                <tr data-bg-node-id="holding-1"><td>Pulse · Pacific Ops</td><td>Industrials</td><td class="num-col up">+18.4%</td><td class="num-col up">+3.2%</td><td class="num-col">14.2%</td></tr>
                <tr data-bg-node-id="holding-2"><td>Pulse · Yield Income</td><td>Credit</td><td class="num-col up">+9.2%</td><td class="num-col up">+1.4%</td><td class="num-col">12.8%</td></tr>
                <tr data-bg-node-id="holding-3"><td>Pulse · Tech Quality</td><td>Equity</td><td class="num-col down">-4.1%</td><td class="num-col down">-1.8%</td><td class="num-col">11.6%</td></tr>
                <tr data-bg-node-id="holding-4"><td>Pulse · EM Balanced</td><td>Multi-asset</td><td class="num-col up">+5.8%</td><td class="num-col up">+0.9%</td><td class="num-col">10.1%</td></tr>
                <tr data-bg-node-id="holding-5"><td>Pulse · APAC FX</td><td>FX</td><td class="num-col up">+11.7%</td><td class="num-col up">+2.1%</td><td class="num-col">8.4%</td></tr>
                <tr data-bg-node-id="holding-6"><td>Pulse · Real Assets</td><td>Alternatives</td><td class="num-col up">+2.3%</td><td class="num-col down">-0.4%</td><td class="num-col">7.9%</td></tr>
              </tbody>
            </table>
          </section>
          <section class="panel" data-bg-node-id="panel-feed">
            <h3>Recent activity</h3>
            <div class="feed-item" data-bg-node-id="feed-1"><div>Reconciliation break #112 cleared by ops</div><div class="time">14 minutes ago · Min Park</div></div>
            <div class="feed-item" data-bg-node-id="feed-2"><div>Trade ticket NVC-2841 settled</div><div class="time">1 hour ago · system</div></div>
            <div class="feed-item" data-bg-node-id="feed-3"><div>Cash sweep run · $4.2M to overnight</div><div class="time">3 hours ago · system</div></div>
            <div class="feed-item" data-bg-node-id="feed-4"><div>Q1 LP statements queued for review</div><div class="time">Yesterday · Min Park</div></div>
            <div class="feed-item" data-bg-node-id="feed-5"><div>Strategy rebalance · Pulse · APAC FX</div><div class="time">Yesterday · automation</div></div>
          </section>
        </div>
        <footer data-bg-node-id="dashboard-footer">Sample dashboard artifact in BurnGuard. Numbers are illustrative.</footer>
        <section class="info">${renderUsageCard()}${renderPromptCard(sample)}</section>
      </main>
    </div>
    `,
  });
}

function renderPromptSampleDocument(input: {
  sample: PromptSample;
  colorScheme: "dark" | "light";
  styles: string;
  body: string;
}): string {
  const { sample, colorScheme, styles, body } = input;
  const koreanStyles = sample.slug === "daon-korean-saas" ? `.masthead,.desc,.accent-word,.feature p,.signup span{color:var(--muted)}.feature,.signup{border-color:var(--line);background:var(--panel)}.signup button{background:var(--accent);color:white}.feature::before{display:none}.accent-word{font-family:inherit;font-style:normal;font-size:clamp(30px,4vw,52px);line-height:1.3}.card{background:var(--panel);border-color:var(--line)}.card p,.card li,pre{color:var(--muted)}` : "";
  return `<!doctype html>
<html lang="${sample.slug === "daon-korean-saas" ? "ko" : "en"}">
<head>
<link rel="stylesheet" href="fonts/fonts.css">
  <meta charset="utf-8">
  <title>${escapeHtml(promptSampleTitle(sample))}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root {
      color-scheme: ${colorScheme};
      --try-button-bg: #186ade;
      --try-button-fg: #ffffff;
      --dashboard-muted: #aab3c2;
      --bg: ${sample.theme.bg};
      --fg: ${sample.theme.fg};
      --muted: ${sample.theme.muted};
      --accent: ${sample.theme.accent};
      --panel: ${sample.theme.panel};
      --line: color-mix(in srgb, var(--fg) 16%, transparent);
    }
    * { box-sizing: border-box; }
    ${styles}
    ${landingSectionStyles}
    body {background:var(--bg);color:var(--fg)}
    .info {margin-top:48px}
    ${koreanStyles}
  </style>
</head>
<body>
${body.replace(/<section class="info">/, `${renderLandingSections(sample)}<section class="info">`)}
</body>
</html>
`;
}

function commonInfoStyles(mode: "dark" | "light" = "dark"): string {
  const light = mode === "light";
  return `
    .card { border: 1px solid ${light ? "rgba(9,17,31,0.1)" : "rgba(255,255,255,0.14)"}; border-radius: 24px; padding: 22px; background: ${light ? "rgba(255,255,255,0.74)" : "rgba(255,255,255,0.065)"}; box-shadow: inset 0 1px 0 ${light ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.1)"}; }
    .card h2 { margin: 0 0 12px; font-size: 15px; letter-spacing: 0.04em; text-transform: uppercase; }
    .card p, .card li { color: ${light ? "rgba(9,17,31,0.64)" : "rgba(255,255,255,0.64)"}; font-size: 13px; line-height: 1.65; }
    .card ol { margin: 0; padding-left: 20px; }
    pre { white-space: pre-wrap; word-break: break-word; margin: 0; color: ${light ? "#253041" : "rgba(255,255,255,0.82)"}; font: 12px/1.55 "SFMono-Regular", Consolas, monospace; }
  `;
}

function renderUsageCard(): string {
  return `<section class="card" data-bg-node-id="sample-usage"><h2>How to use</h2><ol><li>Open this project from the Examples tab.</li><li>Review the visual direction on this page.</li><li>Click <em>Try this prompt</em> below — BurnGuard creates a fresh prototype project with the prompt pre-filled in the chat composer, ready to send.</li><li>Or copy the prompt manually and paste it into the chat panel of any project.</li></ol></section>`;
}

function renderPromptCard(sample: PromptSample): string {
  // The form posts top-level (target="_top") so the iframe submission
  // navigates the parent window. The route creates a new prototype
  // project, redirects to it, and pre-fills the chat composer with
  // this prompt — no manual copy-paste needed (P4.7e).
  const tryButtonStyles =
    "display:inline-block;margin-top:12px;padding:10px 18px;background:var(--try-button-bg);color:var(--try-button-fg);border:none;border-radius:4px;font-weight:600;font-family:inherit;font-size:14px;cursor:pointer;";
  return `<section class="card" id="prompt" data-bg-node-id="sample-prompt"><h2>Source prompt</h2><pre>${escapeHtml(sample.prompt)}</pre><form action="/api/home/use-sample/${escapeHtml(sample.slug)}" method="POST" target="_top" style="margin:0;"><button type="submit" data-bg-node-id="sample-try-button" style="${tryButtonStyles}">Try this prompt →</button></form></section>`;
}

function promptSampleTitle(sample: PromptSample): string {
  return sample.name.replace(`${PROMPT_SAMPLE_TAG} `, "");
}

async function syncPromptSampleProject(input: {
  id: string; name: string; dirPath: string; entrypoint: string; html: string;
  currentRevision: number; currentDigest: string | null;
}): Promise<void> {
  await mkdir(input.dirPath, { recursive: true });
  const coordinator = new ArtifactCoordinator(getSqlite());
  if (input.currentDigest === null) { await coordinator.initialize(input.id, input.dirPath); return; }
  const current = await readFile(path.join(input.dirPath, input.entrypoint), "utf8").catch(() => null);
  if (current === input.html) {
    await copyBundledFonts(input.dirPath);
    return;
  }
  const userOperations = getSqlite().query<{ readonly count: number }, [string]>("SELECT COUNT(*) count FROM artifact_operations WHERE project_id=? AND status='committed' AND json_extract(replay_json,'$.kind')!='initialize'").get(input.id)?.count ?? 0;
  if (userOperations > 0) return;
  try {
    await coordinator.run({ projectId: input.id, projectDir: input.dirPath, kind: "initialize", expectedRevision: input.currentRevision, expectedArtifactDigest: input.currentDigest, mutate: async (stage) => { await copyBundledFonts(stage); await writeFile(path.join(stage, input.entrypoint), input.html, "utf8"); } });
  } catch (error) {
    if (error instanceof ArtifactOperationError && error.code === "artifact_identity_mismatch") return;
    throw error;
  }
  await getDb().update(projectsTable).set({ type: "from_template", entrypoint: input.entrypoint, archivedAt: null }).where(eq(projectsTable.name, input.name));
}

async function writeTutorialProject(input: {
  name: string;
  designSystemId?: string;
  type: "prototype" | "slide_deck" | "from_template";
  entrypoint: string;
  html: string;
}): Promise<void> {
  const db = getDb();
  const now = Date.now();
  const projectId = ulid();
  const sessionId = ulid();
  const dirPath = path.join(projectsDir, projectId);

  await mkdir(path.join(dirPath, ".attachments"), { recursive: true });
  await mkdir(path.join(dirPath, ".meta", "checkpoints"), { recursive: true });
  await db.insert(projectsTable).values({
    id: projectId,
    name: input.name,
    type: input.type,
    designSystemId: input.designSystemId ?? null,
    dirPath,
    entrypoint: input.entrypoint,
    thumbnailPath: null,
    backendId: "claude-code",
    optionsJson: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  });

  await db.insert(sessionsTable).values({
    id: sessionId,
    projectId,
    backendId: "claude-code",
    status: "idle",
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now,
  });
  await new ArtifactCoordinator(getSqlite()).initializeProject(projectId, dirPath, async (stage) => {
    await copyBundledFonts(stage);
    await writeFile(path.join(stage, input.entrypoint), input.html, "utf8");
    if (input.type === "slide_deck") {
      await mkdir(path.join(stage, "runtime"), { recursive: true });
      await writeFile(path.join(stage, "runtime", "deck-stage.js"), DECK_STAGE_JS, "utf8");
    }
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function findTutorialProjectId(
  kind: "prototype" | "slide_deck",
): Promise<string | null> {
  const db = getDb();
  const name =
    kind === "prototype" ? PROTOTYPE_TUTORIAL_NAME : DECK_TUTORIAL_NAME;
  const rows = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.name, name))
    .limit(1);
  return rows[0]?.id ?? null;
}
