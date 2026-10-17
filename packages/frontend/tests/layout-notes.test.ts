import { describe, expect, test } from "bun:test";
import { plainLayoutNote } from "../src/lib/layout-notes";

const labels: Record<string, string> = { "--layout-bp-md": "BREAKPOINT", "--layout-max": "MAX" };
const labelFor = (token: string) => labels[token] ?? null;

describe("plain layout notes", () => {
  test("Given a note with known CSS variables When made plain Then every variable is replaced by its label and the note is marked as changed", () => {
    const note = plainLayoutNote("Below --layout-bp-md, collapse. Above --layout-max, keep the grid.", labelFor, "SETTING", "FILE");
    expect(note.plain).toBe("Below BREAKPOINT, collapse. Above MAX, keep the grid.");
    expect(note.differs).toBe(true);
  });

  test("Given unknown variables and a source file name When made plain Then fallbacks replace them", () => {
    const note = plainLayoutNote("Use --layout-unknown from colors_and_type.css.", labelFor, "SETTING", "FILE");
    expect(note.plain).toBe("Use SETTING from FILE.");
    expect(note.differs).toBe(true);
  });

  test("Given a note without technical names When made plain Then it is returned unchanged", () => {
    const note = plainLayoutNote("Keep generous whitespace.", labelFor, "SETTING", "FILE");
    expect(note.plain).toBe("Keep generous whitespace.");
    expect(note.differs).toBe(false);
  });
});
