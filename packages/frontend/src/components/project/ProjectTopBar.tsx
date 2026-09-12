import { Link } from "react-router-dom";
import { ChevronRight, PanelLeftClose, PanelLeftOpen, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";
import type { ProjectDetail } from "@bg/shared";
import ExportMenu, { type ExportQualityGate } from "@/components/export/ExportMenu";
import VercelShare from "@/components/export/VercelShare";
import { projectTypeLabel } from "@/lib/format";
import { useT } from "@/i18n/t";

export default function ProjectTopBar({
  project,
  tabsSlot,
  onPresent,
  canPresent,
  qualityGate,
  onOpenQuality,
  platformFix,
  chatCollapsed,
  onToggleChat,
}: {
  project: ProjectDetail;
  tabsSlot?: ReactNode;
  onPresent?: () => void;
  canPresent: boolean;
  qualityGate: ExportQualityGate;
  onOpenQuality: () => void;
  platformFix?: { readonly disabled: boolean; readonly onRequest: (prompt: string) => void };
  chatCollapsed?: boolean;
  onToggleChat?: () => void;
}) {
  const t = useT();
  const displayName = stripInternalProjectTag(project.name);
  return (
    <header className="shrink-0 border-b border-border bg-background">
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 max-[600px]:px-3">
      <div className="flex min-w-0 flex-1 items-center gap-3 max-[600px]:basis-full">
        {onToggleChat && <button type="button" onClick={onToggleChat} aria-label={t(chatCollapsed ? "files.project.expandChat" : "files.project.collapseChat")} title={t(chatCollapsed ? "files.project.expandChat" : "files.project.collapseChat")} className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted min-[901px]:flex">{chatCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}</button>}
        <Link
          to="/"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("files.project.backToList")}
          title={t("files.project.home")}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white"><img src="/assets/burnguard-mark.png" alt="" className="h-7 w-7 object-contain" /></span>
        </Link>
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground"><span>{t("files.project.label")}</span><ChevronRight className="h-3 w-3" aria-hidden="true" /><span>{projectTypeLabel(project.type)}</span></div>
          <h1
            className="truncate text-base font-semibold tracking-tight"
            title={displayName}
          >
            {displayName}
          </h1>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 max-[600px]:ml-auto">
        {project.type === "slide_deck" && (
        <Button
          variant="outline"
          size="sm"
          className="min-h-10 gap-2 px-3 max-[900px]:min-h-11"
          onClick={onPresent}
          disabled={!canPresent || !onPresent}
          title={
            canPresent
              ? t("files.project.startPresentation")
              : t("files.project.openDeck")
          }
        >
          <Play className="h-3.5 w-3.5" /> {t("files.project.present")}
        </Button>)}
        <VercelShare key={project.id} projectId={project.id} />
        <ExportMenu projectId={project.id} projectType={project.type} projectOptionsJson={project.options_json} qualityGate={qualityGate} onOpenQuality={onOpenQuality} {...(platformFix === undefined ? {} : { platformFix })} />
      </div>
      </div>
      {tabsSlot && <div className="h-10 min-w-0 overflow-hidden border-t border-border bg-muted/20 max-[900px]:h-11">{tabsSlot}</div>}
    </header>
  );
}

function stripInternalProjectTag(name: string): string {
  return name.replace(/^\[burnguard:[^\]]+\]\s*/, "");
}
