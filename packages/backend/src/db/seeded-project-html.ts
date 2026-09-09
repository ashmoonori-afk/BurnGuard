/**
 * HTML content shipped with the five seeded `homeProjectFixtures`.
 *
 * Before P4.7(f) the fixtures created DB rows but no entrypoint file,
 * so opening any of them from Home loaded an empty canvas. This module
 * gives each fixture a real, self-contained starter artifact in the
 * appropriate genre and brand vocabulary so the user always lands on
 * something that renders.
 *
 * Content is intentionally compact (~3-5 KB each) and self-contained
 * — every file ships its own inline CSS so the canvas works even when
 * the linked design system fails to load.
 */

const SERIES_A_INVESTOR_LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<link rel="stylesheet" href="fonts/fonts.css">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Northvale Capital — Series A 2026</title>
<style>
  :root {
    --ink: #1c2b36;
    --ink-soft: #45525c;
    --paper: #ffffff;
    --paper-soft: #f2f5f7;
    --rule: #dce3e8;
    --brand-blue: #7399c6;
    --action-blue: #186ade;
    --serif: "DM Serif Display", "Gowun Batang", Georgia, serif;
    --sans: "Pretendard", system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: var(--sans); color: var(--ink); background: var(--paper); line-height: 1.55; }
  .nav { display: flex; justify-content: space-between; align-items: center; padding: 24px 64px; border-bottom: 1px solid var(--rule); }
  .nav .mark { font-family: var(--serif); font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
  .nav .links { display: flex; gap: 32px; font-size: 14px; }
  .nav .links a { color: var(--ink-soft); text-decoration: none; }
  .hero { padding: 96px 64px 64px; max-width: 1180px; margin: 0 auto; }
  .eyebrow { font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--action-blue); font-weight: 600; }
  h1 { font-family: var(--serif); font-size: 72px; line-height: 1.05; letter-spacing: -0.02em; margin: 16px 0 24px; max-width: 18ch; }
  .lede { font-size: 20px; color: var(--ink-soft); max-width: 60ch; margin: 0 0 40px; }
  .cta { display: inline-flex; gap: 12px; align-items: center; padding: 14px 24px; background: var(--action-blue); color: white; text-decoration: none; font-weight: 600; border-radius: 4px; font-size: 15px; }
  .cta.ghost { background: transparent; color: var(--ink); border: 1px solid var(--rule); margin-left: 12px; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--rule); border: 1px solid var(--rule); margin: 80px 64px; max-width: 1180px; margin-left: auto; margin-right: auto; }
  .stat { background: var(--paper); padding: 32px; }
  .stat .num { font-family: var(--serif); font-size: 48px; font-weight: 700; letter-spacing: -0.02em; font-feature-settings: 'tnum'; }
  .stat .label { font-size: 13px; color: var(--ink-soft); margin-top: 8px; }
  .thesis { padding: 80px 64px; max-width: 1180px; margin: 0 auto; display: grid; grid-template-columns: 320px 1fr; gap: 64px; }
  .thesis h2 { font-family: var(--serif); font-size: 32px; margin: 0; letter-spacing: -0.01em; }
  .thesis .body p { font-size: 17px; color: var(--ink-soft); margin: 0 0 16px; }
  footer { padding: 48px 64px; border-top: 1px solid var(--rule); color: var(--ink-soft); font-size: 13px; }
  @media (max-width: 720px) {
    .nav, .hero, .stats, .thesis, footer { padding-left: 24px; padding-right: 24px; }
    .nav .links { display: none; }
    h1 { font-size: 44px; }
    .stats { grid-template-columns: 1fr; }
    .thesis { grid-template-columns: 1fr; gap: 24px; }
  }
</style>
</head>
<body>
  <nav class="nav" data-bg-node-id="nav">
    <div class="mark" data-bg-node-id="nav-mark">Northvale Capital</div>
    <div class="links">
      <a href="#thesis" data-bg-node-id="nav-link-thesis">Thesis</a>
      <a href="#raise" data-bg-node-id="nav-link-raise">Raise</a>
      <a href="#deck" data-bg-node-id="nav-link-deck">Deck</a>
    </div>
  </nav>
  <header class="hero" data-bg-node-id="hero">
    <div class="eyebrow" data-bg-node-id="hero-eyebrow">Series A · Q2 2026</div>
    <h1 data-bg-node-id="hero-headline">Building the editorial spine of institutional fintech.</h1>
    <p class="lede" data-bg-node-id="hero-lede">Northvale Capital is raising a $32M Series A to scale its data-products business across Asia-Pacific. The round is led by an existing strategic LP and remains open to a small set of follow-on investors.</p>
    <a href="#deck" class="cta" data-bg-node-id="hero-cta-primary">Read the deck →</a>
    <a href="#thesis" class="cta ghost" data-bg-node-id="hero-cta-secondary">Investment thesis</a>
  </header>
  <section class="stats" data-bg-node-id="stats">
    <div class="stat" data-bg-node-id="stat-aum">
      <div class="num" data-bg-node-id="stat-aum-value">$1.2B</div>
      <div class="label" data-bg-node-id="stat-aum-label">AUM under advisement</div>
    </div>
    <div class="stat" data-bg-node-id="stat-target">
      <div class="num" data-bg-node-id="stat-target-value">$32M</div>
      <div class="label" data-bg-node-id="stat-target-label">Series A target close</div>
    </div>
    <div class="stat" data-bg-node-id="stat-runway">
      <div class="num" data-bg-node-id="stat-runway-value">36 mo</div>
      <div class="label" data-bg-node-id="stat-runway-label">Runway post-close</div>
    </div>
  </section>
  <section class="thesis" id="thesis" data-bg-node-id="thesis">
    <h2 data-bg-node-id="thesis-title">Investment thesis</h2>
    <div class="body">
      <p data-bg-node-id="thesis-p1">Asset managers spend roughly two-thirds of every research hour assembling data, not interpreting it. Our platform sits between primary feeds and the analyst desk, producing institution-grade research artifacts on demand.</p>
      <p data-bg-node-id="thesis-p2">Series A capital extends the product into post-trade reporting and a managed-research API for mid-market funds — segments where existing vendors are too coarse-grained or too consultancy-heavy to compete with.</p>
    </div>
  </section>
  <footer data-bg-node-id="footer">© 2026 Northvale Capital · Confidential · For prospective investors only · This page is a sample artifact in BurnGuard.</footer>
</body>
</html>
`;

const QUARTERLY_REVIEW_DECK_HTML = `<!doctype html>
<html lang="en">
<head>
<link rel="stylesheet" href="fonts/fonts.css">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Northvale — Q1 2026 Review</title>
<style>
  :root {
    --ink: #1c2b36;
    --ink-soft: #45525c;
    --paper: #ffffff;
    --paper-soft: #f2f5f7;
    --rule: #dce3e8;
    --brand-blue: #7399c6;
    --action-blue: #186ade;
    --up: #2f7a4f;
    --down: #b03a3a;
    --serif: "DM Serif Display", "Gowun Batang", Georgia, serif;
    --sans: "Pretendard", system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0d1419; font-family: var(--sans); color: var(--ink); }
  [data-slide] {
    position: relative;
    width: 1280px;
    height: 720px;
    margin: 24px auto;
    background: var(--paper);
    padding: 64px 80px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    overflow: hidden;
  }
  .eyebrow { font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--action-blue); font-weight: 600; }
  .slide-num { position: absolute; bottom: 32px; right: 80px; font-size: 13px; color: var(--ink-soft); font-feature-settings: 'tnum'; }
  .deck-cover { background: linear-gradient(180deg, #1c2b36 0%, #0d1419 100%); color: white; display: flex; flex-direction: column; justify-content: flex-end; padding: 80px; }
  .deck-cover .eyebrow { color: var(--brand-blue); }
  .deck-cover h1 { font-family: var(--serif); font-size: 84px; line-height: 1.05; margin: 16px 0 8px; letter-spacing: -0.02em; }
  .deck-cover .meta { font-size: 16px; color: rgba(255,255,255,0.7); margin-top: 24px; }
  h2 { font-family: var(--serif); font-size: 40px; line-height: 1.15; margin: 12px 0 32px; letter-spacing: -0.01em; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 32px; margin-top: 24px; }
  .kpi { padding: 24px 0; border-top: 2px solid var(--ink); }
  .kpi .num { font-family: var(--serif); font-size: 64px; font-weight: 700; line-height: 1; letter-spacing: -0.02em; font-feature-settings: 'tnum'; }
  .kpi .delta.up { color: var(--up); }
  .kpi .delta.down { color: var(--down); }
  .kpi .label { font-size: 14px; color: var(--ink-soft); margin-top: 12px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 64px; }
  .takeaway { background: var(--paper-soft); padding: 32px; border-left: 4px solid var(--action-blue); font-size: 22px; line-height: 1.45; max-width: 60ch; }
  .closing { display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; background: var(--ink); color: white; }
  .closing h1 { font-family: var(--serif); font-size: 96px; letter-spacing: -0.02em; margin: 0; }
  .closing .meta { color: rgba(255,255,255,0.6); margin-top: 16px; }
  @media (max-width: 720px) {
    [data-slide] { width: 100%; height: auto; min-height: 100vh; margin: 0; padding: 32px 24px 64px; overflow-wrap: anywhere; }
    .deck-cover h1, .closing h1 { font-size: 44px; }
    h2 { font-size: 30px; }
    .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .kpi .num { font-size: 42px; }
    .two-col { grid-template-columns: 1fr; gap: 24px; }
    .takeaway { padding: 20px; font-size: 18px; }
    table { table-layout: fixed; }
    .slide-num { right: 24px; bottom: 16px; }
  }
</style>
</head>
<body>
  <script src="runtime/deck-stage.js" defer></script>

  <section data-slide class="deck-slide deck-cover" data-bg-node-id="slide-1">
    <div class="eyebrow" data-bg-node-id="slide-1-eyebrow">Quarterly review · Q1 2026</div>
    <h1 data-bg-node-id="slide-1-title">Disciplined growth through a noisy quarter.</h1>
    <div class="meta" data-bg-node-id="slide-1-meta">Northvale Capital · April 25, 2026 · Internal + LP audience</div>
  </section>

  <section data-slide class="deck-slide" data-bg-node-id="slide-2">
    <div class="eyebrow" data-bg-node-id="slide-2-eyebrow">01 · Headlines</div>
    <h2 data-bg-node-id="slide-2-title">Three numbers shaped the quarter.</h2>
    <div class="kpi-grid">
      <div class="kpi" data-bg-node-id="slide-2-kpi-1">
        <div class="num" data-bg-node-id="slide-2-kpi-1-value">$1.21B</div>
        <div class="delta up" data-bg-node-id="slide-2-kpi-1-delta">+8.4% QoQ</div>
        <div class="label" data-bg-node-id="slide-2-kpi-1-label">AUM under advisement</div>
      </div>
      <div class="kpi" data-bg-node-id="slide-2-kpi-2">
        <div class="num" data-bg-node-id="slide-2-kpi-2-value">12</div>
        <div class="delta up" data-bg-node-id="slide-2-kpi-2-delta">+3 net new</div>
        <div class="label" data-bg-node-id="slide-2-kpi-2-label">Institutional clients</div>
      </div>
      <div class="kpi" data-bg-node-id="slide-2-kpi-3">
        <div class="num" data-bg-node-id="slide-2-kpi-3-value">2.39%</div>
        <div class="delta up" data-bg-node-id="slide-2-kpi-3-delta">+118 bps</div>
        <div class="label" data-bg-node-id="slide-2-kpi-3-label">Net management margin</div>
      </div>
      <div class="kpi" data-bg-node-id="slide-2-kpi-4">
        <div class="num" data-bg-node-id="slide-2-kpi-4-value">36 mo</div>
        <div class="delta" data-bg-node-id="slide-2-kpi-4-delta">held</div>
        <div class="label" data-bg-node-id="slide-2-kpi-4-label">Operating runway</div>
      </div>
    </div>
    <div class="slide-num">02 / 06</div>
  </section>

  <section data-slide class="deck-slide" data-bg-node-id="slide-3">
    <div class="eyebrow" data-bg-node-id="slide-3-eyebrow">02 · Markets</div>
    <h2 data-bg-node-id="slide-3-title">Volatility eased, dispersion did not.</h2>
    <div class="two-col">
      <div data-bg-node-id="slide-3-body">
        <p style="font-size:17px;line-height:1.6;color:var(--ink-soft);" data-bg-node-id="slide-3-p1">Realised vol on the S&amp;P 500 fell from 22 to 14 over the quarter, but cross-sectional dispersion remained near a five-year high — dispersion-trade structures earned, beta-only structures did not.</p>
        <p style="font-size:17px;line-height:1.6;color:var(--ink-soft);" data-bg-node-id="slide-3-p2">Asia ex-Japan continued to outperform on local-currency terms, with Korea and Vietnam leading. Japan equity gave back February's gains as the BoJ's stance hardened.</p>
      </div>
      <div class="takeaway" data-bg-node-id="slide-3-takeaway">Conviction calls beat allocation calls this quarter — discretion outperformed indexing.</div>
    </div>
    <div class="slide-num">03 / 06</div>
  </section>

  <section data-slide class="deck-slide" data-bg-node-id="slide-4">
    <div class="eyebrow" data-bg-node-id="slide-4-eyebrow">03 · Portfolio</div>
    <h2 data-bg-node-id="slide-4-title">Top contributors and detractors.</h2>
    <table style="width:100%;border-collapse:collapse;font-feature-settings:'tnum';font-size:16px;" data-bg-node-id="slide-4-table">
      <thead><tr style="border-bottom:2px solid var(--ink);text-align:left;"><th style="padding:12px 0;">Position</th><th style="padding:12px 0;">Sector</th><th style="padding:12px 0;text-align:right;">Quarter return</th><th style="padding:12px 0;text-align:right;">Contribution</th></tr></thead>
      <tbody>
        <tr style="border-bottom:1px solid var(--rule);"><td style="padding:14px 0;">NVC · Pacific Ops</td><td>Industrials</td><td style="text-align:right;color:var(--up);">+18.4%</td><td style="text-align:right;color:var(--up);">+62 bps</td></tr>
        <tr style="border-bottom:1px solid var(--rule);"><td style="padding:14px 0;">NVC · Yield Income</td><td>Credit</td><td style="text-align:right;color:var(--up);">+9.2%</td><td style="text-align:right;color:var(--up);">+41 bps</td></tr>
        <tr style="border-bottom:1px solid var(--rule);"><td style="padding:14px 0;">NVC · Tech Quality</td><td>Equity</td><td style="text-align:right;color:var(--down);">-4.1%</td><td style="text-align:right;color:var(--down);">-22 bps</td></tr>
        <tr><td style="padding:14px 0;">NVC · EM Balanced</td><td>Multi-asset</td><td style="text-align:right;color:var(--up);">+5.8%</td><td style="text-align:right;color:var(--up);">+19 bps</td></tr>
      </tbody>
    </table>
    <div class="slide-num">04 / 06</div>
  </section>

  <section data-slide class="deck-slide" data-bg-node-id="slide-5">
    <div class="eyebrow" data-bg-node-id="slide-5-eyebrow">04 · Outlook</div>
    <h2 data-bg-node-id="slide-5-title">Three things to watch into Q2.</h2>
    <ol style="font-size:20px;line-height:1.6;color:var(--ink);padding-left:20px;max-width:60ch;" data-bg-node-id="slide-5-list">
      <li data-bg-node-id="slide-5-item-1">A 25 bp Fed cut is now priced for June. We are positioned for a single cut, not a cycle.</li>
      <li data-bg-node-id="slide-5-item-2">Spread tightening across IG credit looks technical. We are reducing duration, not credit, into the second quarter.</li>
      <li data-bg-node-id="slide-5-item-3">Asia Pacific currency basket remains the cleanest expression of our reflation thesis.</li>
    </ol>
    <div class="slide-num">05 / 06</div>
  </section>

  <section data-slide class="deck-slide closing" data-bg-node-id="slide-6">
    <h1 data-bg-node-id="slide-6-title">Thank you.</h1>
    <div class="meta" data-bg-node-id="slide-6-meta">Q&amp;A · ir@northvale.example · Q2 review will follow on July 25.</div>
    <div class="meta" style="margin-top:24px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;" data-bg-node-id="slide-6-sample-tag">Sample deck artifact · BurnGuard</div>
  </section>
</body>
</html>
`;

export const SPLASH_TEMPLATE_LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<link rel="stylesheet" href="fonts/fonts.css">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Splash — Money that moves at message speed</title>
<style>
  :root {
    --bg: #f5f8ff;
    --ink: #0a0e2c;
    --ink-soft: #4a4e6c;
    --brand: #2962ff;
    --brand-deep: #1a3aff;
    --accent: #ffd000;
    --card: #ffffff;
    --rule: #e6ecfa;
    --sans: "Pretendard", system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: var(--sans); color: var(--ink); background: var(--bg); line-height: 1.55; }
  .nav { display: flex; justify-content: space-between; align-items: center; padding: 20px 32px; max-width: 1200px; margin: 0 auto; }
  .nav .logo { font-weight: 800; font-size: 22px; letter-spacing: -0.02em; color: var(--brand); }
  .nav .actions { display: flex; gap: 12px; align-items: center; }
  .nav .ghost { color: var(--ink); text-decoration: none; font-weight: 600; font-size: 14px; padding: 10px 16px; }
  .pill { background: var(--ink); color: white; padding: 10px 20px; border-radius: 999px; font-weight: 700; text-decoration: none; font-size: 14px; }
  .pill.brand { background: var(--brand); }
  .hero { padding: 64px 32px 80px; max-width: 1200px; margin: 0 auto; display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 48px; align-items: center; }
  .hero h1 { font-size: 72px; font-weight: 800; line-height: 1.05; margin: 16px 0 24px; letter-spacing: -0.03em; }
  .hero h1 em { font-style: normal; color: var(--brand); }
  .hero p { font-size: 19px; color: var(--ink-soft); margin: 0 0 32px; max-width: 48ch; }
  .hero .ctas { display: flex; gap: 12px; }
  .badge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; background: white; border: 1px solid var(--rule); border-radius: 999px; font-size: 13px; font-weight: 600; color: var(--brand-deep); }
  .badge .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
  .phone { background: var(--ink); border-radius: 36px; padding: 24px; aspect-ratio: 9/16; max-width: 320px; margin-left: auto; box-shadow: 0 24px 48px rgba(41,98,255,0.18); position: relative; }
  .phone .balance-label { color: rgba(255,255,255,0.6); font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; }
  .phone .balance { color: white; font-size: 44px; font-weight: 800; margin: 8px 0 24px; }
  .phone .row { display: flex; justify-content: space-between; padding: 14px 0; border-top: 1px solid rgba(255,255,255,0.08); color: white; font-size: 14px; }
  .phone .row .amt { font-weight: 700; }
  .phone .row .amt.up { color: #4ad07c; }
  .phone .row .amt.down { color: #ff7a85; }
  .features { padding: 64px 32px; max-width: 1200px; margin: 0 auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
  .feature { background: var(--card); padding: 28px; border-radius: 20px; border: 1px solid var(--rule); }
  .feature .ico { width: 44px; height: 44px; border-radius: 12px; background: var(--brand); display: flex; align-items: center; justify-content: center; color: white; font-weight: 800; margin-bottom: 16px; }
  .feature h3 { margin: 0 0 8px; font-size: 19px; font-weight: 700; }
  .feature p { margin: 0; color: var(--ink-soft); font-size: 15px; }
  .cta-band { background: var(--brand); color: white; padding: 56px 32px; text-align: center; margin: 64px 0 0; }
  .cta-band h2 { font-size: 40px; margin: 0 0 16px; font-weight: 800; letter-spacing: -0.02em; }
  .cta-band a { background: white; color: var(--brand); padding: 14px 28px; border-radius: 999px; text-decoration: none; font-weight: 700; }
  .detail-section {max-width:1200px;margin:0 auto;padding:72px 32px;border-top:1px solid var(--rule)} .detail-section h2{font-size:clamp(28px,4vw,44px);letter-spacing:-.03em;margin:0 0 28px}.detail-section p,.detail-section li{color:var(--ink-soft);line-height:1.8}.detail-section ol{display:grid;gap:20px;padding-left:24px}.detail-section details{padding:20px 0;border-bottom:1px solid var(--rule)}.detail-section summary{font-weight:700;cursor:pointer}.detail-section table{width:100%;border-collapse:collapse}.detail-section td,.detail-section th{text-align:left;padding:18px;border-bottom:1px solid var(--rule)}
  footer { padding: 32px; text-align: center; color: var(--ink-soft); font-size: 13px; }
  @media (max-width: 880px) {
    .hero { grid-template-columns: 1fr; }
    .hero h1 { font-size: 44px; }
    .features { grid-template-columns: 1fr; }
    .phone { max-width: 240px; margin: 0 auto; }
  }
</style>
</head>
<body>
  <nav class="nav" data-bg-node-id="nav">
    <div class="logo" data-bg-node-id="nav-logo">Splash</div>
    <div class="actions">
      <a class="ghost" href="#" data-bg-node-id="nav-signin">Sign in</a>
      <a class="pill" href="#" data-bg-node-id="nav-cta">Get the app</a>
    </div>
  </nav>
  <section class="hero" data-bg-node-id="hero">
    <div>
      <span class="badge" data-bg-node-id="hero-badge"><span class="dot"></span> New · Send to 12 countries instantly</span>
      <h1 data-bg-node-id="hero-headline">Money that moves at <em>message speed</em>.</h1>
      <p data-bg-node-id="hero-lede">Splash is the no-fee transfer app you can hand to your grandma. Send, request, and split — across borders, in your favourite currency, in under three seconds.</p>
      <div class="ctas">
        <a class="pill brand" href="#" data-bg-node-id="hero-cta-primary">Open free account</a>
        <a class="ghost" href="#features" data-bg-node-id="hero-cta-secondary">See how →</a>
      </div>
    </div>
    <div class="phone" data-bg-node-id="hero-phone">
      <div class="balance-label" data-bg-node-id="phone-balance-label">Available balance</div>
      <div class="balance" data-bg-node-id="phone-balance">$2,418.20</div>
      <div class="row" data-bg-node-id="phone-row-1"><span>To Léa · Paris</span><span class="amt down">-€85.00</span></div>
      <div class="row" data-bg-node-id="phone-row-2"><span>From Min Jun</span><span class="amt up">+₩140,000</span></div>
      <div class="row" data-bg-node-id="phone-row-3"><span>Splash savings</span><span class="amt">$120.00</span></div>
    </div>
  </section>
  <section class="features" id="features" data-bg-node-id="features">
    <div class="feature" data-bg-node-id="feature-1">
      <div class="ico">⚡</div>
      <h3 data-bg-node-id="feature-1-title">Three-second sends</h3>
      <p data-bg-node-id="feature-1-body">Bank-rail-bypass settlement to 12 currencies, with the FX baked in at mid-market.</p>
    </div>
    <div class="feature" data-bg-node-id="feature-2">
      <div class="ico">∅</div>
      <h3 data-bg-node-id="feature-2-title">No FX markup</h3>
      <p data-bg-node-id="feature-2-body">We make money on float and partner spread, not on hidden conversion fees.</p>
    </div>
    <div class="feature" data-bg-node-id="feature-3">
      <div class="ico">⌘</div>
      <h3 data-bg-node-id="feature-3-title">One-tap split</h3>
      <p data-bg-node-id="feature-3-body">Split a bill across the table without anyone leaving iMessage. Auto-collected, auto-cleared.</p>
    </div>
  </section>
  <section class="detail-section" id="how-it-works" data-bg-node-id="splash-workflow"><h2>Know where your money is going.</h2><ol><li><strong>Choose the recipient.</strong> Check their name and destination before entering the amount.</li><li><strong>Review the transfer.</strong> See the exchange rate, any fee and the amount the recipient will receive.</li><li><strong>Follow the receipt.</strong> Keep a reference for each transfer and check its progress in the activity list.</li></ol></section>
  <section class="detail-section" id="transparency" data-bg-node-id="splash-transparency"><h2>No surprises at the confirmation screen.</h2><p>A good transfer experience explains the total before asking you to continue. This illustrative breakdown shows the information that matters.</p><table><thead><tr><th>What you review</th><th>Why it matters</th></tr></thead><tbody><tr><td>Recipient and currency</td><td>Confirm the destination before money moves.</td></tr><tr><td>Rate and service fee</td><td>Compare the full cost in your sending currency.</td></tr><tr><td>Expected arrival</td><td>Plan around the estimated delivery window.</td></tr></tbody></table></section>
  <section class="detail-section" id="questions" data-bg-node-id="splash-faq"><h2>A few things before you send.</h2><details><summary>Can I change a recipient?</summary><p>Review and edit the recipient before confirmation. Once a transfer is processing, contact support with the transfer reference.</p></details><details><summary>Where do I find a receipt?</summary><p>Open the transfer in your activity list to review the amount, destination and reference.</p></details><details><summary>Will this sample move real money?</summary><p>No. This page is a design example. Its balances and product claims are illustrative, and its controls do not process payments.</p></details></section>
  <section class="cta-band" data-bg-node-id="cta-band">
    <h2 data-bg-node-id="cta-band-title">Send your first $50 today, on us.</h2>
    <a href="#" data-bg-node-id="cta-band-button">Open free account →</a>
  </section>
  <footer data-bg-node-id="footer">© 2026 Splash · Sample template artifact in BurnGuard · Not a real product.</footer>
</body>
</html>
`;

const PORTFOLIO_PLAYGROUND_HTML = `<!doctype html>
<html lang="en">
<head>
<link rel="stylesheet" href="fonts/fonts.css">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Portfolio Playground</title>
<style>
  :root {
    --bg: #fafafa;
    --ink: #111111;
    --ink-soft: #555555;
    --rule: #e5e5e5;
    --accent: #ff5722;
    --accent-ink: #b4320b;
    --sw-blue: #1f6feb;
    --sw-green: #2f7a4f;
    --sw-red: #b03a3a;
    --serif: "DM Serif Display", "Gowun Batang", Georgia, serif;
    --sans: "Inter", system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: var(--sans); color: var(--ink); background: var(--bg); line-height: 1.6; }
  .container { max-width: 960px; margin: 0 auto; padding: 64px 24px; }
  .hero { border-bottom: 1px solid var(--rule); padding-bottom: 48px; margin-bottom: 48px; }
  .hero .eyebrow { font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent-ink); font-weight: 700; }
  .hero h1 { font-family: var(--serif); font-size: 64px; line-height: 1.05; letter-spacing: -0.02em; margin: 16px 0 16px; }
  .hero p { font-size: 19px; color: var(--ink-soft); max-width: 60ch; margin: 0; }
  section { margin: 56px 0; }
  section h2 { font-family: var(--serif); font-size: 28px; margin: 0 0 24px; font-weight: 700; }
  .swatches { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }
  .sw { height: 80px; border-radius: 8px; display: flex; align-items: flex-end; padding: 8px 12px; color: white; font-size: 12px; font-weight: 600; }
  .type-stack > * { margin: 0; }
  .type-stack .h-d { font-family: var(--serif); font-size: 56px; font-weight: 700; line-height: 1; letter-spacing: -0.02em; }
  .type-stack .h-1 { font-family: var(--serif); font-size: 36px; font-weight: 700; margin-top: 16px; line-height: 1.15; }
  .type-stack .h-2 { font-size: 22px; font-weight: 700; margin-top: 12px; line-height: 1.2; }
  .type-stack .body { font-size: 16px; color: var(--ink-soft); margin-top: 12px; max-width: 60ch; }
  .type-stack .caption { font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-soft); margin-top: 16px; }
  .buttons { display: flex; gap: 12px; flex-wrap: wrap; }
  .btn { padding: 12px 20px; font-size: 14px; font-weight: 600; border-radius: 999px; border: 1px solid var(--ink); background: var(--ink); color: white; cursor: pointer; }
  .btn.ghost { background: transparent; color: var(--ink); }
  .btn.accent { background: var(--accent); border-color: var(--accent); color: var(--ink); }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .card { background: white; border: 1px solid var(--rule); border-radius: 12px; padding: 24px; }
  .card h3 { margin: 0 0 8px; font-size: 18px; font-weight: 700; }
  .card p { margin: 0; font-size: 14px; color: var(--ink-soft); }
  footer { border-top: 1px solid var(--rule); padding-top: 32px; margin-top: 64px; font-size: 13px; color: var(--ink-soft); }
  @media (max-width: 720px) {
    .swatches { grid-template-columns: repeat(3, 1fr); }
    .cards { grid-template-columns: 1fr; }
    .hero h1 { font-size: 36px; }
  }
</style>
</head>
<body>
<div class="container">
  <header class="hero" data-bg-node-id="hero">
    <div class="eyebrow" data-bg-node-id="hero-eyebrow">Sandbox · No design system</div>
    <h1 data-bg-node-id="hero-title">A scratchpad for visual ideas.</h1>
    <p data-bg-node-id="hero-lede">This project ships without a design system on purpose — it's a place to try a typography stack, a palette, or a single component before lifting it into something more permanent. Edit any block, run a prompt, or just keep poking.</p>
  </header>
  <section data-bg-node-id="section-palette">
    <h2 data-bg-node-id="palette-title">Palette</h2>
    <div class="swatches">
      <div class="sw" style="background:var(--ink)" data-bg-node-id="sw-ink">#111111</div>
      <div class="sw" style="background:var(--ink-soft)" data-bg-node-id="sw-ink-soft">#555555</div>
      <div class="sw" style="background:var(--accent);color:var(--ink)" data-bg-node-id="sw-accent">#FF5722</div>
      <div class="sw" style="background:var(--sw-blue)" data-bg-node-id="sw-blue">#1F6FEB</div>
      <div class="sw" style="background:var(--sw-green)" data-bg-node-id="sw-green">#2F7A4F</div>
      <div class="sw" style="background:var(--sw-red)" data-bg-node-id="sw-red">#B03A3A</div>
    </div>
  </section>
  <section data-bg-node-id="section-type">
    <h2 data-bg-node-id="type-title">Typography stack</h2>
    <div class="type-stack">
      <div class="h-d" data-bg-node-id="type-display">Display Georgia 56</div>
      <div class="h-1" data-bg-node-id="type-h1">Heading 1 — 36 / 1.15</div>
      <div class="h-2" data-bg-node-id="type-h2">Heading 2 — 22 / 1.2</div>
      <p class="body" data-bg-node-id="type-body">Body Inter 16 / 1.6 with a soft ink colour. Long enough to feel like real copy, short enough to keep the playground compact.</p>
      <div class="caption" data-bg-node-id="type-caption">CAPTION · TRACKING 0.12em</div>
    </div>
  </section>
  <section data-bg-node-id="section-buttons">
    <h2 data-bg-node-id="buttons-title">Buttons</h2>
    <div class="buttons">
      <button class="btn" data-bg-node-id="btn-primary">Primary action</button>
      <button class="btn ghost" data-bg-node-id="btn-ghost">Ghost</button>
      <button class="btn accent" data-bg-node-id="btn-accent">Accent</button>
    </div>
  </section>
  <section data-bg-node-id="section-cards">
    <h2 data-bg-node-id="cards-title">Cards</h2>
    <div class="cards">
      <div class="card" data-bg-node-id="card-1">
        <h3 data-bg-node-id="card-1-title">Try a prompt</h3>
        <p data-bg-node-id="card-1-body">Open chat, ask the agent to redesign this section in a different brand voice.</p>
      </div>
      <div class="card" data-bg-node-id="card-2">
        <h3 data-bg-node-id="card-2-title">Test a token</h3>
        <p data-bg-node-id="card-2-body">Switch the palette to a new mood, then see how the type stack reads against it.</p>
      </div>
      <div class="card" data-bg-node-id="card-3">
        <h3 data-bg-node-id="card-3-title">Throwaway is fine</h3>
        <p data-bg-node-id="card-3-body">This sample exists to be overwritten — every revert restores the starting state.</p>
      </div>
    </div>
  </section>
  <footer data-bg-node-id="footer">Sample playground artifact in BurnGuard · Edit freely · Not linked to any design system.</footer>
</div>
</body>
</html>
`;

const MARKET_UPDATE_MICROSITE_HTML = `<!doctype html>
<html lang="en">
<head>
<link rel="stylesheet" href="fonts/fonts.css">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Salt Markets — April 2026 update</title>
<style>
  :root {
    --bg: #fbfaf6;
    --ink: #16191c;
    --ink-soft: #50545a;
    --rule: #e1ddd2;
    --accent: #b94430;
    --signup-muted: #b8b9ba;
    --serif: "DM Serif Display", "Gowun Batang", Georgia, serif;
    --sans: "Inter", system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: var(--sans); color: var(--ink); background: var(--bg); line-height: 1.55; }
  .masthead { border-bottom: 2px solid var(--ink); padding: 18px 32px; max-width: 1100px; margin: 0 auto; display: flex; justify-content: space-between; align-items: baseline; }
  .masthead .brand { font-family: var(--serif); font-size: 28px; font-weight: 700; letter-spacing: -0.01em; }
  .masthead .meta { font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-soft); }
  .lede { padding: 56px 32px 32px; max-width: 1100px; margin: 0 auto; border-bottom: 1px solid var(--rule); }
  .lede .eyebrow { font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent); font-weight: 700; }
  .lede h1 { font-family: var(--serif); font-size: 56px; line-height: 1.1; letter-spacing: -0.02em; margin: 12px 0 16px; max-width: 22ch; }
  .lede p { font-size: 19px; color: var(--ink-soft); max-width: 56ch; margin: 0; }
  .articles { padding: 48px 32px; max-width: 1100px; margin: 0 auto; display: grid; grid-template-columns: repeat(2, 1fr); gap: 32px 48px; }
  .article { border-top: 1px solid var(--rule); padding-top: 24px; }
  .article .kicker { font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent); font-weight: 700; }
  .article h2 { font-family: var(--serif); font-size: 26px; line-height: 1.2; margin: 8px 0 12px; }
  .article p { font-size: 15px; color: var(--ink-soft); margin: 0 0 12px; }
  .article a { color: var(--ink); font-weight: 600; font-size: 14px; text-decoration: none; border-bottom: 1px solid var(--ink); }
  .signup { background: var(--ink); color: var(--bg); padding: 56px 32px; text-align: center; }
  .signup h3 { font-family: var(--serif); font-size: 32px; margin: 0 0 12px; }
  .signup form { display: inline-flex; gap: 8px; margin-top: 16px; }
  .signup input { padding: 12px 16px; min-width: 280px; border: none; border-radius: 0; font-size: 15px; font-family: inherit; background: var(--bg); color: var(--ink); }
  .signup button { padding: 12px 20px; background: var(--accent); color: white; border: none; font-weight: 700; cursor: pointer; }
  footer { padding: 32px; text-align: center; color: var(--ink-soft); font-size: 12px; max-width: 1100px; margin: 0 auto; }
  @media (max-width: 720px) {
    .articles { grid-template-columns: 1fr; }
    .lede h1 { font-size: 36px; }
    .signup form { flex-direction: column; align-items: stretch; }
    .signup input { min-width: 0; }
  }
</style>
</head>
<body>
  <header class="masthead" data-bg-node-id="masthead">
    <div class="brand" data-bg-node-id="masthead-brand">Salt Markets</div>
    <div class="meta" data-bg-node-id="masthead-meta">April 2026 · Issue 04</div>
  </header>
  <section class="lede" data-bg-node-id="lede">
    <div class="eyebrow" data-bg-node-id="lede-eyebrow">This month</div>
    <h1 data-bg-node-id="lede-title">A quieter quarter, but the cracks are widening underneath.</h1>
    <p data-bg-node-id="lede-body">Headline volatility eased through April, yet credit spreads, term-premium, and FX dispersion all moved in the opposite direction. Three notes from our desk on what to actually trade.</p>
  </section>
  <section class="articles" data-bg-node-id="articles">
    <article class="article" data-bg-node-id="article-1">
      <div class="kicker" data-bg-node-id="article-1-kicker">Rates · 6 min</div>
      <h2 data-bg-node-id="article-1-title">Why a single Fed cut is now the most expensive trade.</h2>
      <p data-bg-node-id="article-1-body">Markets are priced for the start of an easing cycle. Our base case is one cut and done — the carry differential makes that view cheap to hold and asymmetric.</p>
      <a href="#" data-bg-node-id="article-1-cta">Read the note →</a>
    </article>
    <article class="article" data-bg-node-id="article-2">
      <div class="kicker" data-bg-node-id="article-2-kicker">Credit · 4 min</div>
      <h2 data-bg-node-id="article-2-title">IG spreads have stopped paying for the volatility you don't see.</h2>
      <p data-bg-node-id="article-2-body">Tightening in IG looks technical, not fundamental. Two pair trades that re-introduce convexity without giving up the carry budget.</p>
      <a href="#" data-bg-node-id="article-2-cta">Read the note →</a>
    </article>
    <article class="article" data-bg-node-id="article-3">
      <div class="kicker" data-bg-node-id="article-3-kicker">FX · 5 min</div>
      <h2 data-bg-node-id="article-3-title">The Asia ex-Japan basket as a clean reflation expression.</h2>
      <p data-bg-node-id="article-3-body">Korea and Vietnam still lead. We size the trade against a lower-vol JPY short and pin the structure to a 90-day window.</p>
      <a href="#" data-bg-node-id="article-3-cta">Read the note →</a>
    </article>
    <article class="article" data-bg-node-id="article-4">
      <div class="kicker" data-bg-node-id="article-4-kicker">Equities · 3 min</div>
      <h2 data-bg-node-id="article-4-title">Dispersion remained near a five-year high. Discretion paid.</h2>
      <p data-bg-node-id="article-4-body">Conviction calls beat allocation calls this quarter. We close the index hedges and re-enter pair-wise with a cleaner sector tilt.</p>
      <a href="#" data-bg-node-id="article-4-cta">Read the note →</a>
    </article>
  </section>
  <section class="signup" data-bg-node-id="signup">
    <h3 data-bg-node-id="signup-title">Get the next issue in your inbox.</h3>
    <p style="margin:0;color:var(--signup-muted);" data-bg-node-id="signup-body">One email a month. No promotions, ever.</p>
    <form data-bg-node-id="signup-form">
      <input type="email" placeholder="you@desk.example" data-bg-node-id="signup-input" />
      <button type="button" data-bg-node-id="signup-button">Subscribe</button>
    </form>
  </section>
  <footer data-bg-node-id="footer">© 2026 Salt Markets · Sample microsite artifact in BurnGuard · Not investment advice.</footer>
</body>
</html>
`;

/**
 * Map of fixture project id to its starter HTML.
 *
 * Project ids match `packages/backend/src/fixtures/projects-list.json`.
 * Archived rows are intentionally omitted — they should never seed an
 * artifact since they're hidden from the user anyway.
 */
export const SEEDED_PROJECT_HTML: Record<string, string> = {
  "01J8F9H1A0RECENTPROJ000001": SERIES_A_INVESTOR_LANDING_HTML,
  "01J8F9H1A0RECENTPROJ000002": QUARTERLY_REVIEW_DECK_HTML,
  "01J8F9H1A0RECENTPROJ000003": SPLASH_TEMPLATE_LANDING_HTML,
  "01J8F9H1A0RECENTPROJ000004": PORTFOLIO_PLAYGROUND_HTML,
  "01J8F9H1A0RECENTPROJ000005": MARKET_UPDATE_MICROSITE_HTML,
};
