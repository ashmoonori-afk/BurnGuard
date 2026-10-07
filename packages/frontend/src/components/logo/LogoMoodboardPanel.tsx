import { useEffect, useId, useRef, useState } from "react";
import type { ClipboardEvent, DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ExternalLink, Globe, ImagePlus, Info, Link2, Loader2, Plus, Search, Sparkles, Tags, Upload, X } from "lucide-react";
import {
  MOODBOARD_MIME_TYPES,
  type LogoMoodboardV1,
  type LogoSetV1,
  type MoodboardItemV1,
} from "@bg/shared";
import {
  addMoodboardLink,
  getLogoMoodboard,
  moodboardFileUrl,
  removeMoodboardItem,
  uploadMoodboardFiles,
} from "@/api/logo-moodboard";
import { ApiError } from "@/api/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { apiErrorCopy } from "@/lib/error-copy";
import { logoInspirationKeywords, pinterestSearchUrl } from "@/lib/logo-inspiration";
import {
  moodboardUsage,
  normalizeMoodboardLink,
  planMoodboardFileIntake,
  planMoodboardTransfer,
} from "@/lib/logo-moodboard-intake";
import { useT, type MessageKey } from "@/i18n/t";
import { cn } from "@/lib/utils";

const ACCEPT = MOODBOARD_MIME_TYPES.join(",");

type FileItem = Extract<MoodboardItemV1, { readonly kind: "file" }>;
type LinkItem = Extract<MoodboardItemV1, { readonly kind: "link" }>;

/**
 * The Inspiration step of the logo pipeline: an image-first board. Uploaded
 * references fill a masonry board that accepts drops anywhere on the surface,
 * one compact bar turns brief keywords into an external Pinterest search, and
 * bookmarked links sit below as compact source cards. The panel owns no
 * scrollport; the parent delegates scrolling, and every mutation is disabled
 * while another one is in flight so the board revision stays linear.
 */
export default function LogoMoodboardPanel({
  projectId,
  brief,
  disabled,
  onNext,
}: {
  readonly projectId: string;
  readonly brief: LogoSetV1;
  readonly disabled: boolean;
  readonly onNext?: () => void;
}) {
  const t = useT();
  const client = useQueryClient();
  const queryKey = ["projects", projectId, "logo-moodboard"] as const;
  const board = useQuery({
    queryKey,
    queryFn: ({ signal }) => getLogoMoodboard(projectId, signal),
    retry: false,
  });

  const boardRef = useRef<LogoMoodboardV1 | null>(null);
  boardRef.current = board.data ?? null;

  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    return () => controller.abort();
  }, [projectId]);

  function remember(next: LogoMoodboardV1) {
    boardRef.current = next;
    client.setQueryData(queryKey, next);
  }

  const mutation = useMutation({
    mutationFn: async (input:
      | { readonly kind: "import"; readonly files: readonly File[]; readonly links: readonly string[] }
      | { readonly kind: "remove"; readonly id: string }
    ) => {
      let current = requireBoard(boardRef.current);
      const signal = abortRef.current?.signal;
      if (input.kind === "remove") return removeMoodboardItem(projectId, input.id, current.revision, signal);
      if (input.files.length > 0) {
        current = await uploadMoodboardFiles(projectId, input.files, current.revision, signal);
        remember(current);
      }
      for (const url of input.links) {
        current = await addMoodboardLink(projectId, url, current.revision, signal);
        remember(current);
      }
      return current;
    },
    onSuccess: remember,
    onError: () => { void client.invalidateQueries({ queryKey }); },
  });

  const busy = disabled || mutation.isPending || board.isPending || board.isError;

  const currentBoard = board.data ?? null;
  const usage = currentBoard === null ? { imageCount: 0, imageBytes: 0, linkCount: 0 } : moodboardUsage(currentBoard.items);
  const images = currentBoard === null ? [] : currentBoard.items.filter((item): item is FileItem => item.kind === "file");
  const links = currentBoard === null ? [] : currentBoard.items.filter((item): item is LinkItem => item.kind === "link");

  const [notice, setNotice] = useState<MessageKey | null>(null);
  const [linkValue, setLinkValue] = useState("");
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputId = useId();
  const linkInputId = useId();
  const boardHeadingId = useId();
  const linksHeadingId = useId();

  const keywords = logoInspirationKeywords(brief);
  const [query, setQuery] = useState(() => keywords.join(" "));
  const searchUrl = pinterestSearchUrl(query);

  function openFilePicker() {
    if (!busy) fileInputRef.current?.click();
  }

  function handleFiles(incoming: readonly File[], links: readonly string[] = []) {
    if (busy || currentBoard === null) return;
    const plan = planMoodboardFileIntake(usage, incoming);
    if (plan.rejected.length > 0) {
      setNotice(plan.rejected.some((item) => item.reason === "limit_reached") ? "logo.pipeline.limitReached" : "logo.pipeline.invalidFile");
    } else {
      setNotice(null);
    }
    if (plan.accepted.length > 0 || links.length > 0) mutation.mutate({ kind: "import", files: plan.accepted, links });
  }

  function submitLink() {
    const url = normalizeMoodboardLink(linkValue);
    if (url === null) {
      setNotice("logo.pipeline.invalidLink");
      return;
    }
    if (busy || currentBoard === null) return;
    setNotice(null);
    mutation.mutate({ kind: "import", files: [], links: [url] }, { onSuccess: () => setLinkValue("") });
  }

  function onDragEnter(event: DragEvent<HTMLElement>) {
    if (!carriesReferences(event.dataTransfer)) return;
    dragDepth.current += 1;
    setDragging(true);
  }

  function onDragLeave() {
    if (dragDepth.current === 0) return;
    dragDepth.current -= 1;
    if (dragDepth.current === 0) setDragging(false);
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (busy) return;
    const transfer = event.dataTransfer;
    const plan = planMoodboardTransfer({
      files: Array.from(transfer.files),
      uriList: transfer.getData("text/uri-list"),
      text: transfer.getData("text/plain"),
    });
    handleFiles(Array.from(transfer.files), plan.links);
  }

  function onPaste(event: ClipboardEvent<HTMLElement>) {
    if (busy) return;
    const clipboard = event.clipboardData;
    const files = Array.from(clipboard?.files ?? []);
    if (files.length > 0) {
      event.preventDefault();
      handleFiles(files);
      return;
    }
    if (isEditableTarget(event.target)) return;
    const plan = planMoodboardTransfer({ files: [], uriList: "", text: clipboard?.getData("text/plain") ?? "" });
    if (plan.links.length > 0) {
      event.preventDefault();
      handleFiles([], plan.links);
    }
  }

  const mutationError = mutation.isError ? errorCopyFor(t, mutation.error, "logo.pipeline.uploadFailed") : null;
  const queryError = board.isError ? apiErrorCopy(board.error) : null;
  const alert = queryError ?? mutationError ?? (notice === null ? null : t(notice));
  const alertRef = useRef<HTMLDivElement | null>(null);
  // The banner sits above the board; bring it into view so a refusal triggered lower down is seen.
  useEffect(() => {
    if (alert !== null) alertRef.current?.scrollIntoView({ block: "nearest" });
  }, [alert]);

  const spinning = board.isPending || mutation.isPending;
  const status = board.isPending
    ? t("logo.pipeline.working")
    : mutation.isPending
      ? t("logo.pipeline.saving")
      : currentBoard === null || board.isError
        ? null
        : t("logo.pipeline.saved");
  const needsImage = usage.linkCount > 0 && usage.imageCount === 0;

  return (
    <section
      aria-label={t("logo.pipeline.inspiration")}
      onPaste={onPaste}
      onDragEnter={onDragEnter}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = busy ? "none" : "copy";
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="relative flex min-h-full min-w-0 flex-col gap-4 bg-card px-4 pt-4 text-sm sm:px-6 sm:pt-5"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        multiple
        tabIndex={-1}
        aria-hidden="true"
        disabled={busy}
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) handleFiles(files);
        }}
      />

      <header className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={boardHeadingId} className="text-lg font-semibold leading-7 text-foreground">
            {t("logo.pipeline.moodboard")}
          </h2>
          {currentBoard === null ? null : (
            <p className="text-xs leading-5 text-muted-foreground">
              {t("logo.pipeline.imageCount", { count: usage.imageCount })}
              {usage.linkCount > 0 ? ` · ${t("logo.pipeline.linkCount", { count: usage.linkCount })}` : null}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {images.length > 0 && (
            <Button type="button" variant="outline" className="min-h-11 max-sm:w-11 max-sm:px-0" disabled={busy} onClick={openFilePicker}>
              <ImagePlus aria-hidden="true" />
              <span className="max-sm:sr-only">{t("logo.pipeline.addImages")}</span>
            </Button>
          )}
          <InfoTip label={t("logo.pipeline.boardInfoLabel")}>{t("logo.pipeline.boardInfo")}</InfoTip>
        </div>
      </header>

      <div
        role="search"
        className="flex min-w-0 items-center gap-1 rounded-xl border border-input bg-background p-1 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring"
      >
        {keywords.length === 0 ? null : (
          <details
            className="group/keywords relative shrink-0"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
              }
            }}
          >
            <summary aria-label={t("logo.pipeline.keywords")} className="flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-lg px-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <Tags aria-hidden="true" className="h-4 w-4" />
              <span className="hidden sm:inline">{t("logo.pipeline.keywords")}</span>
              <ChevronDown aria-hidden="true" className="h-3 w-3 group-open/keywords:rotate-180" />
            </summary>
          <ul aria-label={t("logo.pipeline.keywords")} className="absolute left-0 top-full z-20 mt-2 flex w-80 max-w-[calc(100vw-3rem)] flex-wrap gap-1 rounded-xl border border-border bg-card p-2 shadow-app-3">
            {keywords.map((keyword) => {
              const active = queryIncludes(query, keyword);
              return (
                <li key={keyword} className="min-w-0">
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => setQuery((current) => toggleKeyword(current, keyword))}
                    className={cn(
                      "inline-flex min-h-11 max-w-[16rem] items-center gap-1.5 rounded-lg px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "bg-accent/10 font-medium text-accent hover:bg-accent/15"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {active
                      ? <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                      : <Plus aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
                    <span className="truncate">{keyword}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          </details>
        )}
        <label htmlFor={searchInputId} className="flex min-w-0 flex-1 items-center gap-2 px-2">
          <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="sr-only">{t("logo.pipeline.searchQuery")}</span>
          <input
            id={searchInputId}
            type="search"
            value={query}
            placeholder={t("logo.pipeline.searchQuery")}
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-11 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        {searchUrl === null ? (
          <span aria-disabled="true" className={cn(buttonVariants({ variant: "outline" }), "ml-auto min-h-11 shrink-0 opacity-50")}>
            <ExternalLink aria-hidden="true" />
            {t("logo.pipeline.openPinterest")}
          </span>
        ) : (
          <a
            href={searchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "outline" }), "ml-auto min-h-11 shrink-0")}
          >
            <ExternalLink aria-hidden="true" />
            {t("logo.pipeline.openPinterest")}
          </a>
        )}
      </div>

      {alert === null ? null : (
        <div ref={alertRef} role="alert" className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm leading-5 text-foreground">
          <span className="min-w-0 flex-1">{alert}</span>
          {board.isError ? (
            <Button type="button" variant="outline" size="sm" className="min-h-11 shrink-0" onClick={() => void board.refetch()}>
              {t("workspace.project.retry")}
            </Button>
          ) : null}
        </div>
      )}

      {board.isPending ? (
        <p role="status" className="flex min-h-[16rem] flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          {t("logo.pipeline.working")}
        </p>
      ) : currentBoard === null ? null : images.length === 0 ? (
        <div className="flex min-h-[16rem] flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-input bg-background px-6 py-10 text-center">
          <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-full bg-card text-muted-foreground shadow-app-1">
            <ImagePlus className="h-6 w-6" />
          </span>
          <div className="flex max-w-sm flex-col gap-1">
            <p className="text-base font-semibold text-foreground">{t("logo.pipeline.emptyBoardTitle")}</p>
            <p className="text-sm leading-6 text-muted-foreground">{t("logo.pipeline.emptyBoardBody")}</p>
          </div>
          <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={openFilePicker}>
            <Upload aria-hidden="true" />
            {t("logo.pipeline.upload")}
          </Button>
        </div>
      ) : (
        <ul aria-labelledby={boardHeadingId} className={cn("gap-4", images.length === 1 ? "mx-auto w-full max-w-lg columns-1" : images.length === 2 ? "columns-1 sm:columns-2" : "columns-2 lg:columns-3")}>
          {images.map((item) => (
            <li key={item.id} className="mb-3 break-inside-avoid">
              <figure className="group/tile relative overflow-hidden rounded-xl bg-muted">
                <img
                  src={moodboardFileUrl(projectId, item.id)}
                  alt={t("logo.pipeline.referenceAlt")}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="block h-auto w-full object-contain"
                />
                <figcaption
                  title={item.original_name}
                  className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-3 pb-2 pt-6 text-xs text-white opacity-0 transition-opacity group-hover/tile:opacity-100 group-focus-within/tile:opacity-100"
                >
                  {item.original_name}
                </figcaption>
                <button
                  type="button"
                  aria-label={t("logo.pipeline.removeItem", { name: item.original_name })}
                  disabled={busy}
                  onClick={() => mutation.mutate({ kind: "remove", id: item.id })}
                  className="absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition-opacity hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 group-focus-within/tile:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/tile:opacity-100"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </figure>
            </li>
          ))}
        </ul>
      )}

      {currentBoard === null ? null : (
        <section aria-labelledby={linksHeadingId} className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <h3 id={linksHeadingId} className="text-sm font-semibold text-foreground">
              {t("logo.pipeline.links")}
              {links.length > 0 ? <span className="ml-1.5 font-normal text-muted-foreground">{links.length}</span> : null}
            </h3>
            <div className="flex min-w-0 flex-[1_1_18rem] items-center gap-1 rounded-lg border border-input bg-background pl-3 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring sm:ml-auto sm:max-w-md">
              <Link2 aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
              <label htmlFor={linkInputId} className="sr-only">{t("logo.pipeline.linkLabel")}</label>
              <input
                id={linkInputId}
                type="url"
                inputMode="url"
                placeholder="https://"
                value={linkValue}
                disabled={busy}
                onChange={(event) => setLinkValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitLink();
                  }
                }}
                className="min-h-11 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
              />
              <Button type="button" variant="ghost" className="min-h-11 shrink-0" disabled={busy || linkValue.trim() === ""} onClick={submitLink}>
                {t("logo.pipeline.addLink")}
              </Button>
            </div>
          </div>
          {links.length === 0 ? null : (
            <ul className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {links.map((item) => {
                const parts = linkParts(item.url);
                return (
                  <li key={item.id} className="flex min-w-0 items-center gap-1 rounded-lg border border-border bg-background py-1 pl-1">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={item.url}
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md px-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-card text-muted-foreground shadow-app-1">
                        <Globe className="h-4 w-4" />
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium text-foreground">{parts.host}</span>
                        {parts.path === "" ? null : <span className="truncate text-xs text-muted-foreground">{parts.path}</span>}
                      </span>
                    </a>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="min-h-11 min-w-11 shrink-0"
                      aria-label={t("logo.pipeline.removeItem", { name: parts.host })}
                      disabled={busy}
                      onClick={() => mutation.mutate({ kind: "remove", id: item.id })}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <footer className="sticky bottom-0 z-10 -mx-4 mt-auto flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <p aria-live="polite" className="flex min-w-0 flex-1 items-center gap-2 text-xs leading-5 text-muted-foreground">
          {spinning ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin" /> : null}
          <span className="min-w-0">{needsImage ? t("logo.pipeline.needsImage") : status}</span>
        </p>
        {onNext === undefined ? null : (
          <Button type="button" variant="cta" className="min-h-11 shrink-0 px-5" disabled={busy || needsImage} onClick={onNext}>
            <Sparkles aria-hidden="true" />
            {t("logo.pipeline.generateIdeas")}
          </Button>
        )}
      </footer>

      {dragging && !busy ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-20 flex items-start justify-center bg-accent/[0.06] pt-24">
          <span className="sticky top-[40%] flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background shadow-app-4">
            <ImagePlus className="h-4 w-4" />
            {t("logo.pipeline.dropToAdd")}
          </span>
        </div>
      ) : null}
    </section>
  );
}

/** The one short explanation a logo surface may carry, behind a hover/focus tip. */
export function InfoTip({ label, children }: { readonly label: string; readonly children: string }) {
  const id = useId();
  return (
    <span className="group/tip relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.currentTarget.blur();
        }}
        className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info aria-hidden="true" className="h-4 w-4" />
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-30 mt-1 hidden w-72 max-w-[calc(100vw-2rem)] rounded-lg bg-foreground px-3 py-2 text-xs leading-5 text-background shadow-app-3 group-hover/tip:block group-focus-within/tip:block"
      >
        {children}
      </span>
    </span>
  );
}

function requireBoard(board: LogoMoodboardV1 | null): LogoMoodboardV1 {
  if (board === null) throw new Error("Logo moodboard is not loaded.");
  return board;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

function errorCopyFor(translate: ReturnType<typeof useT>, error: unknown, fallback: MessageKey): string {
  return error instanceof ApiError ? apiErrorCopy(error) : translate(fallback);
}

/** Only a drag that can carry files or links lights the board up. */
function carriesReferences(transfer: DataTransfer): boolean {
  const types = Array.from(transfer.types);
  return types.includes("Files") || types.includes("text/uri-list");
}

function collapse(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function queryIncludes(query: string, keyword: string): boolean {
  return ` ${collapse(query)} `.includes(` ${collapse(keyword)} `);
}

/** Adds a keyword to the search or removes its first whole-phrase occurrence. */
function toggleKeyword(query: string, keyword: string): string {
  const current = collapse(query);
  const word = collapse(keyword);
  if (!queryIncludes(current, word)) return current === "" ? word : `${current} ${word}`;
  return collapse(` ${current} `.replace(` ${word} `, " "));
}

/** A stored link is already a parsed public https URL; split it for a compact card. */
function linkParts(url: string): { readonly host: string; readonly path: string } {
  const parsed = new URL(url);
  const path = `${parsed.pathname}${parsed.search}`;
  return { host: parsed.hostname.replace(/^www\./u, ""), path: path === "/" ? "" : path };
}
