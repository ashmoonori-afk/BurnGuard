import { expect, test } from "bun:test";
import { canvasDeviceWidth } from "../src/lib/canvas-device-width";

test("Given website previews When selecting devices Then CSS widths do not depend on available space", () => {
  expect((["fit", "desktop", "tablet", "phone"] as const).map((preset) =>
    canvasDeviceWidth("prototype", preset),
  )).toEqual([undefined, 1440, 768, 390]);
});

test("Given fixed artboards When selecting a device Then their existing geometry remains untouched", () => {
  for (const projectType of ["slide_deck", "graphic", "logo"] as const) {
    for (const preset of ["fit", "desktop", "tablet", "phone"] as const) {
      expect(canvasDeviceWidth(projectType, preset)).toBeUndefined();
    }
  }
});

test("Given other website surfaces When selecting phone Then the shared surface contract applies", () => {
  expect(canvasDeviceWidth("from_template", "phone")).toBe(390);
  expect(canvasDeviceWidth("other", "tablet")).toBe(768);
});
