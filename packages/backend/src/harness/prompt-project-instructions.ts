const INSTRUCTIONS_REQUIREMENT = "- REQUIRED (PROJECT STANDING INSTRUCTIONS): the user wrote the note above for this project to apply to every turn: audience facts, tone, locked numbers and wording, forbidden words. Apply it to everything this turn creates or edits. It outranks the design system and the defaults; only the user's explicit request in this turn overrides an item.";

/** The project's "always apply" note as one tagged block; nothing when the project has none. */
export function appendProjectInstructions(lines: string[], text: string | null): void {
  if (text === null) return;
  lines.push("<project_standing_instructions>", JSON.stringify(text).replace(/</g, "\\u003c"), "</project_standing_instructions>", INSTRUCTIONS_REQUIREMENT, "");
}
