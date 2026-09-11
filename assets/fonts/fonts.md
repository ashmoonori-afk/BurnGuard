# BurnGuard bundled font catalog

<!-- BUNDLED_FONT_REFERENCE -->
Read this file before choosing a typeface. Every family below is already on disk in
this project's `fonts/` directory and declared in `fonts/fonts.css`; link that stylesheet
and use the family names exactly as written. Never load a font from a CDN or Google Fonts
URL, and never introduce a family that is not in this file unless the design system
supplies its own brand font.

Sizes are the shipped WOFF2 bytes. "Hangul" is the measured number of modern Korean
syllables (U+AC00-U+D7A3) in the font's cmap, out of 11,172. Fonts with fewer than
11,172 syllables cover the KS X 1001 set (2,350 common syllables) plus extras and are
safe for headings and short display copy only; body text in those faces can produce
missing-glyph boxes for rare syllables, so always give them a full-coverage fallback.

## Quick chooser by role

| Role | Default | Alternatives (pick by voice) |
|---|---|---|
| Body, UI, Korean+English | Pretendard | Noto Sans KR (institutional), IBM Plex Sans KR (technical), Gowun Dodum (soft) |
| Body, Latin-only page | DM Sans | Figtree, Public Sans, Manrope, Plus Jakarta Sans, Geist |
| Long-form reading, serif | Newsreader (Latin) + Noto Serif KR (Korean) | Lora, Gowun Batang, Nanum Myeongjo |
| Product / tech display | Space Grotesk | Geist, Sora, Instrument Sans, Outfit |
| Editorial / luxury display | DM Serif Display | Playfair Display, Bodoni Moda, Instrument Serif, Fraunces |
| Poster / impact display | Bebas Neue | Anton, Syne, Black Han Sans, Gasoek One |
| Friendly / rounded display | Urbanist | Jua, Do Hyeon, Gowun Dodum |
| Handwritten accent | Nanum Pen Script | Single Day |
| Code, tabular numbers | IBM Plex Mono | JetBrains Mono, Geist Mono |
| Korean serif display with weight range | Noto Serif KR | Hahmlet (headings only) |

Rules that apply to every choice:

- Two families per artifact at most (display + body), plus mono only when code or
  tabular data appears. Weight contrast inside one variable family is a valid "pair".
- Any Latin display face used on Korean text needs a full-coverage Korean family behind
  it in the same `font-family` stack, e.g. `'Playfair Display', 'Noto Serif KR', serif`.
- Korean body text: line-height 1.6-1.8, tracking 0 or slightly positive. Latin display
  above 48px: tracking -1% to -3%. Never apply negative tracking to Hangul.
- Static families ship one weight (400 unless stated). Do not request `font-weight: 700`
  from them; the browser fakes it. Use a variable family when you need a weight ramp.

## Latin sans-serif

### DM Sans
- File `DMSans.woff2`, 87 KB, variable wght 100-1000, opsz-tuned, Hangul 0.
- Voice: geometric, low-contrast, quietly friendly; the bundle's default body face.
- Use: landing-page body, UI labels, deck body text, captions.
- Pair: DM Serif Display or Space Grotesk headings; Pretendard for Korean.
- Avoid: display sizes above 64px where it looks generic.

### Space Grotesk
- File `SpaceGrotesk.woff2`, 48 KB, variable wght 300-700, Hangul 0.
- Voice: quirky grotesk with distinctive g/y/a, product and tech energy.
- Use: hero headlines for SaaS and developer tools, section titles, dark-mode UI.
- Pair: DM Sans body; IBM Plex Mono for code; Pretendard for Korean.
- Avoid: long body paragraphs; the letterforms fight at small sizes.

### Geist
- File `Geist.woff2`, 68 KB, variable wght 100-900, Hangul 0.
- Voice: neutral neo-grotesque, tight, screen-native; reads "modern app".
- Use: product UI, dashboards, dense slide body text, metadata rows.
- Pair: Geist Mono (matched set), Instrument Serif for editorial contrast.
- Avoid: warmth-driven brands; it is deliberately impersonal.

### Plus Jakarta Sans
- File `PlusJakartaSans.woff2`, 59 KB, variable wght 200-800, Hangul 0.
- Voice: geometric-humanist with a friendly single-storey a at display sizes.
- Use: marketing landing pages, startup decks, social carousel copy.
- Pair: Playfair Display headings, JetBrains Mono for code.
- Avoid: formal or governmental content.

### Figtree
- File `Figtree.woff2`, 27 KB, variable wght 300-900, Hangul 0.
- Voice: warm geometric, large x-height, very legible small; smallest file in the set.
- Use: body copy, UI chrome, captions on social graphics, mobile-first pages.
- Pair: Fraunces or Lora headings.
- Avoid: nothing in particular; it is a safe general-purpose body face.

### Manrope
- File `Manrope.woff2`, 52 KB, variable wght 200-800, Hangul 0.
- Voice: semi-geometric with flat terminals; fintech / clean SaaS feel.
- Use: pricing tables, data-slide labels, hero + body on product sites.
- Pair: Newsreader or Syne headings.
- Avoid: pairing with another neutral grotesque (Geist, Public Sans); they blur together.

### Outfit
- File `Outfit.woff2`, 44 KB, variable wght 100-900, Hangul 0.
- Voice: pure geometric, near-monoline; logo-adjacent.
- Use: poster headlines, big deck titles, wordmark-style hero text, numerals.
- Pair: Lora body for contrast, IBM Plex Mono for data.
- Avoid: paragraphs longer than two lines; monoline geometry tires the eye.

### Instrument Sans
- File `InstrumentSans.woff2`, 87 KB, variable wdth 75-100 and wght 400-700, Hangul 0.
- Voice: grotesque with a real width axis; condense headlines without a second family.
- Use: responsive headlines, tight card titles, social graphics needing narrow text.
- Pair: Instrument Serif (designed as a set), Pretendard for Korean.
- Avoid: weights below 400; the axis starts at Regular.

### Public Sans
- File `PublicSans.woff2`, 41 KB, variable wght 100-900, Hangul 0.
- Voice: deliberately neutral (US Web Design System origin), accessibility-first.
- Use: government, enterprise and form-heavy pages, accessible decks, documentation.
- Pair: Newsreader headings, IBM Plex Mono.
- Avoid: expressive brand work; it has no personality by design.

### Sora
- File `Sora.woff2`, 48 KB, variable wght 100-800, Hangul 0.
- Voice: squarish bowls, technical, crypto/dev-tool modern.
- Use: developer-tool sites, technical deck headers, dark-theme UI.
- Pair: JetBrains Mono, Space Grotesk (same mood), Noto Sans KR for Korean.
- Avoid: editorial or lifestyle content.

### Urbanist
- File `Urbanist.woff2`, 37 KB, variable wght 100-900, Hangul 0.
- Voice: low-contrast geometric, airy, Futura-like without the tiny x-height.
- Use: lifestyle and brand pages, quote slides, minimal social posts.
- Pair: Bodoni Moda or Instrument Serif headings; Gowun Dodum for Korean.
- Avoid: dense tables; wide letterforms cost horizontal space.

## Latin serif and display

### DM Serif Display
- File `DMSerifDisplay.woff2`, 31 KB, static 400, Hangul 0.
- Voice: high-contrast transitional display serif; editorial, premium.
- Use: magazine-style headlines, luxury hero, pull quotes on decks.
- Pair: DM Sans body (same lineage); Gowun Batang for Korean headings.
- Avoid: anything below 24px; hairlines vanish.

### Instrument Serif
- File `InstrumentSerif.woff2`, 27 KB, static 400, Hangul 0.
- Voice: condensed high-contrast display serif; the current "expensive startup" look.
- Use: hero headlines, title slides, quote cards, numerals on covers.
- Pair: Instrument Sans or Geist body.
- Avoid: body text and small labels.

### Playfair Display
- File `PlayfairDisplay.woff2`, 104 KB, variable wght 400-900, Hangul 0.
- Voice: transitional high-contrast display; the reliable editorial default.
- Use: magazine headlines, luxury hero, event invitations, testimonial slides.
- Pair: Plus Jakarta Sans or Figtree body; Noto Serif KR for Korean.
- Avoid: sizes under 20px; use Lora or Newsreader for reading text.

### Lora
- File `Lora.woff2`, 83 KB, variable wght 400-700, Hangul 0.
- Voice: brushed-contrast text serif with calligraphic roots; excellent at body sizes.
- Use: blog and article body, testimonial slides, quote graphics.
- Pair: Figtree or Outfit headings; Nanum Myeongjo for Korean body.
- Avoid: nothing; it is the safest Latin reading serif here.

### Fraunces
- File `Fraunces.woff2`, 191 KB, variable opsz 9-144, wght 100-900, SOFT 0-100, WONK 0-1, Hangul 0.
- Voice: the most expressive serif in the bundle; WONK swaps in eccentric alternates.
- Use: playful brand headlines, poster slides, food/craft/lifestyle covers.
- Pair: Figtree or Public Sans body. Set `font-variation-settings: "SOFT" 100, "WONK" 1`
  for the full personality, `"WONK" 0` for a calmer serif.
- Avoid: corporate or legal content; keep opsz low (9-18) for running text.

### Newsreader
- File `Newsreader.woff2`, 211 KB, variable opsz 6-72, wght 200-800, Hangul 0.
- Voice: news-text serif that scales from caption to headline via optical size.
- Use: long-form article body, editorial decks, newsletter graphics, reports.
- Pair: Public Sans or Manrope; Noto Serif KR for Korean body.
- Avoid: nothing; if you can only ship one Latin serif, this is it.

### Bodoni Moda
- File `BodoniModa.woff2`, 72 KB, variable opsz 6-96, wght 400-900, Hangul 0.
- Voice: extreme-contrast didone; fashion, beauty, luxury.
- Use: fashion/luxury hero, title slides, editorial social covers, single-word statements.
- Pair: Urbanist or Instrument Sans body; Hahmlet for Korean display.
- Avoid: body text entirely; hairlines fail below ~28px even with opsz.

### Syne
- File `Syne.woff2`, 59 KB, variable wght 400-800, Hangul 0.
- Voice: art-gallery display sans with wide, wild extrabolds.
- Use: event posters, section dividers, art-direction social graphics, festival decks.
- Pair: DM Sans or Manrope body; Gasoek One or Black Han Sans for Korean display.
- Avoid: weights above 700 at paragraph size.

### Anton
- File `Anton.woff2`, 56 KB, static 400, Hangul 0.
- Voice: ultra-condensed heavy grotesque with full lowercase (Bebas Neue is caps-only).
- Use: full-bleed headlines, sports and event graphics, big numbers on slides.
- Pair: Lora body for contrast; Black Han Sans for Korean.
- Avoid: mixed-case running text longer than one line.

### Bebas Neue
- File `BebasNeue.woff2`, 21 KB, static 400, caps-only, Hangul 0.
- Voice: tall condensed all-caps; poster and label workhorse.
- Use: kicker labels, poster headlines, stat callouts.
- Pair: DM Sans body; Black Han Sans for Korean impact.
- Avoid: sentences; there is no lowercase, so use it for short caps only.

## Monospace

### IBM Plex Mono
- File `IBMPlexMono.woff2`, 38 KB, static 400, Hangul 0.
- Voice: engineered, slightly warm; the bundle's default code face.
- Use: code blocks, tabular numerals, terminal-style panels.
- Pair: Space Grotesk, IBM Plex Sans KR (same family voice).
- Avoid: bold weights (static 400 only).

### JetBrains Mono
- File `JetBrainsMono.woff2`, 70 KB, variable wght 100-800, Hangul 0.
- Voice: tall x-height, generous spacing, designed for long code reading.
- Use: code samples on developer pages, terminal decks, changelog slides.
- Pair: Sora or Geist; Noto Sans KR for Korean comments.
- Avoid: nothing; use it whenever a bold mono weight is needed.

### Geist Mono
- File `GeistMono.woff2`, 69 KB, variable wght 100-900, Hangul 0.
- Voice: clean, neutral mono matched to Geist.
- Use: UI metadata, inline code, data tables next to Geist body.
- Pair: Geist (matched set).
- Avoid: pairing with a second mono in the same artifact.

## Korean (full coverage: all 11,172 syllables)

### Pretendard
- File `PretendardVariable.woff2`, 2,009 KB, variable wght 45-930, Hangul 11,172.
- Voice: neutral modern Korean sans with Inter-derived Latin; the default Korean fallback.
- Use: every Korean body and UI role; append it as the fallback of any Latin stack.
- Pair: anything; weight contrast inside Pretendard is a complete system on its own.
- Avoid: nothing.

### Noto Sans KR
- File `NotoSansKR.woff2`, 3,817 KB, variable wght 100-900, Hangul 11,172.
- Voice: institutional, maximally safe, slightly wider than Pretendard.
- Use: government and public-sector pages, long Korean documents, anything needing the
  most recognisable "standard" Korean sans.
- Pair: Noto Serif KR headings; Public Sans or Inter-like Latin.
- Avoid: using it alongside Pretendard in one artifact; pick one neutral sans.

### IBM Plex Sans KR
- File `IBMPlexSansKR.woff2`, 548 KB, static 400, Hangul 11,172.
- Voice: engineered, technical, warm-cornered.
- Use: product docs, data slides, changelogs, developer-facing Korean UI.
- Pair: IBM Plex Mono (same family), Geist.
- Avoid: bold headings (static 400); use Pretendard 700 for weight.

### Gowun Dodum
- File `GowunDodum.woff2`, 435 KB, static 400, Hangul 11,172.
- Voice: soft, humanist, low-contrast Korean sans; friendly and calm.
- Use: wellness, education, community landing pages, quote cards, storytelling decks.
- Pair: Gowun Batang (sibling serif), Urbanist or Figtree Latin.
- Avoid: dense dashboards; it is too gentle for data.

### Gowun Batang
- File `GowunBatang.woff2`, 523 KB, static 400, Hangul 11,172.
- Voice: modern Korean serif with a soft, literary feel.
- Use: Korean editorial headings, cinematic titles, long Korean reading on paper-toned pages.
- Pair: DM Serif Display or Lora Latin; Gowun Dodum body.
- Avoid: sizes under 14px on dark backgrounds.

### Nanum Myeongjo
- File `NanumMyeongjo.woff2`, 523 KB, static 400, Hangul 11,172.
- Voice: classic Myeongjo with print heritage; formal and trustworthy.
- Use: book-like layouts, annual reports, testimonials, elegant title slides.
- Pair: Lora or Newsreader Latin; Pretendard body for UI.
- Avoid: playful or tech brands.

### Noto Serif KR
- File `NotoSerifKR.woff2`, 5,721 KB, variable wght 200-900, Hangul 11,172.
- Voice: authoritative Korean serif; the only full-coverage Korean serif with a weight range.
- Use: Korean long-form articles, reports, pull quotes, serif headings needing 700-900.
- Pair: Playfair Display or Newsreader Latin; Noto Sans KR body.
- Avoid: choosing it when a static 400 serif (Nanum Myeongjo, Gowun Batang) would do;
  it is the largest file in the bundle.

### Nanum Pen Script
- File `NanumPenScript.woff2`, 601 KB, static 400, Hangul 11,172.
- Voice: ballpoint-pen handwriting; casual and personal.
- Use: annotation callouts on slides, "handwritten note" overlays, sticker-style labels.
- Pair: Pretendard or Gowun Dodum body; never a second script.
- Avoid: paragraphs and anything below 18px.

### Single Day
- File `SingleDay.woff2`, 91 KB, static 400, Hangul 11,172.
- Voice: marker-pen handwriting, bolder and rounder than Nanum Pen Script.
- Use: playful promo headlines, event posters, kids and community graphics.
- Pair: Jua or Pretendard.
- Avoid: formal content; body text.

## Korean display (KS X 1001 class: headings and short copy only)

### Hahmlet
- File `Hahmlet.woff2`, 681 KB, variable wght 100-900, Hangul 2,788.
- Voice: contemporary high-contrast Korean serif, magazine-like.
- Use: Korean editorial display at large sizes, fashion and culture covers, title slides.
- Pair: Bodoni Moda or Playfair Display Latin; Noto Serif KR as the fallback for body.
- Avoid: body text (partial coverage); stack `'Hahmlet', 'Noto Serif KR', serif`.

### Black Han Sans
- File `BlackHanSans.woff2`, 186 KB, static 400 (black), Hangul 2,581.
- Voice: ultra-heavy poster sans; loud and immediate.
- Use: sale banners, thumbnail text, social headlines, one-line hero statements.
- Pair: Anton or Bebas Neue Latin; Pretendard body.
- Avoid: more than two lines; body text; stack with `'Pretendard'` fallback.

### Do Hyeon
- File `DoHyeon.woff2`, 200 KB, static 400, Hangul 2,437.
- Voice: chunky signage feel, friendly and bold.
- Use: event posters, section dividers, YouTube-style thumbnails, menu boards.
- Pair: Outfit or Anton Latin; Pretendard body.
- Avoid: body text; stack with `'Pretendard'` fallback.

### Jua
- File `Jua.woff2`, 360 KB, static 400, Hangul 2,367.
- Voice: rounded, childlike, approachable.
- Use: kids and education material, casual promos, sticker graphics, snack brands.
- Pair: Urbanist or Figtree Latin; Gowun Dodum body.
- Avoid: corporate or premium content; body text.

### Gasoek One
- File `GasoekOne.woff2`, 295 KB, static 400, Hangul 2,780.
- Voice: extreme-weight display with a retro, cut-paper edge.
- Use: single-word hero statements, cover slides, festival and street-culture graphics.
- Pair: Syne or Anton Latin; Noto Sans KR body.
- Avoid: anything below 40px.

### Orbit
- File `Orbit.woff2`, 213 KB, static 400, Hangul 2,780.
- Voice: squared, techno, sci-fi display with matching Latin.
- Use: game, esports, tech-event headlines; futuristic product teasers.
- Pair: Sora or Space Grotesk Latin; Pretendard body.
- Avoid: warm or traditional brands; body text.

## Korean coverage summary

| Family | Syllables | Body-safe |
|---|---|---|
| Pretendard, Noto Sans KR, IBM Plex Sans KR, Gowun Dodum, Gowun Batang, Nanum Myeongjo, Noto Serif KR, Nanum Pen Script, Single Day | 11,172 | yes |
| Hahmlet | 2,788 | headings only |
| Gasoek One, Orbit | 2,780 | headings only |
| Black Han Sans | 2,581 | headings only |
| Do Hyeon | 2,437 | headings only |
| Jua | 2,367 | headings only |

Every Latin-only family has 0 Hangul syllables and must be stacked with one of the
body-safe Korean families whenever the artifact contains Korean text.

## Licensing

- All 39 families are under the SIL Open Font License 1.1; each `*.woff2` ships with its
  own `*-OFL.txt` (copyright notice + license text). Keep the license file next to the
  font whenever fonts are copied or exported. OFL fonts may be bundled with software and
  used in commercial documents; they may not be sold on their own.
- The WOFF2 files are lossless repackagings of the upstream TTFs (no subsetting, no
  metadata block; only the DSIG signature table is removed, as the WOFF2 spec requires).
  Per the OFL FAQ this is not a "Modified Version", so families with Reserved Font Names
  (Playfair Display, Lora, Nanum Myeongjo, Nanum Pen Script, Noto Sans KR, IBM Plex Sans
  KR, IBM Plex Mono, DM Serif Display, Pretendard) keep their original names.
- Do not subset or rename these files inside an artifact. Subsetting an OFL font with a
  Reserved Font Name would require renaming it.
- `manifest.json` records the upstream source URL (pinned to a google/fonts commit for
  the 2026-09-11 additions), license file, measured Hangul coverage and Reserved Font
  Names for every family.

## Proposed features (not yet implemented)

1. Pairing recommender: ship the "Quick chooser" table as data in `manifest.json`
   (`pairings: [{display, body, korean, mood}]`) so the harness can inject one suggested
   pair per project mood instead of the agent improvising.
2. Per-project font pruning on export: exports already close over referenced files, but
   the local project copy carries all 17.4 MiB, and a first boot seeds it into ~92
   directories (78 projects + 22 design systems), about 1.6 GB of writes. A post-generation step could delete
   unreferenced `fonts/*.woff2` (and their license files) from the artifact, keeping the
   catalog intact in `assets/fonts/`.
3. Hangul coverage audit in the design audit: extend `design-audit-dom` with a
   `missing_glyph` check that compares each text node's characters against the chosen
   family's `hangulSyllables` class and flags KS X 1001 faces used on body text.
4. Specimen sheet route: render `fonts/fonts.md` as an HTML specimen (pangram + Hangul
   sample at 14/24/48px per family) so users and reviewers judge from rendering, not names.
5. Manifest-driven `fonts.css` generation: derive `fonts.css` and this catalog's size and
   coverage columns from `manifest.json` in a build script, with a test asserting the
   generated output matches the checked-in files.
6. Variable-axis presets: expose named `font-variation-settings` presets for Fraunces
   (SOFT/WONK), Newsreader and Bodoni Moda (opsz) as CSS custom properties in the
   default visual identity.
7. Provenance hash pinning: add `sha256` per file to `manifest.json` and verify it in the
   bundled-fonts test so a re-download that silently changes upstream bytes is caught.
8. Core/extended split: copy a core set (Pretendard, DM Sans, Space Grotesk, DM Serif
   Display, IBM Plex Mono, Gowun Batang, Noto Sans KR) into every project and the rest on
   demand, cutting the per-project copy from 17.4 MiB to ~6 MB and first-boot writes accordingly;
   hard-linking the immutable `*.woff2` files (copy fallback across volumes) is the
   alternative that keeps `fonts.css` byte-identical in every project.
9. Size-policy ADR update: `doc/07-decisions.md` counts "~30 MB of font files" for the
   whole binary, but `design system sample/` already ships 31.9 MB of KoPub TTFs and this
   bundle adds 17.4 MB. Record the real payload and set separate budgets.
