import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { zipDirectory } from "../src/services/zip";

async function tempRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

describe("zipDirectory", () => {
  test("packs every file into a real, JSZip-readable .zip", async () => {
    const root = await tempRoot("bg-zip-root-");
    try {
      await writeFile(path.join(root, "index.html"), "<html>hi</html>", "utf8");
      await writeFile(path.join(root, "colors.css"), ":root{}", "utf8");
      await mkdir(path.join(root, "preview"), { recursive: true });
      await writeFile(
        path.join(root, "preview", "card.html"),
        "<p>preview</p>",
        "utf8",
      );

      const out = path.join(root, "out.zip");
      await zipDirectory(root, out);

      const buf = await readFile(out);
      // 0x50 0x4B 0x03 0x04 = local file header for any non-empty zip.
      expect(buf[0]).toBe(0x50);
      expect(buf[1]).toBe(0x4b);

      const reopened = await JSZip.loadAsync(buf);
      const names = Object.keys(reopened.files).sort();
      expect(names).toContain("index.html");
      expect(names).toContain("colors.css");
      expect(names).toContain("preview/card.html");

      const html = await reopened
        .file("index.html")
        ?.async("string");
      expect(html).toBe("<html>hi</html>");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("uses forward-slash separators in zip entry paths on every platform", async () => {
    const root = await tempRoot("bg-zip-sep-");
    try {
      await mkdir(path.join(root, "nested", "deep"), { recursive: true });
      await writeFile(
        path.join(root, "nested", "deep", "file.txt"),
        "x",
        "utf8",
      );
      const out = path.join(root, "out.zip");
      await zipDirectory(root, out);
      const reopened = await JSZip.loadAsync(await readFile(out));
      // Every entry name must use forward slashes — not backslashes —
      // even when zipDirectory ran on Windows.
      for (const name of Object.keys(reopened.files)) {
        expect(name.includes("\\")).toBe(false);
      }
      expect(reopened.files["nested/deep/file.txt"]).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("an empty source directory still yields a valid empty .zip", async () => {
    const root = await tempRoot("bg-zip-empty-");
    try {
      const out = path.join(root, "out.zip");
      await zipDirectory(root, out);
      const buf = await readFile(out);
      expect(buf.length).toBeGreaterThan(0);
      const reopened = await JSZip.loadAsync(buf);
      expect(Object.keys(reopened.files).length).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not include the source directory itself as a path prefix", async () => {
    const root = await tempRoot("bg-zip-prefix-");
    try {
      const stagedName = path.basename(root);
      await writeFile(path.join(root, "a.txt"), "a", "utf8");
      const out = path.join(root, "out.zip");
      await zipDirectory(root, out);
      const reopened = await JSZip.loadAsync(await readFile(out));
      // Entries are relative to root, not "/<staged-tmp-dir>/a.txt".
      for (const name of Object.keys(reopened.files)) {
        expect(name.startsWith(stagedName)).toBe(false);
      }
      expect(reopened.files["a.txt"]).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("Given a fixed local time outside UTC When a directory is zipped Then every entry's DOS time is the local wall-clock time", async () => {
    const previousTz = process.env.TZ;
    const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    process.env.TZ = "Asia/Seoul";
    const root = await tempRoot("bg-zip-time-");
    try {
      await mkdir(path.join(root, "nested"), { recursive: true });
      await writeFile(path.join(root, "a.txt"), "a", "utf8");
      await writeFile(path.join(root, "nested", "b.txt"), "b", "utf8");
      const out = path.join(root, "out.zip");

      await zipDirectory(root, out, new Date(2026, 8, 25, 12, 33, 20));

      const reopened = await JSZip.loadAsync(await readFile(out));
      // JSZip reads the DOS date and time fields back as UTC components.
      const stamps = Object.fromEntries(Object.values(reopened.files).map(({ name, date }) => [name, [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]]));
      const local = [2026, 8, 25, 12, 33, 20];
      expect(stamps).toEqual({ "a.txt": local, "nested/": local, "nested/b.txt": local });
    } finally {
      process.env.TZ = previousTz ?? systemTz;
      await rm(root, { recursive: true, force: true });
    }
  });
});
