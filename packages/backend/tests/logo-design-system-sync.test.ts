import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LOGO_SOURCE_ATTRIBUTE } from "@bg/shared";
import { createDesignSystemRecord } from "../src/db/seed";
import { getSqlite } from "../src/db/sqlite-client";
import { systemsDir } from "../src/lib/paths";
import { applyLogoDesignSystemPatch, LogoDesignSystemPatchError } from "../src/services/logo-design-system-sync";

const systemId = `logo-sync-${process.pid}`;
const systemDir = path.join(systemsDir, systemId);
const README_TAIL = "## Typography\n\nKeep the existing ramp.\n";
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" ${LOGO_SOURCE_ATTRIBUTE}="explorations/round-1/candidate-2.png"><path d="M0 0H512V512H0Z"/></svg>`;
const patch = {
  schema_version: 1,
  colors: [
    { name: "logo-primary", value: "#112233" },
    { name: "logo-accent", value: "#FFAA00" },
  ],
  readme_section: "## Logo\n\nClear space equals the height of the mark's counterform.\n",
  logo_asset: "logo.svg",
};

const projectDirs: string[] = [];

async function projectStage(files: Readonly<Record<string, string>>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "burnguard-logo-sync-"));
  projectDirs.push(dir);
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(dir, name), content);
  return dir;
}

function systemCount(): unknown {
  return getSqlite().query("SELECT COUNT(*) AS count FROM design_systems").get();
}

beforeAll(async () => {
  await mkdir(systemDir, { recursive: true });
  await writeFile(path.join(systemDir, "colors_and_type.css"), ":root { --brand-ink: #101010; }\n");
  await writeFile(
    path.join(systemDir, "README.md"),
    `# System\n\n## Colors\n\nExisting colours.\n\n## Logo\n\nStale logo prose that must not survive.\n\n${README_TAIL}`,
  );
  await createDesignSystemRecord({
    id: systemId,
    name: "Logo sync",
    description: null,
    status: "published",
    sourceType: "manual",
    sourceUri: null,
    dirPath: systemDir,
    skillMdPath: null,
    tokensCssPath: path.join(systemDir, "colors_and_type.css"),
    readmeMdPath: path.join(systemDir, "README.md"),
    thumbnailPath: null,
  });
});

afterAll(async () => {
  getSqlite().prepare("DELETE FROM design_systems WHERE id=?").run(systemId);
  await rm(systemDir, { recursive: true, force: true });
  for (const dir of projectDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("logo design system sync", () => {
  test("Given no design system When applied Then it is a no-op", async () => {
    const dir = await projectStage({ "design-system-patch.json": JSON.stringify(patch), "logo.svg": LOGO_SVG });
    expect(await applyLogoDesignSystemPatch({ projectDir: dir, designSystemId: null, expectedSource: "explorations/round-1/candidate-2.png" })).toEqual({ applied: false, reason: "no_design_system" });
  });

  test("Given no patch file When applied Then it is a no-op", async () => {
    const dir = await projectStage({ "logo.svg": LOGO_SVG });
    expect(await applyLogoDesignSystemPatch({ projectDir: dir, designSystemId: systemId, expectedSource: "explorations/round-1/candidate-2.png" })).toEqual({ applied: false, reason: "patch_absent" });
  });

  test("Given a patch When applied twice Then colours, README and asset land idempotently and no system row is created", async () => {
    const before = systemCount();
    const dir = await projectStage({ "design-system-patch.json": JSON.stringify(patch), "logo.svg": LOGO_SVG });

    expect(await applyLogoDesignSystemPatch({ projectDir: dir, designSystemId: systemId, expectedSource: "explorations/round-1/candidate-2.png" })).toEqual({
      applied: true,
      colors: 2,
      readme: "replaced",
      asset: true,
    });

    const css = await readFile(path.join(systemDir, "colors_and_type.css"), "utf8");
    expect(css).toContain("#112233");
    expect(css).toContain("#FFAA00");
    expect(css).toContain("--brand-ink");
    const readme = await readFile(path.join(systemDir, "README.md"), "utf8");
    expect(readme).toContain("Clear space equals the height of the mark's counterform.");
    expect(readme).not.toContain("Stale logo prose that must not survive.");
    expect(readme).toContain("## Colors");
    expect(readme).toContain("## Typography");
    expect(await readFile(path.join(systemDir, "assets", "logo.svg"), "utf8")).toBe(LOGO_SVG);
    expect(systemCount()).toEqual(before);

    expect(await applyLogoDesignSystemPatch({ projectDir: dir, designSystemId: systemId, expectedSource: "explorations/round-1/candidate-2.png" })).toEqual({
      applied: true,
      colors: 2,
      readme: "replaced",
      asset: true,
    });
    expect(await readFile(path.join(systemDir, "README.md"), "utf8")).toBe(readme);
    expect(systemCount()).toEqual(before);
  });

  test("Given a patch saved with a UTF-8 BOM and CRLF When applied Then it applies like the plain patch", async () => {
    const dir = await projectStage({ "design-system-patch.json": `\uFEFF${JSON.stringify(patch)}\r\n`, "logo.svg": LOGO_SVG });
    expect([...(await readFile(path.join(dir, "design-system-patch.json"))).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(await applyLogoDesignSystemPatch({ projectDir: dir, designSystemId: systemId, expectedSource: "explorations/round-1/candidate-2.png" })).toMatchObject({ applied: true, colors: 2, asset: true });
  });

  test("Given a README without a logo section When applied Then the section is appended", async () => {
    await writeFile(path.join(systemDir, "README.md"), "# System\n\n## Colors\n\nOnly colours.\n");
    const dir = await projectStage({ "design-system-patch.json": JSON.stringify(patch), "logo.svg": LOGO_SVG });
    const result = await applyLogoDesignSystemPatch({ projectDir: dir, designSystemId: systemId, expectedSource: "explorations/round-1/candidate-2.png" });
    expect(result).toEqual({ applied: true, colors: 2, readme: "appended", asset: true });
    const readme = await readFile(path.join(systemDir, "README.md"), "utf8");
    expect(readme.indexOf("## Colors")).toBeLessThan(readme.indexOf("## Logo"));
    expect(readme.endsWith("\n")).toBe(true);
  });

  test.each([
    ["active content", LOGO_SVG.replace("</svg>", "<script>alert(1)</script></svg>"), "svg_forbidden_element:script"],
    ["external reference", LOGO_SVG.replace("</svg>", '<use href="https://example.com/logo.svg#mark"/></svg>'), "svg_external_reference"],
    ["another selected source", LOGO_SVG.replace("candidate-2.png", "candidate-3.png"), "svg_source_mismatch"],
    ["missing source", LOGO_SVG.replace(` ${LOGO_SOURCE_ATTRIBUTE}="explorations/round-1/candidate-2.png"`, ""), "svg_source_missing"],
  ])("Given an SVG with %s When promoted Then a typed failure leaves the system unchanged", async (_label, svg, detail) => {
    const files = ["colors_and_type.css", "README.md", "assets/logo.svg"];
    await mkdir(path.join(systemDir, "assets"), { recursive: true });
    await writeFile(path.join(systemDir, "assets", "logo.svg"), LOGO_SVG);
    const before = await Promise.all(files.map((file) => readFile(path.join(systemDir, file))));
    const dir = await projectStage({
      "design-system-patch.json": JSON.stringify({
        ...patch,
        colors: [{ name: "logo-rejected", value: "#ABCDEF" }],
        readme_section: "## Logo\n\nRejected replacement.\n",
      }),
      "logo.svg": svg,
    });
    const input = { projectDir: dir, designSystemId: systemId, expectedSource: "explorations/round-1/candidate-2.png" };

    const result = await applyLogoDesignSystemPatch(input).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(LogoDesignSystemPatchError);
    expect(result).toMatchObject({ code: "logo_design_system_patch_failed", detail });
    expect(await Promise.all(files.map((file) => readFile(path.join(systemDir, file))))).toEqual(before);
  });

  test("Given a malformed patch When applied Then a typed failure is thrown and nothing is written", async () => {
    const dir = await projectStage({ "design-system-patch.json": JSON.stringify({ ...patch, colors: [{ name: "Logo Primary", value: "#112233" }] }), "logo.svg": LOGO_SVG });
    await expect(applyLogoDesignSystemPatch({ projectDir: dir, designSystemId: systemId, expectedSource: "explorations/round-1/candidate-2.png" })).rejects.toMatchObject({
      code: "logo_design_system_patch_failed",
      detail: "patch_invalid:colors.0.name",
    });
  });

  test("Given a missing logo asset When applied Then a typed failure is thrown", async () => {
    const dir = await projectStage({ "design-system-patch.json": JSON.stringify(patch) });
    await expect(applyLogoDesignSystemPatch({ projectDir: dir, designSystemId: systemId, expectedSource: "explorations/round-1/candidate-2.png" })).rejects.toMatchObject({
      code: "logo_design_system_patch_failed",
      detail: "logo_asset_missing",
    });
  });

  test("Given an unknown design system When applied Then a typed failure is thrown and no row appears", async () => {
    const before = systemCount();
    const dir = await projectStage({ "design-system-patch.json": JSON.stringify(patch), "logo.svg": LOGO_SVG });
    await expect(applyLogoDesignSystemPatch({ projectDir: dir, designSystemId: `${systemId}-unknown`, expectedSource: "explorations/round-1/candidate-2.png" })).rejects.toMatchObject({
      code: "logo_design_system_patch_failed",
      detail: "design_system_missing",
    });
    expect(systemCount()).toEqual(before);
  });
});
