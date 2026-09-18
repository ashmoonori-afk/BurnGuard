import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMigrationsFrom } from "../src/db/migrate";

const sourceDir = path.join(import.meta.dir, "../src/db/migrations");

describe("0017 logo project migration", () => {
  test("Given persisted 0016 project state and a child row When 0017 applies Then data FKs indexes and type checks survive", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "burnguard-logo-migration-"));
    const db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    try {
      for (const file of (await readdir(sourceDir)).filter((name) => name <= "0016_project_design_system_pins.sql")) {
        await cp(path.join(sourceDir, file), path.join(directory, file));
      }
      await runMigrationsFrom(db, directory);
      const options = JSON.stringify({
        use_speaker_notes: false,
        copy_as_is: false,
        design_brief: null,
      });
      db.prepare(`INSERT INTO projects(
        id,name,type,design_system_id,dir_path,entrypoint,thumbnail_path,
        backend_id,options_json,archived_at,created_at,updated_at,current_revision,current_digest
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        "existing-project",
        "Existing",
        "graphic",
        null,
        "/tmp/existing-project",
        "index.html",
        "/tmp/existing-thumbnail.png",
        "codex",
        options,
        null,
        10,
        20,
        7,
        "existing-digest",
      );
      db.prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,?,?,?,?,?)").run(
        "existing-session",
        "existing-project",
        "codex",
        "idle",
        10,
        20,
        20,
      );
      db.prepare("INSERT INTO project_design_system_pins(project_id,system_id,revision,digest,context,tokens) VALUES (?,?,?,?,?,?)").run(
        "existing-project",
        "existing-system",
        3,
        "pin-digest",
        "{}",
        "{}",
      );
      await cp(
        path.join(sourceDir, "0017_logo_project_type.sql"),
        path.join(directory, "0017_logo_project_type.sql"),
      );

      await runMigrationsFrom(db, directory);

      expect(db.query("SELECT id,name,type,design_system_id,dir_path,entrypoint,thumbnail_path,backend_id,options_json,archived_at,created_at,updated_at,current_revision,current_digest FROM projects WHERE id='existing-project'").get()).toEqual({
        id: "existing-project",
        name: "Existing",
        type: "graphic",
        design_system_id: null,
        dir_path: "/tmp/existing-project",
        entrypoint: "index.html",
        thumbnail_path: "/tmp/existing-thumbnail.png",
        backend_id: "codex",
        options_json: options,
        archived_at: null,
        created_at: 10,
        updated_at: 20,
        current_revision: 7,
        current_digest: "existing-digest",
      });
      expect(db.query("SELECT id,project_id FROM sessions WHERE id='existing-session'").get()).toEqual({
        id: "existing-session",
        project_id: "existing-project",
      });
      expect(db.query("SELECT project_id,system_id FROM project_design_system_pins WHERE project_id='existing-project'").get()).toEqual({
        project_id: "existing-project",
        system_id: "existing-system",
      });
      expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='projects' ORDER BY name").all()).toEqual([
        { name: "idx_projects_ds" },
        { name: "idx_projects_updated" },
        { name: "sqlite_autoindex_projects_1" },
      ]);
      expect(() => db.exec("INSERT INTO projects(id,name,type,dir_path,backend_id,created_at,updated_at) VALUES ('logo-project','Logo','logo','/tmp/logo','codex',1,1)")).not.toThrow();
      expect(() => db.exec("INSERT INTO projects(id,name,type,dir_path,backend_id,created_at,updated_at) VALUES ('graphic-project','Graphic','graphic','/tmp/graphic','codex',1,1)")).not.toThrow();
      expect(() => db.exec("INSERT INTO projects(id,name,type,dir_path,backend_id,created_at,updated_at) VALUES ('invalid-project','Invalid','bogus','/tmp/invalid','codex',1,1)")).toThrow();
    } finally {
      db.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
