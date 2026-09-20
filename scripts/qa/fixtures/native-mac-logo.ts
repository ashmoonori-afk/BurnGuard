// Constructs one deterministic, provider-free logo fixture in the runner-owned native QA profile.
import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { runMigrations } from "../../../packages/backend/src/db/migrate-local";
import { createProjectRecord } from "../../../packages/backend/src/db/seed";

const profileArgument = process.argv[2];
assert.ok(profileArgument, "Owned profile path is required");
const profile = await realpath(profileArgument);
assert.ok(path.basename(profile).startsWith("burnguard-native-mac-"));
assert.ok(process.env.BG_APP_ROOT);
assert.equal(await realpath(process.env.BG_APP_ROOT), profile);
await runMigrations();

const editBaseline = "NATIVE_LOGO_BASELINE";
const editPersisted = "NATIVE_LOGO_PERSISTED";
const pages = Array.from({ length: 8 }, (_, index) => `
<section data-graphic-artboard style="width:1920px;height:1080px;background:${index % 2 === 0 ? "#fff7ed" : "#172554"};color:${index % 2 === 0 ? "#172554" : "#fff7ed"}">
  ${index === 0 ? `<h1 data-bg-node-id="native-logo-title">${editBaseline}</h1>` : `<h2>Native guideline ${index + 1}</h2>`}
  <p>Deterministic package acceptance page ${index + 1}</p>
</section>`).join("");
const guidelines = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Native logo acceptance</title><style>
*{box-sizing:border-box}html,body{margin:0}body{font-family:Arial,sans-serif}[data-graphic-artboard]{position:relative;overflow:hidden;padding:128px;display:grid;place-content:center;gap:24px}h1{position:absolute;inset:0;margin:0;display:grid;place-items:center;font-size:104px}h2{margin:0;font-size:96px}p{font-size:28px}
</style></head><body>${pages}</body></html>`;
const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><title>Native QA mark</title><rect x="48" y="48" width="416" height="416" rx="96" fill="#172554"/><path d="M144 320 L256 128 L368 320 Z" fill="#f97316"/><circle cx="256" cy="320" r="48" fill="#fff7ed"/></svg>`;

const created = await createProjectRecord({
  name: "Native Logo Acceptance",
  type: "logo",
  designSystemId: null,
  backendId: "codex",
  optionsJson: JSON.stringify({
    logo_set: {
      schema_version: 1,
      brand_name: "Native Logo Acceptance",
      niche: "Release QA",
      character: ["deterministic", "native"],
      logo_type: "combination",
      symbol_keywords: ["shield", "signal"],
    },
  }),
  entrypoint: "index.html",
  thumbnailPath: null,
  initializeArtifact: async (stage) => {
    await mkdir(stage, { recursive: true });
    await writeFile(path.join(stage, "index.html"), guidelines);
    await writeFile(path.join(stage, "logo.svg"), logoSvg);
  },
});

console.log(JSON.stringify({
  projectId: created.id,
  projectRelPath: path.relative(profile, await realpath(created.dir_path)),
  editBaseline,
  editPersisted,
  setup: "owned deterministic fixture; no provider or authentication claim",
}));
