import { t, type MessageKey } from "@/i18n/t";
import {
  platformGuideFor,
  type PlatformGuidePlatform,
  type ExportFormat,
  type PlatformGuideStatus,
} from "@bg/shared";

export const GUIDE_STATUS_BADGE: Record<PlatformGuideStatus, string> = {
  get verified() { return t("export.guide.verified"); },
  get unverified() { return t("export.guide.unverified"); },
};

export type PlatformGuideStepView = {
  readonly title: string;
  readonly body: string;
  readonly badge: string;
};

export type PlatformGuideView = {
  readonly title: string;
  readonly summary: string;
  readonly prerequisites: readonly string[];
  readonly steps: readonly PlatformGuideStepView[];
  readonly rollback: readonly string[];
  readonly unsupported: readonly string[];
  readonly verificationNote: string;
  readonly checkedOn: string;
};

type GuideMessageKeys = {
  readonly title: MessageKey;
  readonly summary: MessageKey;
  readonly prerequisites: readonly MessageKey[];
  readonly steps: readonly { readonly title: MessageKey; readonly body: MessageKey }[];
  readonly rollback: readonly MessageKey[];
  readonly unsupported: readonly MessageKey[];
  readonly verification: MessageKey;
};

// Frontend-only display copy. Shared guides still define package contents and verification status.
const GUIDE_MESSAGES: Record<PlatformGuidePlatform, GuideMessageKeys> = {
  cafe24: {
    title: "export.guide.cafe24.title", summary: "export.guide.cafe24.summary",
    prerequisites: ["export.guide.cafe24.prerequisite0", "export.guide.cafe24.prerequisite1"],
    steps: [
      { title: "export.guide.cafe24.step0.title", body: "export.guide.cafe24.step0.body" },
      { title: "export.guide.cafe24.step1.title", body: "export.guide.cafe24.step1.body" },
      { title: "export.guide.cafe24.step2.title", body: "export.guide.cafe24.step2.body" },
      { title: "export.guide.cafe24.step3.title", body: "export.guide.cafe24.step3.body" },
      { title: "export.guide.cafe24.step4.title", body: "export.guide.cafe24.step4.body" },
    ],
    rollback: ["export.guide.cafe24.rollback0", "export.guide.cafe24.rollback1", "export.guide.cafe24.rollback2"],
    unsupported: ["export.guide.cafe24.unsupported0", "export.guide.cafe24.unsupported1", "export.guide.cafe24.unsupported2", "export.guide.cafe24.unsupported3"],
    verification: "export.guide.cafe24.verification",
  },
  imweb: {
    title: "export.guide.imweb.title", summary: "export.guide.imweb.summary",
    prerequisites: ["export.guide.imweb.prerequisite0", "export.guide.imweb.prerequisite1"],
    steps: [
      { title: "export.guide.imweb.step0.title", body: "export.guide.imweb.step0.body" },
      { title: "export.guide.imweb.step1.title", body: "export.guide.imweb.step1.body" },
      { title: "export.guide.imweb.step2.title", body: "export.guide.imweb.step2.body" },
      { title: "export.guide.imweb.step3.title", body: "export.guide.imweb.step3.body" },
      { title: "export.guide.imweb.step4.title", body: "export.guide.imweb.step4.body" },
      { title: "export.guide.imweb.step5.title", body: "export.guide.imweb.step5.body" },
    ],
    rollback: ["export.guide.imweb.rollback0", "export.guide.imweb.rollback1", "export.guide.imweb.rollback2"],
    unsupported: ["export.guide.imweb.unsupported0", "export.guide.imweb.unsupported1", "export.guide.imweb.unsupported2", "export.guide.imweb.unsupported3", "export.guide.imweb.unsupported4"],
    verification: "export.guide.imweb.verification",
  },
};

/**
 * The install guide is static shared data (doc/14 section 9.1): the modal shows
 * these strings as text and never content read back from an exported archive.
 */
export function platformGuideView(format: ExportFormat): PlatformGuideView | null {
  const guide = platformGuideFor(format);
  if (guide === null) return null;
  const copy = GUIDE_MESSAGES[guide.platform];
  return {
    title: t(copy.title),
    summary: t(copy.summary),
    prerequisites: copy.prerequisites.map((key) => t(key)),
    steps: guide.steps.map((step, index) => {
      const localized = copy.steps[index];
      if (localized === undefined) throw new Error(`Missing platform guide translation: ${guide.platform} step ${index}`);
      return {
        title: t(localized.title),
        body: t(localized.body),
        badge: GUIDE_STATUS_BADGE[step.status],
      };
    }),
    rollback: copy.rollback.map((key) => t(key)),
    unsupported: copy.unsupported.map((key) => t(key)),
    verificationNote: t(copy.verification),
    checkedOn: guide.checked_on,
  };
}
