# README images

`burnguard-cover.png` is an AI-generated editorial concept illustration for the BurnGuard README, not a screenshot of the application. It was generated on 2026-09-09 with the built-in `image_gen` tool and copied into this directory without image conversion or retouching. No fallback CLI was used.

The cover is 1942 × 809 pixels.

## Actual interface screenshots

The three 1440 × 900 screenshots were captured on 2026-09-09 using the repository's Node/Playwright browser QA and an isolated seeded local profile. They contain no user's projects or conversations and were copied without image editing.

- `workspace-home.png`: the My Projects view after keyboard navigation. It shows a real rendered project thumbnail and the other cards' actual unavailable/retry states. The QA edit marker in the first thumbnail comes from the preceding persistence check.
- `workspace-editor.png`: the bundled Portfolio Playground example before the QA edits.
- `project-create.png`: the graphic project dialog with sample input, before creation.

Source capture lane: `workspace-diagnosis`, 27 browser cases passed. Thumbnail publication readiness is reported separately: one sample was ready and three were unavailable at the capture deadline. These screenshots do not assert that every thumbnail renderer or external model worked.

## Final generation prompt

```text
Use case: stylized-concept
Asset type: README editorial cover, concept illustration rather than an actual app screenshot.
Primary request: A wide editorial cover for BurnGuard, a local-first AI design workspace for slide decks, prototypes and graphics.
Scene/backdrop: Warm off-white studio background.
Subject: Tactile layered paper and translucent glass panels forming an abstract workspace with a slide layout, a wireframe and a graphic card.
Composition/framing: Landscape composition, approximately 2.4:1 aspect ratio, precise refined arrangement and generous whitespace.
Lighting/mood: Soft studio light with subtle soft shadows.
Color palette: Warm off-white, deep ink/navy and cobalt blue.
Text (verbatim): "BurnGuard" beautifully set in simple clean bold type. The only readable text must be exactly BurnGuard; spell it B-u-r-n-G-u-a-r-d.
Constraints: Abstract editorial concept illustration, not a fake app screenshot. No vendor logos, no claims, no extra words, no watermarks, no excessive gradients.
```

Visual check: the title reads “BurnGuard”; the slide, wireframe, and graphic motifs are legible; the composition uses the requested palette and wide framing. No additional readable copy or vendor logos appear.
