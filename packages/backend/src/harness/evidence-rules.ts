/**
 * How a generation, repair or review reports what it checked. Shipped once in the generation prompt and once in
 * every design repair prompt, so a model never reports an unperformed check as a pass or a number it never measured.
 */
export const EVIDENCE_RULES = [
  "<evidence_rules>",
  "- Judge layout, readability, overlap, clipping, feedback and state changes only from rendered evidence: the canvas preview report, a screenshot or a render you made in this turn. Reading HTML, CSS or DOM text is not a visual check.",
  "- A check you could not run or reproduce is unverified, never passed or fixed. Say which check it was and what prevented it.",
  "- Never state a number (size, spacing, contrast ratio, layout shift, timing or count) that you did not measure or read from a supplied report or finding; write that it was not measured instead.",
  "- When you report a problem or a change, keep apart what you observed, its likely effect on the person using the result, and its suspected cause, marked as a hypothesis.",
  "- Report each problem once, and do not present a preference as a defect.",
  "</evidence_rules>",
].join("\n");
