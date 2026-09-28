import { beforeAll, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSqlite } from "../src/db/sqlite-client";
import { runMigrations } from "../src/db/migrate-local";
import { projectsDir } from "../src/lib/paths";
import { startVisualAlternativeTurn } from "../src/services/turns";

beforeAll(async () => {
  await runMigrations();
});

test("Given an alternative item turn When it runs Then only the model sees the control tag and the stored message is the user prompt", async () => {
  // Given
  const projectId = `alternative-payload-${crypto.randomUUID()}`;
  const sessionId = `${projectId}-session`;
  const projectDir = path.join(projectsDir, projectId);
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, "index.html"), "<main>Base</main>");
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, projectId, projectDir);
  getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
  const modelText = "<burnguard_visual_alternative>{\"schema_version\":1}</burnguard_visual_alternative>\nMake it calmer.";
  let modelEventText: string | undefined;
  let modelPrompt = "";

  try {
    // When
    const turn = startVisualAlternativeTurn(sessionId, { type: "user.message", text: "Make it calmer." }, `${projectId}-operation`, {
      modelText,
      reviewDesign: async () => ({ status: "unavailable", repairs: 0, result: null }),
      detectBackends: async () => ({ backends: [{ id: "codex", found: true, binary_path: "unused", version: "fixture", authenticated: true, image_generation: true }] }),
      runAdapter: async (_backend, input) => {
        modelEventText = input.userEvent.type === "user.message" ? input.userEvent.text : undefined;
        modelPrompt = input.prompt;
        await input.onEvent({ id: crypto.randomUUID(), ts: 5, type: "chat.message_end", turnId: input.turnId });
        await input.onEvent({ id: crypto.randomUUID(), ts: 6, type: "status.idle", stopReason: "end_turn" });
        return { exitCode: 0 };
      },
    });
    if (turn === null) throw new Error("turn_reservation_missing");
    await turn.promise.catch(() => undefined);
    const stored = getSqlite().query<Record<string, unknown>, [string]>(
      "SELECT * FROM events WHERE session_id=? AND type='user.message'",
    ).all(sessionId);

    // Then
    expect(modelEventText).toBe(modelText);
    expect(modelPrompt).toContain("<burnguard_visual_alternative>");
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).toContain("Make it calmer.");
    expect(JSON.stringify(stored)).not.toContain("burnguard_visual_alternative");
  } finally {
    getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId);
    await rm(projectDir, { recursive: true, force: true });
  }
});
