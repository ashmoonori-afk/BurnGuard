import { describe, expect, test } from "bun:test";
import { exampleBrief, exampleBriefForm } from "../src/lib/example-briefs";
import { INITIAL_BRIEF_FORM } from "../src/lib/project-creation";

const SAMPLES = ["sonnel", "foliover", "oddward", "velune"] as const;
const TYPES = ["prototype", "slide_deck", "graphic"] as const;

describe("example briefs", () => {
  test("Given every bundled sample in every format When its brief is read Then type, system and all brief fields are present", () => {
    for (const slug of SAMPLES) for (const kind of TYPES) {
      const brief = exampleBrief({ kind, designSystemId: `sample-system-original-${slug}` });
      expect(brief?.type).toBe(kind);
      expect(brief?.designSystemId).toBe(`sample-system-original-${slug}`);
      for (const field of [brief?.name, brief?.audience, brief?.objective]) expect((field ?? "").length).toBeGreaterThan(0);
    }
  });

  test("Given a user project, an unknown sample or an unsupported type When read Then there is no brief", () => {
    expect(exampleBrief({ kind: "prototype", designSystemId: "northvale-capital" })).toBeNull();
    expect(exampleBrief({ kind: "prototype", designSystemId: "sample-system-original-unknown" })).toBeNull();
    expect(exampleBrief({ kind: "prototype", designSystemId: "sample-system-original-halide" })).toBeNull();
    expect(exampleBrief({ kind: "logo", designSystemId: "sample-system-original-sonnel" })).toBeNull();
    expect(exampleBrief({ kind: "prototype", designSystemId: null })).toBeNull();
  });

  test("Given a brief When it pre-fills the form Then only name, audience and objective change", () => {
    const brief = exampleBrief({ kind: "slide_deck", designSystemId: "sample-system-original-sonnel" })!;
    const form = exampleBriefForm(brief);
    expect([form.name, form.audience, form.objective]).toEqual([brief.name, brief.audience, brief.objective]);
    expect({ ...form, name: "", audience: "", objective: "" }).toEqual({ ...INITIAL_BRIEF_FORM, name: "", audience: "", objective: "" });
  });

  test("Given the Korean or Chinese interface When a brief is read Then its name, audience and objective are in that language", () => {
    for (const locale of ["ko", "zh-CN"] as const) {
      const english = exampleBrief({ kind: "prototype", designSystemId: "sample-system-original-velune" }, "en")!;
      const local = exampleBrief({ kind: "prototype", designSystemId: "sample-system-original-velune" }, locale)!;
      for (const field of ["name", "audience", "objective"] as const) expect(local[field]).not.toBe(english[field]);
      expect(/[\u3131-\uD79D\u4E00-\u9FFF]/u.test(local.objective)).toBe(true);
    }
  });
});
