import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { attachDraftReleaseAssets } from "./release-draft-state.mjs";

const windows = {
  repository: "owner/repo",
  platform: "windows",
  tag: "v0.5.23",
  title: "BurnGuard v0.5.23",
  notes: "Draft release",
  assets: ["dist/releases/BurnGuard-win-Setup.exe", "dist/releases/releases.win.json", "dist/releases/SHA256SUMS.txt"],
};
const macos = { ...windows, platform: "macos", assets: ["dist/releases/BurnGuard-osx-Setup.pkg", "dist/releases/releases.osx.json", "dist/releases/SHA256SUMS-macos.txt"] };
const names = input => input.assets.map(value => value.split("/").at(-1));
const release = (draft = true, assets = [], tag = windows.tag, id = 23) => ({ id, tag_name: tag, draft, assets: assets.map(name => ({ name })) });
const response = (status, body = null) => ({ status: status >= 200 && status < 300 ? 0 : 1, signal: null, stdout: `HTTP/2.0 ${status} status\ncontent-type: application/json\n\n${body === null ? "" : JSON.stringify(body)}` });

function fake(sequence) {
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, args, options });
    const next = sequence.shift();
    if (next === undefined) throw new Error("unexpected_process_call");
    return next;
  };
  return { run, calls };
}

function uploadSequence(input, id = 23) {
  const uploaded = [];
  return input.assets.flatMap(asset => {
    const current = release(true, uploaded, input.tag, id);
    uploaded.push(asset.split("/").at(-1));
    return [response(200, current), response(201, { id: 100 + uploaded.length, name: uploaded.at(-1) })];
  });
}

function concurrencyBlock(text) {
  const lines = text.split(/\r?\n/);
  const index = lines.indexOf("concurrency:");
  if (index < 0 || !lines[index + 1]?.startsWith("  group: ") || !lines[index + 2]?.startsWith("  cancel-in-progress: ")) return undefined;
  return [lines[index + 1].slice("  group: ".length), lines[index + 2].slice("  cancel-in-progress: ".length)];
}

function expectIdUpload(call, input, asset, id = 23) {
  expect(call.args).toEqual([
    "api",
    `https://uploads.github.com/repos/${input.repository}/releases/${id}/assets?name=${encodeURIComponent(asset.split("/").at(-1))}`,
    "--method",
    "POST",
    "--header",
    "Content-Type: application/octet-stream",
    "--input",
    asset,
    "--include",
  ]);
  expect(call.args).not.toContain("--hostname");
  expect(call.args[1]).not.toContain("api.uploads.github.com");
  expect(call.args).not.toContain("release");
  expect(call.args).not.toContain(input.tag);
  expect(call.args).not.toContain("--clobber");
}

describe("release draft asset attachment", () => {
  test("uploads unique assets only to the release id that remains draft", () => {
    const stub = fake([response(200, release()), ...uploadSequence(windows)]);
    expect(attachDraftReleaseAssets(windows, stub.run).uploaded).toEqual(names(windows));
    for (let index = 0; index < windows.assets.length; index += 1) {
      expect(stub.calls[1 + index * 2].args).toEqual(["api", "repos/owner/repo/releases/23", "--include"]);
      expectIdUpload(stub.calls[2 + index * 2], windows, windows.assets[index]);
    }
  });

  test("encodes the asset filename in the absolute verified-id upload URL", () => {
    const input = { ...windows, assets: ["dist/releases/BurnGuard win Setup #1.exe"] };
    const stub = fake([response(200, release()), ...uploadSequence(input)]);
    expect(attachDraftReleaseAssets(input, stub.run).releaseId).toBe(23);
    expectIdUpload(stub.calls[2], input, input.assets[0]);
    expect(stub.calls[2].args[1]).toBe("https://uploads.github.com/repos/owner/repo/releases/23/assets?name=BurnGuard%20win%20Setup%20%231.exe");
  });

  test("rejects a publication race before upload", () => {
    const stub = fake([response(200, release()), response(200, release(false))]);
    expect(() => attachDraftReleaseAssets(windows, stub.run)).toThrow("release_not_draft");
    expect(stub.calls).toHaveLength(2);
  });

  test("finds one exact draft through the authenticated release list", () => {
    const stub = fake([response(404), response(200, [release(true, [], "v0.5.22"), release()]), ...uploadSequence(windows)]);
    expect(attachDraftReleaseAssets(windows, stub.run).releaseId).toBe(23);
    expect(stub.calls[1].args).toEqual(["api", "repos/owner/repo/releases?per_page=100", "--include"]);
  });

  test("fails closed when the authenticated list contains duplicate exact tags", () => {
    const stub = fake([response(404), response(200, [release(true, [], windows.tag, 23), release(true, [], windows.tag, 24)])]);
    expect(() => attachDraftReleaseAssets(windows, stub.run)).toThrow("duplicate_release_tag");
    expect(stub.calls).toHaveLength(2);
  });

  test("creates a missing draft and attaches after re-reading it by id", () => {
    const stub = fake([response(404), response(200, []), response(200, { ref: "refs/tags/v0.5.23" }), response(201, release()), ...uploadSequence(windows)]);
    expect(attachDraftReleaseAssets(windows, stub.run).releaseId).toBe(23);
    expect(stub.calls[2].args).toEqual(["api", "repos/owner/repo/git/ref/tags/v0.5.23", "--include"]);
    expect(stub.calls[3].args).toContain("POST");
    expect(JSON.parse(stub.calls[3].options.input).draft).toBe(true);
    expect(stub.calls[4].args).toEqual(["api", "repos/owner/repo/releases/23", "--include"]);
  });

  test("two successful creators remain bound to their distinct returned ids", () => {
    const first = { ...windows, assets: [windows.assets[0]] };
    const second = { ...macos, assets: [macos.assets[0]] };
    const firstStub = fake([response(404), response(200, []), response(200, { ref: "refs/tags/v0.5.23" }), response(201, release(true, [], windows.tag, 23)), ...uploadSequence(first, 23)]);
    const secondStub = fake([response(404), response(200, []), response(200, { ref: "refs/tags/v0.5.23" }), response(201, release(true, [], windows.tag, 24)), ...uploadSequence(second, 24)]);

    expect(attachDraftReleaseAssets(first, firstStub.run).releaseId).toBe(23);
    expect(attachDraftReleaseAssets(second, secondStub.run).releaseId).toBe(24);
    expect(firstStub.calls[3].args).toContain("POST");
    expect(secondStub.calls[3].args).toContain("POST");
    expectIdUpload(firstStub.calls[5], first, first.assets[0], 23);
    expectIdUpload(secondStub.calls[5], second, second.assets[0], 24);
  });

  test("recovers when create reports an existing release", () => {
    const stub = fake([response(404), response(200, []), response(200, { ref: "refs/tags/v0.5.23" }), response(422, { message: "already_exists" }), response(404), response(200, [release()]), ...uploadSequence(windows)]);
    expect(attachDraftReleaseAssets(windows, stub.run).releaseId).toBe(23);
  });

  test("returns read-only success for an already-published release with every requested asset", () => {
    const stub = fake([response(200, release(false, names(windows)))]);
    expect(attachDraftReleaseAssets(windows, stub.run)).toEqual({ releaseId: 23, uploaded: [] });
    expect(stub.calls).toHaveLength(1);
  });

  test("fails closed when an already-published release is missing a requested asset", () => {
    const stub = fake([response(200, release(false, ["BurnGuard-win-Setup.exe"]))]);
    expect(() => attachDraftReleaseAssets(windows, stub.run)).toThrow("published_release_assets_mismatch");
    expect(stub.calls).toHaveLength(1);
  });

  test("fails closed on authentication, server, network, and malformed responses", () => {
    for (const item of [response(401), response(500), { status: 1, signal: null, stdout: "" }, { status: null, signal: "SIGTERM", stdout: "" }]) {
      const stub = fake([item]);
      expect(() => attachDraftReleaseAssets(windows, stub.run)).toThrow();
      expect(stub.calls).toHaveLength(1);
    }
  });

  test("rejects existing and racing duplicate assets", () => {
    let stub = fake([response(200, release(true, ["SHA256SUMS.txt"]))]);
    expect(() => attachDraftReleaseAssets(windows, stub.run)).toThrow("release_asset_exists");
    stub = fake([response(200, release()), response(200, release(true, ["BurnGuard-win-Setup.exe"]))]);
    expect(() => attachDraftReleaseAssets(windows, stub.run)).toThrow("release_asset_exists");
  });

  test("reports an id-bound upload failure", () => {
    const stub = fake([response(200, release()), response(200, release()), response(500)]);
    expect(() => attachDraftReleaseAssets(windows, stub.run)).toThrow("release_upload_http_500");
    expectIdUpload(stub.calls[2], windows, windows.assets[0]);
  });

  test("keeps platform feed and checksum asset names disjoint", () => {
    const win = new Set(names(windows));
    const mac = new Set(names(macos));
    expect([...win].filter(value => mac.has(value))).toEqual([]);
    expect(() => attachDraftReleaseAssets({ ...windows, assets: macos.assets }, fake([]).run)).toThrow("cross_platform_release_asset");
    expect(() => attachDraftReleaseAssets({ ...macos, assets: windows.assets }, fake([]).run)).toThrow("cross_platform_release_asset");
  });

  test("serializes tag runs across both release workflows without cancelling either", () => {
    const workflowPaths = ["../../.github/workflows/windows-release.yml", "../../.github/workflows/macos-release.yml"];
    const texts = workflowPaths.map(value => readFileSync(new URL(value, import.meta.url), "utf8"));
    const blocks = texts.map(concurrencyBlock);
    expect(blocks[0]).toEqual(blocks[1]);
    expect(concurrencyBlock(texts[0].replaceAll("\r\n", "\n").replaceAll("\n", "\r\n"))).toEqual(blocks[0]);
    expect(blocks[0]?.[1]).toBe("false");
    expect(blocks[0]?.[0]).toContain("startsWith(github.ref, 'refs/tags/')");
    expect(blocks[0]?.[0]).toContain("github.workflow, github.run_id");
  });
});
