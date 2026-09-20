import { describe, expect, test } from "bun:test";
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
const release = (draft = true, assets = []) => ({ id: 23, draft, assets: assets.map(name => ({ name })) });
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

describe("release draft asset attachment", () => {
  test("uploads unique assets to a release that remains draft without clobber", () => {
    const stub = fake([response(200, release()), response(200, release()), { status: 0, signal: null, stdout: "" }]);
    expect(attachDraftReleaseAssets(windows, stub.run).uploaded).toEqual(windows.assets.map(value => value.split("/").at(-1)));
    const upload = stub.calls.at(-1);
    expect(upload.args).toEqual(["release", "upload", windows.tag, ...windows.assets, "--repo", windows.repository]);
    expect(upload.args).not.toContain("--clobber");
  });

  test("rejects a publication race before upload", () => {
    const stub = fake([response(200, release()), response(200, release(false))]);
    expect(() => attachDraftReleaseAssets(windows, stub.run)).toThrow("release_not_draft");
    expect(stub.calls).toHaveLength(2);
  });

  test("creates a missing draft and attaches after re-reading it", () => {
    const stub = fake([response(404, { message: "Not Found" }), response(200, { ref: "refs/tags/v0.5.23" }), response(201, release()), response(200, release()), { status: 0, signal: null, stdout: "" }]);
    expect(attachDraftReleaseAssets(windows, stub.run).releaseId).toBe(23);
    expect(stub.calls[1].args).toEqual(["api", "repos/owner/repo/git/ref/tags/v0.5.23", "--include"]);
    expect(stub.calls[2].args).toContain("POST");
    expect(JSON.parse(stub.calls[2].options.input).draft).toBe(true);
  });

  test("converges after a simultaneous create conflict", () => {
    const stub = fake([response(404), response(200, { ref: "refs/tags/v0.5.23" }), response(422, { message: "already_exists" }), response(200, release()), response(200, release()), { status: 0, signal: null, stdout: "" }]);
    expect(attachDraftReleaseAssets(windows, stub.run).releaseId).toBe(23);
    expect(stub.calls).toHaveLength(6);
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

  test("rejects a duplicate that races the final lookup", () => {
    const stub = fake([response(200, release()), response(200, release()), { status: 1, signal: null, stdout: "" }]);
    expect(() => attachDraftReleaseAssets(windows, stub.run)).toThrow("release_upload_failed");
  });

  test("keeps platform feed and checksum asset names disjoint", () => {
    const win = new Set(windows.assets.map(value => value.split("/").at(-1)));
    const mac = new Set(macos.assets.map(value => value.split("/").at(-1)));
    expect([...win].filter(value => mac.has(value))).toEqual([]);
    expect(() => attachDraftReleaseAssets({ ...windows, assets: macos.assets }, fake([]).run)).toThrow("cross_platform_release_asset");
    expect(() => attachDraftReleaseAssets({ ...macos, assets: windows.assets }, fake([]).run)).toThrow("cross_platform_release_asset");
  });
});
