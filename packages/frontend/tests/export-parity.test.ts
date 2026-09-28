import { describe, expect, test } from "bun:test";
import {
  parityThumbnailUrl,
} from "../src/components/export/ExportParitySummary";

describe("export parity status presentation", () => {
  test("Given an export id and page When thumbnail URL is built Then only the fixed authenticated route is addressed", () => {
    // Given / When
    const url = parityThumbnailUrl("job/with spaces", 2);

    // Then
    expect(url).toBe(
      "/api/exports/job%2Fwith%20spaces/parity/pages/2/thumbnail",
    );
  });
});
