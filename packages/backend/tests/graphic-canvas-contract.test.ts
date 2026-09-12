import { describe, expect, test } from "bun:test";
import * as shared from "@bg/shared";

function graphicCanvasParser(): (input: unknown) => unknown {
  const parser = Reflect.get(shared, "parseGraphicCanvasV1");
  expect(typeof parser).toBe("function");
  if (typeof parser !== "function") {
    return () => undefined;
  }
  return parser;
}

describe("GraphicCanvasV1", () => {
  test.each([
    { schema_version: 1, width: 1080, height: 1080 },
    { schema_version: 1, width: 1200, height: 628 },
    { schema_version: 1, width: 1080, height: 1920 },
    { schema_version: 1, width: 320, height: shared.GRAPHIC_CANVAS_LIMITS.maxHeight },
  ])("Given a bounded canvas When parsed Then exact dimensions are preserved", (canvas) => {
    expect(graphicCanvasParser()(canvas)).toEqual(canvas);
  });

  test.each([
    [{ schema_version: 1, width: 1080.5, height: 1080 }, "width"],
    [{ schema_version: 1, width: 319, height: 1080 }, "width"],
    [{ schema_version: 1, width: 4097, height: 1080 }, "width"],
    [{ schema_version: 1, width: 1080, height: 239 }, "height"],
    [{ schema_version: 1, width: 1080, height: shared.GRAPHIC_CANVAS_LIMITS.maxHeight + 1 }, "height"],
    [{ schema_version: 1, width: 4000, height: 4001 }, "width"],
    [{ schema_version: 1, width: 1080, height: 1080, extra: true }, "extra"],
  ] satisfies readonly (readonly [Readonly<Record<string, unknown>>, string])[]) (
    "Given an invalid canvas When parsed Then the typed path is %s",
    (canvas, path) => {
      try {
        graphicCanvasParser()(canvas);
        throw new TypeError("expected GraphicCanvasV1 rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(shared.UpgradeContractError);
        if (!(error instanceof shared.UpgradeContractError)) throw error;
        expect(error.path).toBe(path);
      }
    },
  );
});
