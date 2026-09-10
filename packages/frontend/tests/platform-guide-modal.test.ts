import { describe, expect, test } from "bun:test";
import { PLATFORM_GUIDES } from "@bg/shared";
import {
  GUIDE_STATUS_BADGE,
  platformGuideView,
} from "../src/components/export/platform-guide";

describe("platform install guide modal content", () => {
  test("Given a Cafe24 package When the guide is viewed Then it renders the shared static guide", () => {
    const view = platformGuideView("cafe24_package");

    if (view === null) throw new TypeError("expected a Cafe24 guide");
    expect(view.title).toBe(PLATFORM_GUIDES.cafe24.title);
    expect(view.summary).toBe(PLATFORM_GUIDES.cafe24.summary);
    expect(view.rollback).toEqual(PLATFORM_GUIDES.cafe24.rollback);
    expect(view.unsupported).toEqual(PLATFORM_GUIDES.cafe24.unsupported);
    expect(view.verificationNote).toBe(PLATFORM_GUIDES.cafe24.verification_note);
    expect(view.checkedOn).toBe(PLATFORM_GUIDES.cafe24.checked_on);
  });

  test("Given a guide step When the guide is viewed Then its verified badge follows the shared status", () => {
    const view = platformGuideView("imweb_package");

    if (view === null) throw new TypeError("expected an Imweb guide");
    expect(view.steps.map((step) => step.title)).toEqual(PLATFORM_GUIDES.imweb.steps.map((step) => step.title));
    expect(view.steps.map((step) => step.badge)).toEqual(
      PLATFORM_GUIDES.imweb.steps.map((step) => GUIDE_STATUS_BADGE[step.status]),
    );
    expect(GUIDE_STATUS_BADGE.verified).not.toBe(GUIDE_STATUS_BADGE.unverified);
  });

  test.each([
    ["cafe24_package", PLATFORM_GUIDES.cafe24],
    ["imweb_package", PLATFORM_GUIDES.imweb],
  ] as const)(
    "Given a platform guide When the guide is viewed Then every string comes from the shared guide, never from an archive",
    (format, guide) => {
      const view = platformGuideView(format);

      if (view === null) throw new TypeError("expected a guide");
      const shared = new Set<string>([
        guide.title,
        guide.summary,
        guide.verification_note,
        guide.checked_on,
        ...guide.prerequisites,
        ...guide.rollback,
        ...guide.unsupported,
        ...guide.steps.flatMap((step) => [step.title, step.body]),
      ]);
      const rendered = [
        view.title,
        view.summary,
        view.verificationNote,
        view.checkedOn,
        ...view.prerequisites,
        ...view.rollback,
        ...view.unsupported,
        ...view.steps.flatMap((step) => [step.title, step.body]),
      ];
      expect(rendered.every((value) => shared.has(value))).toBe(true);
    },
  );

  test("Given a non-platform export When the guide is viewed Then no modal content exists", () => {
    expect(platformGuideView("pdf")).toBeNull();
    expect(platformGuideView("png_zip")).toBeNull();
  });
});
