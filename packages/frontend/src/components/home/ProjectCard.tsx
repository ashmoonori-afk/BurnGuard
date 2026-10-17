import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/t";
import { Link } from "react-router-dom";
import { ArrowUpRight, Blocks, File, Image, MoreHorizontal, Palette, PenTool, Presentation, RefreshCw, Trash2 } from "lucide-react";
import { resolveThumbnailSource, thumbnailRetryDelay } from "./thumbnail-source";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { CardViewModel } from "./mappers";
import type { ExampleBrief } from "@/lib/example-briefs";

export default function ProjectCard(
  props: CardViewModel & { onDelete?: () => void; brief?: ExampleBrief | null; onStartFrom?: (brief: ExampleBrief) => void },
) {
  const t = useT();
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const projectLinkRef = useRef<HTMLAnchorElement>(null);
  const thumbnailSource = resolveThumbnailSource(props.thumbnail, failedSource);
  const thumbnailFailed = Boolean(props.thumbnail) && props.thumbnail === failedSource;
  const retryDelay = thumbnailRetryDelay(retryAttempt);
  useEffect(() => { setRetryAttempt(0); setFailedSource(null); }, [props.thumbnail]);
  useEffect(() => {
    if (!thumbnailFailed || retryDelay === null) return;
    const timer = setTimeout(() => { setRetryAttempt((attempt) => attempt + 1); setFailedSource(null); }, retryDelay);
    return () => clearTimeout(timer);
  }, [thumbnailFailed, retryDelay]);
  const Icon = props.kind === "system" ? Palette : props.kind === "slide_deck" ? Presentation : props.kind === "prototype" ? Blocks : props.kind === "graphic" ? Image : props.kind === "logo" ? PenTool : File;

  return (
    <div className="group relative">
      <Link
        ref={projectLinkRef}
        to={props.href}
        className="block overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div
          data-qa="project-thumbnail"
          data-state={thumbnailSource === null ? "fallback" : "image"}
          className={cn(
            "aspect-[16/10] grid place-items-center overflow-hidden border-b border-border/60",
            props.tintClass,
          )}
        >
          {thumbnailSource === null ? props.kind === "system" && props.monogram !== undefined ? (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <span aria-hidden="true" className="grid h-14 w-14 place-items-center rounded-full border border-border bg-card text-xl font-semibold text-foreground/70">{props.monogram}</span>
              <span className="text-xs">{t("home.previewEmpty")}</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <span className="grid h-16 w-16 place-items-center rounded-2xl border border-card/80 bg-card/70"><Icon className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" /></span>
              <span className="rounded-md bg-card px-2 py-1 text-xs text-muted-foreground">{thumbnailFailed ? retryDelay === null ? t("home.previewError") : t("home.previewPreparing") : t("home.previewEmpty")}</span>
            </div>
          ) : (
            <>
            {props.kind === "system" && props.monogram !== undefined ? <span aria-hidden="true" className="col-start-1 row-start-1 grid h-14 w-14 place-items-center place-self-center rounded-full border border-border bg-card text-xl font-semibold text-foreground/70">{props.monogram}</span> : null}
            <img
              src={thumbnailSource}
              alt=""
              loading="lazy"
              decoding="async"
              className="col-start-1 row-start-1 h-full w-full object-cover"
              onError={() => setFailedSource(thumbnailSource)}
            />
            </>
          )}
        </div>
        {props.isTemplate && (
          <Badge
            variant="outline"
            className="absolute top-2 left-2 bg-background/95 text-xs"
          >
            {t("home.type.from_template")}
          </Badge>
        )}
        <div data-qa="project-card-details" className="relative p-4 pr-10">
          <div className="line-clamp-1 text-sm font-semibold text-foreground">
            {props.name}
          </div>
          <div className="mt-1.5 line-clamp-1 text-xs text-muted-foreground" title={props.updatedTitle}>
            {props.subtitle}
          </div>
          <ArrowUpRight className="absolute right-4 top-4 h-4 w-4 text-muted-foreground group-hover:text-accent" aria-hidden="true" />
        </div>
      </Link>

      {thumbnailFailed && retryDelay === null && <button type="button" onClick={() => { setRetryAttempt(0); setFailedSource(null); projectLinkRef.current?.focus(); }} aria-label={t("home.previewRetryNamed", { name: props.name })} className="mt-2 flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />{t("home.previewRetry")}</button>}

      {props.onDelete && (
        <div className="absolute top-2 right-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                type="button"
                className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-card/95 text-muted-foreground shadow-app-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("home.optionsNamed", { name: props.name })}
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" sideOffset={6} collisionPadding={12} className="min-w-[11rem] p-1.5" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem
                className="min-h-9 gap-2.5 px-3 text-sm font-medium text-destructive focus:bg-destructive/10 focus:text-destructive"
                onSelect={(e) => {
                  e.preventDefault();
                  props.onDelete?.();
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {t("home.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {props.brief && props.onStartFrom ? <div className="mt-2 rounded-xl border border-border bg-card p-3 text-xs" data-qa="example-brief">
        <details>
          <summary className="min-h-6 cursor-pointer rounded-sm py-1 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">{t("home.example.seeBrief")}</summary>
          <dl className="mt-2 space-y-1 text-muted-foreground">
            <div><dt className="inline font-medium text-foreground">{t("home.example.audience")}: </dt><dd className="inline">{props.brief.audience}</dd></div>
            <div><dt className="inline font-medium text-foreground">{t("home.example.objective")}: </dt><dd className="inline">{props.brief.objective}</dd></div>
          </dl>
        </details>
        <button type="button" data-qa="example-start-from" onClick={() => props.brief && props.onStartFrom?.(props.brief)} className="mt-2 min-h-10 w-full rounded-lg border border-border px-3 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("home.example.startFrom")}</button>
      </div> : null}
    </div>
  );
}

export type { CardViewModel };
