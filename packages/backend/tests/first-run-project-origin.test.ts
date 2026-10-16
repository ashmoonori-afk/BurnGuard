import { afterAll, beforeAll, expect, test } from "bun:test";
import path from "node:path";
import { homeProjectFixtures } from "../src/data/home";
import { listHomeProjects } from "../src/db/home-project-list";
import { getSqlite } from "../src/db/sqlite-client";
import { runMigrations } from "../src/db/migrate-local";

const inserted: string[] = [];
const userId = `first-run-user-${process.pid}`;
const templateId = `first-run-template-${process.pid}`;
const sampleId = `first-run-sample-${process.pid}`;

beforeAll(async () => {
  await runMigrations();
  const insert = getSqlite().prepare("INSERT OR IGNORE INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,?,?,?,'claude-code',1,?)");
  for (const project of [
    ...homeProjectFixtures,
    { id: userId, name: homeProjectFixtures[0]?.name ?? "User website", type: "prototype" },
    { id: templateId, name: "User template", type: "from_template" },
    { id: sampleId, name: "[burnguard:original-sample] SONNEL · Web", type: "prototype" },
  ]) {
    const result = insert.run(project.id, project.name, project.type, path.join(process.env["BG_APP_ROOT"] ?? "", project.id), "index.html", Number.MAX_SAFE_INTEGER - 1);
    if (result.changes > 0) inserted.push(project.id);
  }
});
afterAll(() => { for (const id of inserted) getSqlite().prepare("DELETE FROM projects WHERE id=?").run(id); });

test("Given the legacy bundled fixtures When listing projects Then their origin does not masquerade as user creation", async () => {
  const rows = [...(await listHomeProjects("mine", 1000, 0)).items, ...(await listHomeProjects("examples", 1000, 0)).items];
  for (const fixture of homeProjectFixtures) expect(rows.find((row) => row.id === fixture.id)).toMatchObject({ is_bundled: true });
});

test("Given user projects including a template or a copied example name When listing Then they remain user-owned origins", async () => {
  const mine = (await listHomeProjects("mine", 1000, 0)).items;
  const examples = (await listHomeProjects("examples", 1000, 0)).items;
  expect(mine.find((row) => row.id === userId)).toMatchObject({ is_bundled: false });
  expect(examples.find((row) => row.id === templateId)).toMatchObject({ is_bundled: false });
});

test("Given an original bundled sample When listing examples Then the home response identifies its bundled origin", async () => {
  const rows = (await listHomeProjects("examples", 1000, 0)).items;
  expect(rows.find((row) => row.id === sampleId)).toMatchObject({ is_bundled: true });
});
