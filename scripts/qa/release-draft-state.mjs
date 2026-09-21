#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TAG = /^v[0-9A-Za-z][0-9A-Za-z.-]*$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function attachDraftReleaseAssets(input, run = spawnSync) {
  validateInput(input);
  let release = lookupRelease(input.repository, input.tag, run);
  if (release === null) {
    verifyTag(input.repository, input.tag, run);
    const created = createDraft(input, run);
    if (created.status === 201) release = parseRelease(created.body);
    else if (created.status === 422) release = requiredRelease(lookupRelease(input.repository, input.tag, run));
    else throw new Error(`release_create_http_${created.status}`);
  }
  const assetNames = input.assets.map(asset => path.basename(asset));
  if (!release.draft) {
    if (assetNames.every(name => release.assets.includes(name))) return { releaseId: release.id, uploaded: [] };
    throw new Error("published_release_assets_mismatch");
  }
  assertUnique(release, input.assets);

  // GitHub exposes no conditional "upload only while draft" operation. Re-read
  // immediately before the non-clobbering upload and never replace existing bytes.
  release = lookupReleaseById(input.repository, release.id, run);
  if (!release.draft) throw new Error("release_not_draft");
  assertUnique(release, input.assets);
  const uploaded = run("gh", ["release", "upload", input.tag, ...input.assets, "--repo", input.repository], { encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] });
  if (uploaded.error || uploaded.signal || uploaded.status !== 0) throw new Error("release_upload_failed");
  return { releaseId: release.id, uploaded: assetNames };
}

function lookupRelease(repository, tag, run) {
  const response = api(run, [`repos/${repository}/releases/tags/${encodeURIComponent(tag)}`, "--include"]);
  if (response.status === 200) return parseRelease(response.body);
  if (response.status !== 404) throw new Error(`release_lookup_http_${response.status}`);

  const listed = api(run, [`repos/${repository}/releases?per_page=100`, "--include"]);
  if (listed.status !== 200) throw new Error(`release_list_http_${listed.status}`);
  if (!Array.isArray(listed.body)) throw new Error("invalid_release_response");
  const release = listed.body.find(item => item && item.tag_name === tag);
  return release === undefined ? null : parseRelease(release);
}

function lookupReleaseById(repository, releaseId, run) {
  const response = api(run, [`repos/${repository}/releases/${releaseId}`, "--include"]);
  if (response.status !== 200) throw new Error(`release_lookup_http_${response.status}`);
  return parseRelease(response.body);
}

function verifyTag(repository, tag, run) {
  const response = api(run, [`repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`, "--include"]);
  if (response.status !== 200) throw new Error(`release_tag_http_${response.status}`);
}

function createDraft(input, run) {
  return api(run, [`repos/${input.repository}/releases`, "--include", "--method", "POST", "--input", "-"], JSON.stringify({ tag_name: input.tag, name: input.title, body: input.notes, draft: true }));
}

function api(run, args, body) {
  const result = run("gh", ["api", ...args], { encoding: "utf8", input: body, stdio: [body === undefined ? "ignore" : "pipe", "pipe", "ignore"] });
  if (result.error || result.signal) throw new Error("github_api_unavailable");
  const match = /^HTTP\/\S+\s+(\d{3})\b/m.exec(result.stdout ?? "");
  if (match === null) throw new Error("github_api_unavailable");
  const status = Number(match[1]);
  const separator = /\r?\n\r?\n/g;
  let end = 0;
  for (const item of result.stdout.matchAll(separator)) end = item.index + item[0].length;
  let parsed = null;
  const text = result.stdout.slice(end).trim();
  if (text) {
    try { parsed = JSON.parse(text); } catch { throw new Error("invalid_github_response"); }
  }
  if (status >= 200 && status < 300 && result.status !== 0) throw new Error("github_api_unavailable");
  return { status, body: parsed };
}

function parseRelease(value) {
  if (!value || typeof value !== "object" || !Number.isSafeInteger(value.id) || typeof value.draft !== "boolean" || !Array.isArray(value.assets) || value.assets.some(asset => !asset || typeof asset.name !== "string")) throw new Error("invalid_release_response");
  return { id: value.id, draft: value.draft, assets: value.assets.map(asset => asset.name) };
}

function requiredRelease(release) {
  if (release === null) throw new Error("release_missing_after_create");
  return release;
}

function assertUnique(release, assets) {
  const existing = new Set(release.assets);
  if (assets.some(asset => existing.has(path.basename(asset)))) throw new Error("release_asset_exists");
}

function validateInput(input) {
  if (!input || !REPOSITORY.test(input.repository) || !TAG.test(input.tag) || !["windows", "macos"].includes(input.platform) || typeof input.title !== "string" || !input.title || typeof input.notes !== "string" || !input.notes || !Array.isArray(input.assets) || input.assets.length === 0) throw new Error("invalid_release_input");
  const names = input.assets.map(asset => typeof asset === "string" ? path.basename(asset) : "");
  if (names.some(name => !name || name === "." || name === "..") || new Set(names).size !== names.length) throw new Error("invalid_release_assets");
  if (input.platform === "windows" && names.some(name => /osx|macos/i.test(name))) throw new Error("cross_platform_release_asset");
  if (input.platform === "macos" && names.some(name => !/osx|macos/i.test(name))) throw new Error("cross_platform_release_asset");
}

const entry = process.argv[1] === undefined ? null : pathToFileURL(path.resolve(process.argv[1])).href;
if (entry === import.meta.url) {
  try {
    const [platform, tag, title, notes, ...assets] = process.argv.slice(2);
    const result = attachDraftReleaseAssets({ repository: process.env.GITHUB_REPOSITORY, platform, tag, title, notes, assets });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "release_attachment_failed");
    process.exitCode = 1;
  }
}
