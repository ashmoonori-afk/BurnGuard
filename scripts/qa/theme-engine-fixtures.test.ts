import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MANIFEST, runCorpus } from "./theme-engine-fixtures";

const owned: string[] = [];
afterEach(async () => {
  for (const root of owned.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "theme-freeze-test-"));
  owned.push(root);
  await mkdir(path.join(root, "nested"));
  await writeFile(path.join(root, "nested", "input.bin"), Buffer.from([0, 13, 10, 255]));
  await writeFile(path.join(root, "anchor.json"), "1234");
  return root;
}

test("Given binary inputs When frozen Then exact sorted byte commitments verify", async () => {
  const root = await fixture();
  expect(await runCorpus("freeze", root)).toBe(2);
  expect(JSON.parse(await readFile(path.join(root, MANIFEST), "utf8"))).toEqual({
    schema_version: 1,
    algorithm: "sha256",
    files: [
      { path: "anchor.json", bytes: 4, sha256: createHash("sha256").update("1234").digest("hex") },
      { path: "nested/input.bin", bytes: 4, sha256: createHash("sha256").update(Buffer.from([0, 13, 10, 255])).digest("hex") },
    ],
  });
  expect(await runCorpus("verify", root)).toBe(2);
});

test("Given an existing freeze When frozen again Then it refuses without rewriting", async () => {
  const root = await fixture();
  await runCorpus("freeze", root);
  const before = await readFile(path.join(root, MANIFEST));
  await expect(runCorpus("freeze", root)).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readFile(path.join(root, MANIFEST))).toEqual(before);
});

test.each(["same-size", "resized", "extra", "missing"] as const)(
  "Given a frozen corpus with %s drift When verified Then it fails without repair", async (drift) => {
    const root = await fixture();
    await runCorpus("freeze", root);
    const before = await readFile(path.join(root, MANIFEST));
    switch (drift) {
      case "same-size": await writeFile(path.join(root, "anchor.json"), "1235"); break;
      case "resized": await writeFile(path.join(root, "anchor.json"), "12345"); break;
      case "extra": await writeFile(path.join(root, "nested", "extra"), "x"); break;
      case "missing": await unlink(path.join(root, "anchor.json")); break;
    }
    await expect(runCorpus("verify", root)).rejects.toMatchObject({ code: "CORPUS_MISMATCH" });
    expect(await readFile(path.join(root, MANIFEST))).toEqual(before);
  },
);

test.each(["../outside", "C:\\outside\\input", "/outside/input"] as const)(
  "Given an untrusted manifest path %s When verified Then no supplied path is followed", async (untrusted) => {
    const root = await fixture();
    await writeFile(path.join(root, MANIFEST), JSON.stringify({
      schema_version: 1, algorithm: "sha256", files: [{ path: untrusted, bytes: 4, sha256: "0".repeat(64) }],
    }));
    await expect(runCorpus("verify", root)).rejects.toMatchObject({ code: "CORPUS_MISMATCH" });
  },
);

test("Given private execution evidence When frozen Then no manifest is published", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "nested", "validation.json"), "{}");
  await expect(runCorpus("freeze", root)).rejects.toMatchObject({ code: "PRIVATE_EVIDENCE" });
  await expect(readFile(path.join(root, MANIFEST))).rejects.toMatchObject({ code: "ENOENT" });
});

test.each(["root", "nested"] as const)(
  "Given a %s directory link When frozen Then traversal is refused on every OS", async (position) => {
    const root = await fixture();
    const target = await fixture();
    // Directory junctions need no Windows symlink privilege.
    const link = path.join(root, "linked");
    await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
    await expect(runCorpus("freeze", position === "root" ? link : root)).rejects.toMatchObject({
      code: position === "root" ? "INVALID_ROOT" : "SYMLINK",
    });
  },
);

test("Given no manifest When verified Then it fails instead of creating one", async () => {
  const root = await fixture();
  await expect(runCorpus("verify", root)).rejects.toMatchObject({ code: "ENOENT" });
});

test("Given malformed manifest JSON When invoked through the CLI Then failure is sanitized", async () => {
  const root = await fixture();
  await writeFile(path.join(root, MANIFEST), "{");
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "theme-engine-fixtures.ts"), "verify", "--root", root], {
    stdout: "pipe", stderr: "pipe", timeout: 10_000,
  });
  const [exit, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  expect(exit).toBe(1);
  expect(stdout).toBe("");
  expect(JSON.parse(stderr)).toEqual({ status: "FAIL", code: "INVALID_MANIFEST" });
});
