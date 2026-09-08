import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { appRootDir } from "../src/lib/app-paths";
import { resolveRepoRoot } from "../src/lib/paths";
import { isRuntimeSource } from "../../../scripts/package-runtime";

describe("portable package resources", () => {
  test("Given a relocated executable When its resource marker exists Then cwd and source checkout are unnecessary", async () => {
    const executable = path.join(appRootDir, "한글 portable app", "burnguard-design.exe");
    const resources = path.join(path.dirname(executable), "resources");
    await mkdir(resources, { recursive: true });
    await writeFile(path.join(resources, "burnguard-runtime.json"), "{}");
    expect(resolveRepoRoot("unrelated/source/path", executable)).toBe(resources);
  });

  test("Given repository resources and a private upload When selecting package files Then only shipped resources are selected", () => {
    const paths = ["design system sample/tokens.json", "design system sample/uploads/private.pptx", "design system themes/light/tokens.json", "packages/backend/src/db/migrations/0001_initial.sql", "LICENSE", "../private.json", ".env", "packages/backend/src/config.ts"];
    expect(paths.filter(isRuntimeSource)).toEqual([paths[0], paths[2], paths[3], paths[4]]);
    expect(isRuntimeSource("design system sample\\uploads\\private.pptx")).toBe(false);
  });
});
