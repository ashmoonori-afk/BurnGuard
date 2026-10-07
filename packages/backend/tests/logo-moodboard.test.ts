import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  addMoodboardFiles,
  addMoodboardLink,
  moodboardDigest,
  moodboardDirectoryPath,
  moodboardImagePath,
  moodboardManifestPath,
  readLogoMoodboard,
  readMoodboardFile,
  removeMoodboardItem,
} from "../src/services/logo-moodboard";

const FINGERPRINT = "0123456789abcdef";
const fingerprint = async (): Promise<string> => FINGERPRINT;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function png(payload: string): Buffer {
  return Buffer.concat([PNG_SIGNATURE, Buffer.from(payload)]);
}
function jpeg(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
}
function webp(): Buffer {
  const bytes = Buffer.alloc(26);
  bytes.write("RIFF", 0, "latin1");
  bytes.writeUInt32LE(18, 4);
  bytes.write("WEBP", 8, "latin1");
  bytes.write("VP8L", 12, "latin1");
  bytes.writeUInt32LE(5, 16);
  bytes[20] = 0x2f;
  return bytes;
}
function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const roots: string[] = [];
async function makeProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "bg-moodboard-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function settled<T>(run: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await run };
  } catch (error) {
    return { ok: false, error };
  }
}

describe("logo moodboard storage", () => {
  test("Given no manifest, When the board is read, Then a canonical empty revision 0 board is returned", async () => {
    const dir = await makeProject();
    expect(await readLogoMoodboard(dir)).toEqual({ schema_version: 1, revision: 0, digest: moodboardDigest(0, []), items: [] });
  });

  test("Given one PNG, When added, Then it persists under a hash name and survives a fresh call", async () => {
    const dir = await makeProject();
    const bytes = png("alpha-reference-bytes");
    const added = await addMoodboardFiles(dir, [{ name: "mark.png", mime_type: "image/png", bytes }], 0, { fingerprint });
    const id = sha256(bytes);
    expect(added.revision).toBe(1);
    expect(added.digest).toBe(moodboardDigest(1, added.items));
    expect(added.items).toEqual([
      { kind: "file", id, sha256: id, mime_type: "image/png", size_bytes: bytes.byteLength, original_name: "mark.png", fingerprint: FINGERPRINT, added_at: expect.any(Number) },
    ]);
    expect((await readFile(moodboardImagePath(dir, id))).equals(bytes)).toBe(true);
    expect(await readLogoMoodboard(dir)).toEqual(added);
    expect((await readdir(moodboardDirectoryPath(dir))).sort()).toEqual(["files", "manifest.json"]);
  });

  test("Given one WebP, When added, Then the container is accepted and stored verbatim", async () => {
    const dir = await makeProject();
    const bytes = webp();
    const added = await addMoodboardFiles(dir, [{ name: "pin.webp", mime_type: "image/webp", bytes }], 0, { fingerprint });
    expect(added.items[0]).toMatchObject({ kind: "file", mime_type: "image/webp", size_bytes: bytes.byteLength });
    const stored = await readMoodboardFile(dir, added.items[0].id);
    expect(stored.bytes.equals(bytes)).toBe(true);
  });

  test("Given an already-added file, When added again, Then the board is unchanged", async () => {
    const dir = await makeProject();
    const bytes = png("reference-bytes");
    const first = await addMoodboardFiles(dir, [{ name: "mark.png", mime_type: "image/png", bytes }], 0, { fingerprint });
    const second = await addMoodboardFiles(dir, [{ name: "copy.png", mime_type: "image/png", bytes }], 1, { fingerprint });
    expect(second).toEqual(first);
    expect(second.revision).toBe(1);
    expect(second.items).toHaveLength(1);
  });

  test("Given a stale expected revision, When adding, Then a conflict is raised", async () => {
    const dir = await makeProject();
    await addMoodboardFiles(dir, [{ name: "a.png", mime_type: "image/png", bytes: png("a") }], 0, { fingerprint });
    const result = await settled(addMoodboardFiles(dir, [{ name: "b.png", mime_type: "image/png", bytes: png("b") }], 0, { fingerprint }));
    expect(result).toMatchObject({ ok: false, error: { code: "moodboard_conflict" } });
  });

  test("Given two concurrent adds at one revision, When both commit, Then exactly one succeeds", async () => {
    const dir = await makeProject();
    const results = await Promise.all([
      settled(addMoodboardFiles(dir, [{ name: "a.png", mime_type: "image/png", bytes: png("a") }], 0, { fingerprint })),
      settled(addMoodboardFiles(dir, [{ name: "b.png", mime_type: "image/png", bytes: png("b") }], 0, { fingerprint })),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const failed = results.filter((result) => !result.ok);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ ok: false, error: { code: "moodboard_conflict" } });
    const board = await readLogoMoodboard(dir);
    expect(board.revision).toBe(1);
    expect(board.items).toHaveLength(1);
  });

  test("Given an unsafe link, When added, Then it is rejected as invalid", async () => {
    const dir = await makeProject();
    for (const url of ["http://example.com/pin/1", "https://user:pass@example.com/pin/1", "https://example.com/a b", "https://example.com/\u0001", "not a url"]) {
      expect(await settled(addMoodboardLink(dir, url, 0))).toMatchObject({ ok: false, error: { code: "moodboard_invalid" } });
    }
  });

  test("Given an HTTPS link, When added twice in canonical form, Then it is stored once", async () => {
    const dir = await makeProject();
    const first = await addMoodboardLink(dir, "https://Example.com:443/pin/1", 0);
    expect(first.revision).toBe(1);
    expect(first.items[0]).toMatchObject({ kind: "link", url: "https://example.com/pin/1" });
    const second = await addMoodboardLink(dir, "https://example.com/pin/1", 1);
    expect(second).toEqual(first);
    expect(second.items).toHaveLength(1);
  });

  test("Given a stale revision, When a link is added, Then a conflict is raised", async () => {
    const dir = await makeProject();
    await addMoodboardLink(dir, "https://example.com/pin/1", 0);
    expect(await settled(addMoodboardLink(dir, "https://example.com/pin/2", 0))).toMatchObject({ ok: false, error: { code: "moodboard_conflict" } });
  });

  test("Given bytes whose container does not match the declared MIME, When added, Then it is rejected", async () => {
    const dir = await makeProject();
    const mismatched = [
      { name: "wrong.png", mime_type: "image/png", bytes: jpeg() },
      { name: "empty.png", mime_type: "image/png", bytes: Buffer.alloc(0) },
      { name: "garbage.png", mime_type: "image/png", bytes: Buffer.from("definitely not an image") },
    ];
    for (const file of mismatched) {
      expect(await settled(addMoodboardFiles(dir, [file], 0, { fingerprint }))).toMatchObject({ ok: false, error: { code: "moodboard_image_invalid" } });
    }
    expect(await settled(addMoodboardFiles(dir, [{ name: "unsupported.gif", mime_type: "image/gif", bytes: png("gif-claimant") }], 0, { fingerprint }))).toMatchObject({ ok: false, error: { code: "moodboard_invalid" } });
  });

  test("Given a PNG header with undecodable pixels When the real decoder rejects it Then the moodboard reports an invalid image", async () => {
    const dir = await makeProject();
    await expect(addMoodboardFiles(dir, [{ name: "broken.png", mime_type: "image/png", bytes: png("invalid-pixels") }], 0))
      .rejects.toMatchObject({ code: "moodboard_image_invalid" });
    expect((await readLogoMoodboard(dir)).items).toEqual([]);
  });

  test("Given a file name carrying a path separator, When added, Then it is rejected as invalid", async () => {
    const dir = await makeProject();
    expect(await settled(addMoodboardFiles(dir, [{ name: "a/b.png", mime_type: "image/png", bytes: png("x") }], 0, { fingerprint }))).toMatchObject({ ok: false, error: { code: "moodboard_invalid" } });
  });

  test("Given twelve files, When a thirteenth is added, Then the file limit is enforced", async () => {
    const dir = await makeProject();
    const files = Array.from({ length: 12 }, (_, index) => ({ name: `mark-${index}.png`, mime_type: "image/png", bytes: png(`payload-${index}`) }));
    const board = await addMoodboardFiles(dir, files, 0, { fingerprint });
    expect(board.items).toHaveLength(12);
    expect(await settled(addMoodboardFiles(dir, [{ name: "extra.png", mime_type: "image/png", bytes: png("extra") }], 1, { fingerprint }))).toMatchObject({ ok: false, error: { code: "moodboard_limit" } });
  });

  test("Given a manifest with a forged digest, When read, Then corruption is reported", async () => {
    const dir = await makeProject();
    const manifestPath = moodboardManifestPath(dir);
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, JSON.stringify({ schema_version: 1, revision: 0, digest: "0".repeat(64), items: [] }), "utf8");
    expect(await settled(readLogoMoodboard(dir))).toMatchObject({ ok: false, error: { code: "moodboard_corrupt" } });
  });

  test("Given a tampered image file, When read, Then corruption is reported", async () => {
    const dir = await makeProject();
    const bytes = png("reference-bytes");
    const added = await addMoodboardFiles(dir, [{ name: "mark.png", mime_type: "image/png", bytes }], 0, { fingerprint });
    const id = added.items[0].id;
    await writeFile(moodboardImagePath(dir, id), png("reference-bytes!"), "utf8");
    expect(await settled(readLogoMoodboard(dir))).toMatchObject({ ok: false, error: { code: "moodboard_corrupt" } });
  });

  test("Given a manifest with a second hard link, When read, Then corruption is reported", async () => {
    const dir = await makeProject();
    const manifestPath = moodboardManifestPath(dir);
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, JSON.stringify({ schema_version: 1, revision: 0, digest: moodboardDigest(0, []), items: [] }), "utf8");
    await link(manifestPath, path.join(path.dirname(manifestPath), "copy.json"));
    expect(await settled(readLogoMoodboard(dir))).toMatchObject({ ok: false, error: { code: "moodboard_corrupt" } });
  });

  test("Given stored images redirected outside the project by a directory link When read Then corruption is reported on every platform", async () => {
    const dir = await makeProject();
    const bytes = png("reference-bytes");
    const added = await addMoodboardFiles(dir, [{ name: "mark.png", mime_type: "image/png", bytes }], 0, { fingerprint });
    const target = path.dirname(moodboardImagePath(dir, added.items[0].id));
    const outside = await makeProject();
    const redirected = path.join(outside, "files");
    await rename(target, redirected);
    await symlink(redirected, target, process.platform === "win32" ? "junction" : "dir");
    expect(await settled(readLogoMoodboard(dir))).toMatchObject({ ok: false, error: { code: "moodboard_corrupt" } });
  });

  test("Given a stored file, When removed at its revision, Then the item and its bytes are gone", async () => {
    const dir = await makeProject();
    const added = await addMoodboardFiles(dir, [{ name: "mark.png", mime_type: "image/png", bytes: png("reference-bytes") }], 0, { fingerprint });
    const id = added.items[0].id;
    const removed = await removeMoodboardItem(dir, id, 1);
    expect(removed.revision).toBe(2);
    expect(removed.items).toEqual([]);
    expect(removed.digest).toBe(moodboardDigest(2, []));
    expect(await settled(lstat(moodboardImagePath(dir, id)))).toMatchObject({ ok: false, error: { code: "ENOENT" } });
    expect(await readLogoMoodboard(dir)).toEqual(removed);
  });

  test("Given an unknown id, When removed, Then it is reported missing", async () => {
    const dir = await makeProject();
    expect(await settled(removeMoodboardItem(dir, "0".repeat(64), 0))).toMatchObject({ ok: false, error: { code: "moodboard_not_found" } });
  });

  test("Given a link item, When read as a file, Then it is reported missing", async () => {
    const dir = await makeProject();
    const added = await addMoodboardLink(dir, "https://example.com/pin/1", 0);
    expect(await settled(readMoodboardFile(dir, added.items[0].id))).toMatchObject({ ok: false, error: { code: "moodboard_not_found" } });
  });
});
