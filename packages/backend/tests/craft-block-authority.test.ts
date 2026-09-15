import { describe, expect, test } from "bun:test";
import {
  DECK_VISUAL_CRAFT,
  DEFAULT_VISUAL_IDENTITY,
  GRAPHIC_VISUAL_CRAFT,
  MAX_VISUAL_CRAFT_CHARS,
  PROTOTYPE_VISUAL_CRAFT,
  VISUAL_CRAFT_CORE,
} from "../src/harness/skills/visual-craft-skill";

const flat = (text: string): string => text.replace(/\s+/g, " ");

/**
 * The craft blocks are the last thing the model reads before the request, so a number in them outranks
 * anything stated earlier by sheer recency. Two shipped defects come from that: the core self-check
 * licensed 12px text on a surface whose own floor is 24px, and both per-type blocks named the generic
 * fallback before the surface token they are supposed to defer to.
 */
describe("Craft block authority", () => {
  test("Given the final self-check, then it does not license type below the surface's own floor", () => {
    // The self-check is the only place a number is attached to the word readable, and it is the last
    // ritual the model runs. A flat 12px there validates a 16px deck caption as passing.
    expect(flat(VISUAL_CRAFT_CORE)).not.toContain("none under 12px");
    expect(flat(VISUAL_CRAFT_CORE)).toContain("the smallest step this surface");
    // The deck contract's own floor must still be stated where a deck author reads it.
    expect(flat(DECK_VISUAL_CRAFT)).toContain("24px");
  });

  test("Given a supplied surface, then each craft block names it before its fallback", () => {
    const deck = flat(DECK_VISUAL_CRAFT);
    const deckToken = deck.indexOf("--slide-type-");
    const deckFallback = deck.indexOf("deck skill");
    expect(deckToken, "deck block names --slide-type-*").toBeGreaterThanOrEqual(0);
    expect(deckFallback, "deck block still states its fallback").toBeGreaterThanOrEqual(0);
    expect(deckToken, "the surface token must be read before the fallback").toBeLessThan(deckFallback);

    const graphic = flat(GRAPHIC_VISUAL_CRAFT);
    const graphicToken = graphic.indexOf("--content-safe");
    const graphicFallback = graphic.indexOf("6-8%");
    expect(graphicToken, "graphic block names --content-safe").toBeGreaterThanOrEqual(0);
    expect(graphicFallback, "graphic block still states its fallback").toBeGreaterThanOrEqual(0);
    expect(graphicToken, "the surface token must be read before the fallback").toBeLessThan(graphicFallback);
  });

  test("Given motion guidance, then it ships only on the surface that can animate", () => {
    // A graphic artboard exports one static frame and a deck exports static slides, so motion rules on
    // those paths are instructions for something that cannot happen - and they cost the binding budget.
    expect(flat(PROTOTYPE_VISUAL_CRAFT)).toContain("cubic-bezier");
    expect(flat(VISUAL_CRAFT_CORE), "motion belongs to the interactive surface").not.toContain("cubic-bezier");
    expect(flat(GRAPHIC_VISUAL_CRAFT)).not.toContain("cubic-bezier");
  });

  test("Given every path, then the per-turn budget still holds", () => {
    const paths = {
      prototype: VISUAL_CRAFT_CORE.length + PROTOTYPE_VISUAL_CRAFT.length + DEFAULT_VISUAL_IDENTITY.length,
      slide_deck: VISUAL_CRAFT_CORE.length + DECK_VISUAL_CRAFT.length + DEFAULT_VISUAL_IDENTITY.length,
      graphic: VISUAL_CRAFT_CORE.length + GRAPHIC_VISUAL_CRAFT.length + DEFAULT_VISUAL_IDENTITY.length,
    };
    for (const [path, total] of Object.entries(paths)) {
      expect(total, `${path} path within MAX_VISUAL_CRAFT_CHARS`).toBeLessThanOrEqual(MAX_VISUAL_CRAFT_CHARS);
    }
    // The binding path must not get tighter than it was before this change.
    expect(MAX_VISUAL_CRAFT_CHARS - Math.max(...Object.values(paths))).toBeGreaterThanOrEqual(118);
  });
});
