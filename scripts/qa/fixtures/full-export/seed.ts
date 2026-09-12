// Only constructs fixtures in the runner-owned profile; not authentication evidence.
import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { createProjectRecord } from "../../../../packages/backend/src/db/seed";
import { DECK_STAGE_JS } from "../../../../packages/backend/src/runtime/deck-stage";
const homeArgument = process.argv[2];
assert.ok(homeArgument);
const home = await realpath(homeArgument);
assert.ok(path.basename(home).startsWith("burnguard-e2e-home-"));
assert.equal(process.env.BG_APP_ROOT, path.join(home, ".burnguard"));
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#1278c4"/></svg>';
const doc = (body: string, css = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Export fixture</title><style>*{box-sizing:border-box}html,body{margin:0;font-family:Arial,sans-serif}h1{margin:0;padding:32px;font-size:36px}p{font-size:20px}${css}</style></head><body>${body}</body></html>`;
const web = doc('<main><h1 data-bg-node-id="hero">EXPORT_WEB_SENTINEL</h1><img src="assets/tile.svg" alt="Blue tile"><p data-bg-node-id="poor" style="color:#aaa;background:#fff;font-size:10px">Low contrast advisory</p><h3 data-bg-node-id="jump">Details</h3><button data-bg-node-id="action">OK</button><input data-bg-node-id="input"><a href="about.html">About fixture</a></main>', 'main{padding:20px}');
const deck = doc([1, 2].map(i => `<section data-slide data-bg-node-id="slide-${i}" style="background:${i === 1 ? '#1278c4' : '#d46b24'};color:white"><h1>EXPORT_SLIDE_${i}</h1><p>Image slide ${i}</p><aside data-speaker-notes>NOTES_SENTINEL_${i}</aside></section>`).join('') + '<script src="runtime/deck-stage.js"></script>', '[data-slide]{width:1280px;height:720px;overflow:hidden}[data-speaker-notes]{display:none}');
const graphics = (frames: readonly {width: number; height: number}[], detail = false) => doc(frames.map((f, i) => `<article data-graphic-artboard data-bg-node-id="artboard-${i}" style="width:${f.width}px;height:${f.height}px;background:${i ? '#d46b24' : '#1278c4'};color:white;overflow:hidden">${detail ? [2000, 3500, 1000].map((h, j) => `<section data-bg-node-id="section-${j}" style="height:${h}px;background:${['#1278c4','#d46b24','#26884a'][j]}"><h1>SLICE_${j}</h1></section>`).join('') : `<h1>GRAPHIC_${i}</h1>`}</article>`).join(''));
const result: Record<string, unknown> = {};
async function seed(key: string, type: "prototype" | "slide_deck" | "graphic" | "other" | "from_template", html: string, options: object = {}, extra: Record<string, string> = {}) {
  const entrypoint = type === "slide_deck" ? "deck.html" : "index.html";
  const created = await createProjectRecord({ name: `Full export ${key}`, type, designSystemId: null, backendId: "claude-code", optionsJson: JSON.stringify(options), entrypoint, thumbnailPath: null,
    initializeArtifact: async stage => {
      for (const [relative, bytes] of Object.entries({ [entrypoint]: html, ...extra })) {
        const target = path.join(stage, relative); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes);
      }
    } });
  await writeFile(path.join(created.dir_path, '.attachments', 'private-sentinel.txt'), 'PRIVATE_EXPORT_SENTINEL');
  result[key] = created;
}
await seed('web', 'prototype', web.replace('</main>', '<img src="assets/large.svg" alt="Large blue tile"></main>'), {}, { 'assets/tile.svg': svg, 'assets/large.svg': svg.replace('</svg>', `<!--${'a'.repeat(121_000)}--></svg>`), 'about.html': doc('<h1>ABOUT_SENTINEL</h1>') });
await seed('deck', 'slide_deck', deck, { use_speaker_notes: true }, { 'runtime/deck-stage.js': DECK_STAGE_JS });
for (const type of ['other', 'from_template'] as const) await seed(type, type, doc(`<h1>EXPORT_${type}_SENTINEL</h1>`));
for (const [key, kind, frames] of [
  ['single', 'single', [{width:640,height:480}]],
  ['multi', 'card_news', [{width:640,height:480},{width:640,height:480}]],
  ['mixed', 'banner_set', [{width:640,height:480},{width:800,height:400}]],
  ['detail', 'product_detail', [{width:640,height:6500}]],
] as const) {
  await seed(key, 'graphic', graphics(frames, key === 'detail'), {
    graphic_canvas: { schema_version:1, ...frames[0] },
    graphic_set: { schema_version:1, kind, frame_count:frames.length, ...(kind === 'banner_set' ? {frames:frames.map((frame,i)=>({...frame,label:`Banner ${i}`}))} : {}) },
  });
}
await seed('clean', 'prototype', doc('<main><h1>Clean review fixture</h1><p>Readable content.</p><button>Download report</button></main>'));
await seed('lintFailure', 'prototype', doc(`<h1>Large widget</h1><div>${'x'.repeat(1_010_000)}</div>`));
console.log(JSON.stringify(result));
