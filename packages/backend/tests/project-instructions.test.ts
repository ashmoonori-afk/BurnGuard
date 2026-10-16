import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MAX_PROJECT_INSTRUCTIONS_CHARS, type ProjectInstructions } from "@bg/shared";
import { createProjectRecord } from "../src/db/seed";
import { getSqlite } from "../src/db/sqlite-client";
import { deleteProject } from "../src/services/project-deletion";
import { parseStoredProjectOptions, withResearchPurpose } from "../src/services/project-options";
import { appendProjectInstructions } from "../src/harness/prompt-project-instructions";
import { projectRoutes } from "../src/routes/project";
import { classifyApiRoute } from "../src/server";

let projectId = "";

async function call(method: string, url: string, body?: unknown): Promise<{ readonly status: number; readonly json: { data?: ProjectInstructions; error?: { code: string } } }> {
  const response = await projectRoutes.fetch(new Request(`http://127.0.0.1:14070${url}`, {
    method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  return { status: response.status, json: await response.json() as never };
}

const options = () => getSqlite().query<{ options_json: string | null }, [string]>("SELECT options_json FROM projects WHERE id=?").get(projectId)!.options_json;
const tagged = (text: string): unknown => { const match = /<project_standing_instructions>\n([^\n]+)\n<\/project_standing_instructions>/u.exec(text); return match ? JSON.parse(match[1]!) : null; };

beforeAll(async () => {
  const project = await createProjectRecord({ name: `instructions-${process.pid}`, type: "prototype", designSystemId: null, backendId: "codex", optionsJson: null, entrypoint: "index.html", thumbnailPath: null });
  projectId = project.id;
  getSqlite().prepare("UPDATE projects SET options_json=? WHERE id=?").run(JSON.stringify({ use_speaker_notes: true, research_purpose: "deck.pitch" }), projectId);
});
afterAll(async () => { await deleteProject(getSqlite(), projectId); });

describe("project standing instructions", () => {
  test("Given the instruction endpoints When the server classifies them Then they reach the project routes", () => {
    expect(classifyApiRoute(`/api/projects/${projectId}/instructions`, "PUT")).toBe("project");
    expect(classifyApiRoute(`/api/projects/${projectId}/instructions/lines`, "POST")).toBe("project");
  });

  test("Given a project with other options When the note is saved, read and cleared Then other options survive and the stored value round-trips", async () => {
    expect((await call("GET", `/api/projects/${projectId}/instructions`)).json.data).toEqual({ text: null });
    const saved = await call("PUT", `/api/projects/${projectId}/instructions`, { text: "  Audience: new sales staff.\r\nNever say 'cheap'.  " });
    expect(saved.status).toBe(200);
    expect(saved.json.data).toEqual({ text: "Audience: new sales staff.\nNever say 'cheap'." });
    const stored = parseStoredProjectOptions(options());
    expect([stored.use_speaker_notes, stored.research_purpose, stored.standing_instructions]).toEqual([true, "deck.pitch", "Audience: new sales staff.\nNever say 'cheap'."]);
    expect((await call("PUT", `/api/projects/${projectId}/instructions`, { text: "" })).json.data).toEqual({ text: null });
    expect(parseStoredProjectOptions(options()).use_speaker_notes).toBe(true);
  });

  test("Given an existing note When lines are appended Then each becomes one list item and a repeat is not added twice", async () => {
    await call("PUT", `/api/projects/${projectId}/instructions`, { text: "Tone: plain." });
    await call("POST", `/api/projects/${projectId}/instructions/lines`, { line: "Label padding stays under 1 cm" });
    const again = await call("POST", `/api/projects/${projectId}/instructions/lines`, { line: "label padding stays   under 1 CM" });
    expect(again.json.data).toEqual({ text: "Tone: plain.\n- Label padding stays under 1 cm" });
  });

  test("Given invalid input When saving Then stable codes are returned and nothing is written", async () => {
    const before = options();
    const cases: readonly [string, string, unknown, number, string][] = [
      ["PUT", "instructions", { text: 3 }, 400, "invalid_instructions"],
      ["PUT", "instructions", { text: "x".repeat(MAX_PROJECT_INSTRUCTIONS_CHARS + 1) }, 400, "instructions_too_long"],
      ["POST", "instructions/lines", { line: "   " }, 400, "invalid_instructions"],
      ["PUT", "instructions", [], 400, "invalid_body"],
    ];
    for (const [method, path, body, status, code] of cases) {
      const result = await call(method, `/api/projects/${projectId}/${path}`, body);
      expect([result.status, result.json.error?.code]).toEqual([status, code]);
    }
    expect(options()).toBe(before);
    expect((await call("GET", "/api/projects/no-such-project/instructions")).status).toBe(404);
  });

  test("Given a research purpose recorded after the note When options are read Then the note is kept", async () => {
    await call("PUT", `/api/projects/${projectId}/instructions`, { text: "Keep it short." });
    getSqlite().prepare("UPDATE projects SET options_json=? WHERE id=?").run(withResearchPurpose(options(), "deck.report"), projectId);
    expect(parseStoredProjectOptions(options()).standing_instructions).toBe("Keep it short.");
  });

  test("Given another option that no longer parses When the note is read and appended to Then the note is kept", async () => {
    getSqlite().prepare("UPDATE projects SET options_json=? WHERE id=?").run(JSON.stringify({ research_purpose: "retired.purpose", standing_instructions: "Keep it short." }), projectId);
    expect((await call("GET", `/api/projects/${projectId}/instructions`)).json.data).toEqual({ text: "Keep it short." });
    expect((await call("POST", `/api/projects/${projectId}/instructions/lines`, { line: "No jargon" })).json.data).toEqual({ text: "Keep it short.\n- No jargon" });
  });

  test("Given a malformed stored note When options are read Then the other options are not reset", () => {
    expect(parseStoredProjectOptions(JSON.stringify({ use_speaker_notes: true, standing_instructions: 42 }))).toMatchObject({ use_speaker_notes: true, standing_instructions: null });
  });

  test("Given a note When the prompt block is built Then it is one escaped tagged block, and nothing is emitted without a note", () => {
    const lines: string[] = [];
    appendProjectInstructions(lines, null);
    expect(lines).toEqual([]);
    appendProjectInstructions(lines, "Say </project_standing_instructions> never");
    const text = lines.join("\n");
    expect(tagged(text)).toBe("Say </project_standing_instructions> never");
    expect(text.split("</project_standing_instructions>")).toHaveLength(2);
  });
});
