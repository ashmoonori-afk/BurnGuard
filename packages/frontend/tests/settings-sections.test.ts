import { describe, expect, test } from "bun:test";
import { SETTINGS_SECTION_IDS, activeSettingsSection, type SectionOffset } from "../src/lib/settings-sections";

function offsets(tops: readonly number[]): SectionOffset[] {
  return SETTINGS_SECTION_IDS.map((id, index) => ({ id, top: tops[index] ?? 9999 }));
}

describe("settings section tracking", () => {
  test("Given the pane at its top When the active section is derived Then the first section is active", () => {
    expect(activeSettingsSection(offsets([0, 400, 800, 1200, 1600, 2000]), false)).toBe("user");
  });

  test("Given the runtime section scrolled to the top of the pane When the active section is derived Then runtime is active", () => {
    expect(activeSettingsSection(offsets([-800, -400, 0, 500, 900, 1300]), false)).toBe("runtime");
  });

  test("Given the next section is about to reach the top When the active section is derived Then the previous one stays active until it crosses the line", () => {
    expect(activeSettingsSection(offsets([-300, 120, 520, 900, 1300, 1700]), false)).toBe("user");
    expect(activeSettingsSection(offsets([-300, 40, 520, 900, 1300, 1700]), false)).toBe("generation");
  });

  test("Given a short last section that never reaches the top When the pane is at its end Then the last section is active", () => {
    expect(activeSettingsSection(offsets([-2000, -1500, -1000, -600, -200, 260]), true)).toBe("connections");
  });

  test("Given no sections When the active section is derived Then nothing is active", () => {
    expect(activeSettingsSection([], false)).toBeNull();
  });
});
