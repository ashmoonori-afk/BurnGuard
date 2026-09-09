import { expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const contents = path.join(
  root,
  "dist",
  "mac",
  "BurnGuard Design.app",
  "Contents",
);

test("Given a macOS build When the bundle is inspected Then every runtime resource is staged", async () => {
  const child = Bun.spawn(["bun", "run", "build:mac"], {
    cwd: root,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(exitCode, `${stdout}\n${stderr}`).toBe(0);

  const required = [
    "Info.plist",
    "MacOS/burnguard-design",
    "Resources/packages/frontend/dist/index.html",
    "Resources/packages/backend/src/db/migrations/0001_initial.sql",
    "Resources/design system themes/light/README.md",
    "Resources/design system sample/README.md",
  ];
  for (const relative of required) {
    expect(
      (await stat(path.join(contents, relative))).isFile(),
      relative,
    ).toBe(true);
  }
}, 30_000);
