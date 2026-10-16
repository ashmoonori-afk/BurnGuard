import { MAX_PROJECT_INSTRUCTIONS_CHARS, type ProjectInstructions } from "@bg/shared";
import { isRecord } from "@bg/shared/contract-parser";
import { getSqlite } from "../db/sqlite-client";
import { parseStandingInstructionsOption } from "./project-options";

export class ProjectInstructionsError extends Error {
  constructor(readonly code: "project_not_found" | "invalid_instructions" | "instructions_too_long" | "instructions_conflict") {
    super(code);
    this.name = "ProjectInstructionsError";
  }
}

type Row = { readonly options_json: string | null };

function readRow(projectId: string): Row {
  const row = getSqlite().query<Row, [string]>("SELECT options_json FROM projects WHERE id=?").get(projectId);
  if (!row) throw new ProjectInstructionsError("project_not_found");
  return row;
}

/** The stored record as written, so a note survives even when another option in the same record fails to parse. */
function storedOptions(optionsJson: string | null): Readonly<Record<string, unknown>> {
  if (optionsJson === null) return {};
  try {
    const stored: unknown = JSON.parse(optionsJson);
    return isRecord(stored) ? stored : {};
  } catch (error) {
    if (error instanceof SyntaxError) return {};
    throw error;
  }
}

export function readProjectInstructions(projectId: string): ProjectInstructions {
  return { text: parseStandingInstructionsOption(storedOptions(readRow(projectId).options_json)["standing_instructions"]) };
}

function normalize(input: unknown): string {
  if (typeof input !== "string") throw new ProjectInstructionsError("invalid_instructions");
  const text = input.replace(/\r\n?/g, "\n").trim();
  if (text.length > MAX_PROJECT_INSTRUCTIONS_CHARS) throw new ProjectInstructionsError("instructions_too_long");
  return text;
}

/** Compare-and-set on options_json so a concurrent research-purpose write or a second save is never lost. */
function update(projectId: string, next: (current: string | null) => string): ProjectInstructions {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = readRow(projectId);
    const stored = storedOptions(row.options_json);
    const text = next(parseStandingInstructionsOption(stored["standing_instructions"]));
    if (text.length > MAX_PROJECT_INSTRUCTIONS_CHARS) throw new ProjectInstructionsError("instructions_too_long");
    const options = { ...stored, standing_instructions: text === "" ? null : text };
    const changes = getSqlite().prepare("UPDATE projects SET options_json=? WHERE id=? AND options_json IS ?").run(JSON.stringify(options), projectId, row.options_json).changes;
    if (changes === 1) return { text: text === "" ? null : text };
  }
  throw new ProjectInstructionsError("instructions_conflict");
}

export function replaceProjectInstructions(projectId: string, input: unknown): ProjectInstructions {
  const text = normalize(input);
  return update(projectId, () => text);
}

/** Appends one line as a list item; a line already present (ignoring case) is not added twice. */
export function appendProjectInstruction(projectId: string, input: unknown): ProjectInstructions {
  const line = normalize(input).replace(/\s+/g, " ");
  if (line === "") throw new ProjectInstructionsError("invalid_instructions");
  return update(projectId, (current) => {
    const existing = current ?? "";
    const present = existing.split("\n").some(entry => entry.replace(/^[-*]\s*/, "").trim().toLowerCase() === line.toLowerCase());
    if (present) return existing;
    return existing === "" ? `- ${line}` : `${existing}\n- ${line}`;
  });
}
