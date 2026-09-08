import { useState } from "react";
import { Link } from "react-router-dom";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { resolveThumbnailSource } from "./thumbnail-source";
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
  const thumbnailSource = resolveThumbnailSource(props.thumbnail, failedSource);

  return (
    <div className="group relative">
      <Link
        to={props.href}
        className="block rounded-xl border border-border bg-card overflow-hidden hover:shadow-app-3 transition-shadow"
      >
        <div
          data-qa="project-thumbnail"
          data-state={thumbnailSource === null ? "fallback" : "image"}
          className={cn(
            "aspect-video grid place-items-center overflow-hidden text-2xl",
            props.tintClass,
          )}
        >
          {thumbnailSource === null ? (
            props.emoji ? (
              <span className="text-3xl">{props.emoji}</span>
            ) : (
              <div className="h-10 w-10 rounded bg-white/50 border border-border" />
            )
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
        <div data-qa="project-card-details" className="p-3">
          <div className="text-sm font-medium text-foreground line-clamp-1">
            {props.name}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
            {props.subtitle}
          </div>
        </div>
      </Link>

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
                className="h-11 w-11 rounded-md bg-background/95 border border-border grid place-items-center text-muted-foreground hover:text-foreground shadow-app-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
