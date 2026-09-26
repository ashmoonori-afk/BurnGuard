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

/** The recent tab is a 12-row glance; a search there runs over the full list so an older match is never reported missing. */
export function projectSearchTab<Tab extends string>(tab: Tab | "recent", query: string): Tab | "recent" | "mine" {
  return tab === "recent" && query.trim().length > 0 ? "mine" : tab;
}

const PROJECT_TINTS: Record<string, string> = {
  prototype: "bg-tint-rose",
  slide_deck: "bg-tint-slate",
  graphic: "bg-tint-sky",
  logo: "bg-tint-fuchsia",
  from_template: "bg-tint-blue",
  other: "bg-tint-stone",
};

const SYSTEM_TINTS = ["bg-tint-amber", "bg-tint-sky", "bg-tint-emerald", "bg-tint-violet"];

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
    tintClass: PROJECT_TINTS[p.type] ?? "bg-tint-stone",
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

export function systemToCard(s: DesignSystemSummary, index = 0, type?: ProjectType): CardViewModel {
  const statusSuffix = t(SYSTEM_STATUS_SUFFIX[s.status]);
  return {
    id: s.id,
    name: s.name,
    subtitle: `${statusSuffix} · ${formatRelativeDay(s.updated_at)}`,
    href: `/systems/${s.id}`,
    tintClass: SYSTEM_TINTS[index % SYSTEM_TINTS.length],
    thumbnail: type === undefined || type === "other" || type === "from_template"
      ? s.thumbnail_path
      : s.thumbnail_paths?.[type] ?? null,
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
