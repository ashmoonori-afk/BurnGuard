import { describe, expect, test } from "bun:test";
import {
  CONTENT_SOURCE_CHOICES,
  OUTPUT_SIZE_CHOICES,
  coerceBriefChoice,
  contentSourceChoicesFor,
  outputSizeChoicesFor,
} from "../src/lib/project-creation";

const values = <T,>(choices: readonly { readonly value: T }[]) => choices.map((choice) => choice.value);

describe("brief choices by project type (UX-18)", () => {
  test("Given a new slide deck without a template When the content sources are listed Then template and existing files are absent", () => {
    expect(values(contentSourceChoicesFor("slide_deck", false))).toEqual(["none", "attached"]);
  });

  test("Given a template project When the content sources are listed Then the template source is offered", () => {
    expect(values(contentSourceChoicesFor("from_template", true))).toContain("template");
    expect(values(contentSourceChoicesFor("prototype", true))).toContain("template");
    expect(values(contentSourceChoicesFor("from_template", true))).not.toContain("existing_files");
  });

  test("Given a slide deck When the output sizes are listed Then responsive is not among them", () => {
    expect(values(outputSizeChoicesFor("slide_deck"))).toEqual(["widescreen-16x9", "standard-4x3", "a4", "letter"]);
  });

  test("Given a web prototype When the output sizes are listed Then only responsive remains", () => {
    expect(values(outputSizeChoicesFor("prototype"))).toEqual(["responsive"]);
  });

  test("Given a template or other project When the output sizes are listed Then the full list stays available", () => {
    expect(outputSizeChoicesFor("from_template")).toEqual(OUTPUT_SIZE_CHOICES);
    expect(outputSizeChoicesFor("other")).toEqual(OUTPUT_SIZE_CHOICES);
    expect(contentSourceChoicesFor("other", false).every((choice) => CONTENT_SOURCE_CHOICES.includes(choice))).toBe(true);
  });

  test("Given a draft value the type no longer offers When coerced Then the first offered choice is used, and an offered value is kept", () => {
    expect(coerceBriefChoice(outputSizeChoicesFor("slide_deck"), "responsive")).toBe("widescreen-16x9");
    expect(coerceBriefChoice(outputSizeChoicesFor("slide_deck"), "a4")).toBe("a4");
    expect(coerceBriefChoice(contentSourceChoicesFor("slide_deck", false), "template")).toBe("none");
  });
});
