import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { appRootDir } from "../src/lib/app-paths";
import { getSqlite } from "../src/db/sqlite-client";

if (process.env.BG_TEST_ISOLATION_CHILD === "1") {
  test("Given an inherited application root When test preload runs Then the database uses a different owned root", () => {
    expect(appRootDir).not.toBe(process.env.BG_TEST_PARENT_ROOT);
    expect(path.basename(appRootDir)).toStartWith("burnguard-tests-");
    getSqlite().exec("CREATE TABLE isolation_fixture (id INTEGER)");
    expect(existsSync(path.join(appRootDir, "burnguard.db"))).toBe(true);
  });
} else {
  test("Given an existing application profile When a child runs tests Then its files remain untouched", async () => {
    const marker = path.join(appRootDir, "isolation-marker");
    writeFileSync(marker, "keep");
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      cwd: path.resolve(import.meta.dir, "../../.."),
      env: { ...process.env, BG_APP_ROOT: appRootDir, BG_TEST_PARENT_ROOT: appRootDir, BG_TEST_ISOLATION_CHILD: "1" },
      stdout: "pipe", stderr: "pipe",
    });
    const [code, output, errors] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, diagnostics: code === 0 ? "" : output + errors }).toEqual({ code: 0, diagnostics: "" });
    expect(readFileSync(marker, "utf8")).toBe("keep");
    expect(getSqlite().query("SELECT name FROM sqlite_master WHERE name='isolation_fixture'").get()).toBeNull();
  });
}
