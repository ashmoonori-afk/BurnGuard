import type {
  DesignSystemStatus,
  DesignSystemSummary,
  ProjectSummary,
  ProjectType,
} from "@bg/shared";
import { formatRelativeDay, projectTypeLabel } from "@/lib/format";
import { t, type MessageKey } from "@/i18n/t";

/**
 * View model consumed by the presentational Card component. Independent of
 * the underlying DTO so the card stays stable even if contracts evolve.
 */
export interface CardViewModel {
  id: string;
  name: string;
  subtitle: string;
  href: string;
  tintClass: string;
  kind?: ProjectType | "system";
  thumbnail?: string | null;
  isTemplate?: boolean;
}

export function filterHomeCards(
  cards: readonly CardViewModel[],
  query: string,
): readonly CardViewModel[] {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) {
    return cards;
  }
  return cards.filter((card) =>
    normalizeSearchText(card.name).includes(normalizedQuery),
  );
}

const PROJECT_TINTS: Record<string, string> = {
  prototype: "bg-rose-100",
  slide_deck: "bg-slate-100",
  graphic: "bg-sky-100",
  from_template: "bg-blue-100",
  other: "bg-stone-100",
};

const SYSTEM_TINTS = ["bg-amber-100", "bg-sky-100", "bg-emerald-100", "bg-violet-100"];

const SYSTEM_STATUS_SUFFIX: Record<DesignSystemStatus, MessageKey> = {
  draft: "home.systemDraft",
  review: "home.systemReview",
  published: "home.system",
};

export function projectToCard(p: ProjectSummary): CardViewModel {
  const name = stripInternalProjectTag(p.name);
  return {
    id: p.id,
    name,
    subtitle: `${projectTypeDisplayLabel(p.type)} · ${formatRelativeDay(p.updated_at)}`,
    href: `/projects/${p.id}`,
    tintClass: PROJECT_TINTS[p.type] ?? "bg-stone-100",
    thumbnail: p.thumbnail_path,
    kind: p.type,
  };
}

/**
 * The "템플릿" badge and label belong to design-system cards
 * (`is_template`), not to projects — a project merely created from a
 * template still renders under one of the four real project types, so
 * `from_template` (which the render pipeline itself treats like
 * `other`, see services/exports.ts) falls back to "기타" here instead
 * of leaking the shared "템플릿" label onto a project card.
 */
function projectTypeDisplayLabel(type: string): string {
  return projectTypeLabel(type === "from_template" ? "other" : type);
}

export function systemToCard(s: DesignSystemSummary, index = 0): CardViewModel {
  const statusSuffix = t(SYSTEM_STATUS_SUFFIX[s.status]);
  return {
    id: s.id,
    name: s.name,
    subtitle: `${statusSuffix} · ${formatRelativeDay(s.updated_at)}`,
    href: `/systems/${s.id}`,
    tintClass: SYSTEM_TINTS[index % SYSTEM_TINTS.length],
    thumbnail: s.thumbnail_path,
    kind: "system",
    isTemplate: s.is_template,
  };
}

function stripInternalProjectTag(name: string): string {
  return name.replace(/^\[burnguard:[^\]]+\]\s*/, "");
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFC")
    .toLocaleLowerCase("ko-KR")
    .trim()
    .replace(/\s+/gu, " ");
}
