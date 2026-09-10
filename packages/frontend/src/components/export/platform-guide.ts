import {
  platformGuideFor,
  type ExportFormat,
  type PlatformGuideStatus,
} from "@bg/shared";

export const GUIDE_STATUS_BADGE: Record<PlatformGuideStatus, string> = {
  verified: "공식 문서 확인",
  unverified: "미확인",
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

/**
 * The install guide is static shared data (doc/14 section 9.1): the modal shows
 * these strings as text and never content read back from an exported archive.
 */
export function platformGuideView(format: ExportFormat): PlatformGuideView | null {
  const guide = platformGuideFor(format);
  if (guide === null) return null;
  return {
    title: guide.title,
    summary: guide.summary,
    prerequisites: guide.prerequisites,
    steps: guide.steps.map((step) => ({
      title: step.title,
      body: step.body,
      badge: GUIDE_STATUS_BADGE[step.status],
    })),
    rollback: guide.rollback,
    unsupported: guide.unsupported,
    verificationNote: guide.verification_note,
    checkedOn: guide.checked_on,
  };
}
