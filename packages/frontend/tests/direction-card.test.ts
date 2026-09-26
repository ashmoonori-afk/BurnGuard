import { expect, test } from "bun:test";
import { DIRECTION_CANCELLATION_ERROR, DIRECTION_INTERRUPTION_ERROR, DIRECTION_RENDER_ERROR } from "@bg/shared";
import { slotFailure } from "../src/components/directions/DirectionCard";
import { t } from "../src/i18n/t";

test("Given a failed slot carrying the shared interruption or cancellation error When its failure copy resolves Then the matching specific message is chosen", () => {
  expect(slotFailure("failed", DIRECTION_INTERRUPTION_ERROR)).toBe(t("directions.previewInterrupted"));
  expect(slotFailure("cancelled", DIRECTION_CANCELLATION_ERROR)).toBe(t("directions.previewCancelled"));
  expect(slotFailure("failed", DIRECTION_RENDER_ERROR)).toBe(t("directions.previewFailed"));
  expect(slotFailure("failed", null)).toBe(t("directions.previewFailed"));
});

test("Given the direction card source When scanned Then the backend error strings are imported, never spelled out", async () => {
  const source = await Bun.file(new URL("../src/components/directions/DirectionCard.tsx", import.meta.url)).text();
  expect(source).not.toContain("Direction generation was");
  expect(source).toContain("DIRECTION_INTERRUPTION_ERROR");
  expect(source).toContain("DIRECTION_CANCELLATION_ERROR");
});
