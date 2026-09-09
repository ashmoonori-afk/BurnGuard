import type { VisualSourceRole } from "@bg/shared";
import { ApiError } from "@/api/client";
import { apiErrorCopy } from "@/lib/error-copy";

/**
 * Mirrors the backend intake contract for early feedback only. The backend
 * remains authoritative, and composer-intake.test.ts pins supported kinds
 * against the real extractor.
 */
export const COMPOSER_ATTACHMENT_LIMITS = {
  maxCount: 8,
  maxBytesPerFile: 10 * 1024 * 1024,
  maxBytesTotal: 25 * 1024 * 1024,
} as const;

export const COMPOSER_SUPPORTED_EXTENSIONS = [".pdf", ".pptx"] as const;

export type IntakeRejection =
  | "unsupported_kind"
  | "too_large"
  | "count_exceeded"
  | "total_exceeded";

export type IntakeItem =
  | { readonly id: string; readonly status: "ready"; readonly file: File; readonly role: VisualSourceRole }
  | {
      readonly id: string;
      readonly status: "rejected";
      readonly file: File;
      readonly reason: IntakeRejection;
    };

export type ReadyAttachmentSource = {
  readonly id: string;
  readonly file: File;
  readonly role: VisualSourceRole;
};

export type SendOutcome =
  | { readonly kind: "cancelled" }
  | {
      readonly kind: "failed";
      readonly code: string;
      readonly message: string;
    };

/** Screens picked or dropped files into states the UI can truthfully show. */
export function planAttachmentIntake(
  current: readonly IntakeItem[],
  incoming: readonly File[],
): readonly IntakeItem[] {
  const items = [...current];
  for (const file of incoming) {
    const ready = items.filter((item) => item.status === "ready");
    const readyBytes = ready.reduce(
      (total, item) => total + item.file.size,
      0,
    );
    const reason = rejectionFor(file, ready.length, readyBytes);
    const id = crypto.randomUUID();
    items.push(
      reason === null
        ? { id, status: "ready", file, role: "ordinary_content" }
        : { id, status: "rejected", file, reason },
    );
  }
  return items;
}

export function readyAttachmentSources(items: readonly IntakeItem[]): readonly ReadyAttachmentSource[] {
  return items.flatMap((item) => item.status === "ready" ? [{ id: item.id, file: item.file, role: item.role }] : []);
}

export function setAttachmentRole(
  items: readonly IntakeItem[],
  id: string,
  role: VisualSourceRole,
): readonly IntakeItem[] {
  return items.map((item) => item.id === id && item.status === "ready" ? { ...item, role } : item);
}

/**
 * An aborted request reports cancellation. Any other observed error stays
 * retryable without inferring server-side extraction progress.
 */
export function visualSourceSendErrorCopy(error: unknown): string {
  if (!(error instanceof ApiError)) return "요청을 보내지 못했어요. 잠시 후 다시 시도해 주세요.";
  switch (error.code) {
    case "invalid_attachments": return "첨부 자료를 확인할 수 없어요. 목록에서 제거한 뒤 다시 올려 주세요.";
    case "invalid_visual_sources": return "시각 자료 역할 정보가 올바르지 않아요. 역할을 다시 선택해 주세요.";
    case "unsupported_visual_source": return "URL·웹·스톡 자료는 지원하지 않아요. 로컬 PDF 또는 PPTX를 올려 주세요.";
    case "session_busy": return "이미 작업이 진행 중이에요. 완료된 뒤 다시 보내 주세요.";
    default: return apiErrorCopy(error);
  }
}

export function resolveSendOutcome(error: unknown): SendOutcome {
  if (error instanceof DOMException && error.name === "AbortError") {
    return { kind: "cancelled" };
  }
  if (error instanceof ApiError) {
    return {
      kind: "failed",
      code: error.code,
      message: error.message,
    };
  }
  return {
    kind: "failed",
    code: "unknown",
    message: error instanceof Error ? error.message : String(error),
  };
}

function rejectionFor(
  file: File,
  readyCount: number,
  readyBytes: number,
): IntakeRejection | null {
  const name = file.name.toLowerCase();
  if (
    !COMPOSER_SUPPORTED_EXTENSIONS.some((extension) =>
      name.endsWith(extension),
    )
  ) {
    return "unsupported_kind";
  }
  if (file.size > COMPOSER_ATTACHMENT_LIMITS.maxBytesPerFile) {
    return "too_large";
  }
  if (readyCount >= COMPOSER_ATTACHMENT_LIMITS.maxCount) {
    return "count_exceeded";
  }
  if (readyBytes + file.size > COMPOSER_ATTACHMENT_LIMITS.maxBytesTotal) {
    return "total_exceeded";
  }
  return null;
}
