import type { VisualSourceRole } from "@bg/shared";
import { ApiError } from "@/api/client";
import { apiErrorCopy } from "@/lib/error-copy";
import { t, type MessageKey } from "@/i18n/t";

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

export const COMPOSER_SUPPORTED_EXTENSIONS = [".pdf", ".pptx", ".docx", ".png", ".jpg", ".jpeg", ".webp"] as const;

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
const VISUAL_SOURCE_ERROR_KEYS: Readonly<Partial<Record<string, MessageKey>>> = {
  invalid_attachments: "chat.send.invalidAttachments",
  invalid_visual_sources: "chat.send.invalidRoles",
  unsupported_visual_source: "chat.send.unsupportedSource",
  session_busy: "chat.send.sessionBusy",
};

export function visualSourceSendErrorCopy(error: unknown): string {
  if (!(error instanceof ApiError)) return t("chat.send.genericError");
  const key = VISUAL_SOURCE_ERROR_KEYS[error.code];
  return key ? t(key) : apiErrorCopy(error);
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
