import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Blocks, File, Image, MoreHorizontal, Palette, Presentation, RefreshCw, Trash2 } from "lucide-react";
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

export default function ProjectCard(
  props: CardViewModel & { onDelete?: () => void },
) {
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
  const Icon = props.kind === "system" ? Palette : props.kind === "slide_deck" ? Presentation : props.kind === "prototype" ? Blocks : props.kind === "graphic" ? Image : File;

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
          {thumbnailSource === null ? (
            <div className="flex flex-col items-center gap-3 text-slate-500">
              <span className="grid h-16 w-16 place-items-center rounded-2xl border border-white/80 bg-white/70"><Icon className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" /></span>
              <span className="text-xs">{thumbnailFailed ? retryDelay === null ? "미리보기를 불러오지 못했어요" : "미리보기를 준비하고 있어요" : "미리보기가 없어요"}</span>
            </div>
          ) : (
            <img
              src={thumbnailSource}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
              onError={() => setFailedSource(thumbnailSource)}
            />
          )}
        </div>
        {props.isTemplate && (
          <Badge
            variant="outline"
            className="absolute top-2 left-2 bg-background/95 text-[10px] tracking-wider"
          >
            템플릿
          </Badge>
        )}
        <div data-qa="project-card-details" className="relative p-4 pr-10">
          <div className="line-clamp-1 text-sm font-semibold text-foreground">
            {props.name}
          </div>
          <div className="mt-1.5 line-clamp-1 text-xs text-muted-foreground">
            {props.subtitle}
          </div>
          <ArrowUpRight className="absolute right-4 top-4 h-4 w-4 text-muted-foreground group-hover:text-accent" aria-hidden="true" />
        </div>
      </Link>

      {thumbnailFailed && retryDelay === null && <button type="button" onClick={() => { setRetryAttempt(0); setFailedSource(null); projectLinkRef.current?.focus(); }} aria-label={`${props.name} 미리보기 다시 불러오기`} className="mt-2 flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />미리보기 다시 불러오기</button>}

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
                className="grid h-11 w-11 place-items-center rounded-xl border border-border bg-card/95 text-muted-foreground shadow-app-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`${props.name} 옵션 메뉴`}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive gap-2"
                onSelect={(e) => {
                  e.preventDefault();
                  props.onDelete?.();
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}

export type { CardViewModel };
