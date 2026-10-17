import { Link } from "react-router-dom";
import { Archive, ChevronRight, Figma, FolderOpen, MoreHorizontal, NotebookPen, PanelLeftClose, PanelLeftOpen, Play, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import type { ReactNode } from "react";
import type { ProjectDetail } from "@bg/shared";
import ExportMenu, { type ExportQualityGate } from "@/components/export/ExportMenu";
import VercelShare from "@/components/export/VercelShare";
import { projectTypeLabel } from "@/lib/format";
import { splitHeaderActions, type HeaderActionId } from "@/lib/project-header-actions";
import { useHeaderTier } from "@/hooks/useHeaderTier";
import { useT } from "@/i18n/t";
import ProjectBundleButton, { useProjectBundleExport } from "./ProjectBundleButton";
import ProjectInstructionsButton, { ProjectInstructionsDialog, useProjectInstructionsActive } from "./ProjectInstructionsButton";
import { useState } from "react";
import FigmaImportDialog from "./FigmaImportDialog";
import ProjectFolderButton, { useRevealProjectFolder } from "./ProjectFolderButton";

/** Below 600px the actions wrap so Export stays on screen instead of overflowing the header. */
export const PROJECT_ACTIONS_CLASS = "flex max-w-full shrink-0 flex-wrap items-center gap-2 max-[600px]:ml-auto max-[600px]:shrink max-[600px]:flex-wrap max-[600px]:justify-end";

const BUTTON_CLASS = "min-h-10 gap-2 px-3 max-[900px]:min-h-11";

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
  onFigmaImported,
  figmaImportDisabled = false,
  artifactRevision,
  artifactDigest,
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
  onFigmaImported: () => Promise<void>;
  figmaImportDisabled?: boolean;
  artifactRevision: number;
  artifactDigest: string;
}) {
  const t = useT();
  const [figmaImportOpen, setFigmaImportOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const tier = useHeaderTier();
  const { inline, overflow } = splitHeaderActions(tier, project.type);
  const folder = useRevealProjectFolder(project.id);
  const bundle = useProjectBundleExport(project.id);
  const instructionsActive = useProjectInstructionsActive(project.id);
  const displayName = stripInternalProjectTag(project.name);

  const presentTitle = canPresent ? t("files.project.startPresentation") : t("files.project.openDeck");
  const inlineAction = (id: HeaderActionId): ReactNode => {
    switch (id) {
      case "folder":
        return <ProjectFolderButton key={id} projectId={project.id} />;
      case "figma":
        return (
          <Button key={id} variant="outline" size="sm" className={BUTTON_CLASS} onClick={() => setFigmaImportOpen(true)} disabled={figmaImportDisabled}>
            <Figma className="h-3.5 w-3.5" aria-hidden="true" />{t("workspace.figma.action")}
          </Button>
        );
      case "present":
        return (
          <Button key={id} variant="outline" size="sm" className={BUTTON_CLASS} onClick={onPresent} disabled={!canPresent || !onPresent} title={presentTitle}>
            <Play className="h-3.5 w-3.5" aria-hidden="true" /> {t("files.project.present")}
          </Button>
        );
      case "share":
        return <VercelShare key={project.id} projectId={project.id} projectType={project.type} open={shareOpen} onOpenChange={setShareOpen} />;
      case "instructions":
        return <ProjectInstructionsButton key={id} projectId={project.id} onOpen={() => setInstructionsOpen(true)} />;
      case "backup":
        return <ProjectBundleButton key={id} projectId={project.id} />;
      default: {
        const unreachable: never = id;
        return unreachable;
      }
    }
  };
  const menuItem = (id: HeaderActionId): ReactNode => {
    switch (id) {
      case "folder":
        return <DropdownMenuItem key={id} className="min-h-9 text-sm" disabled={folder.pending} onSelect={() => void folder.reveal()}><FolderOpen className="h-4 w-4" aria-hidden="true" />{t(folder.pending ? "workspace.project.folderPending" : "workspace.project.showFolder")}</DropdownMenuItem>;
      case "figma":
        return <DropdownMenuItem key={id} className="min-h-9 text-sm" disabled={figmaImportDisabled} onSelect={() => setFigmaImportOpen(true)}><Figma className="h-4 w-4" aria-hidden="true" />{t("workspace.figma.action")}</DropdownMenuItem>;
      case "present":
        return <DropdownMenuItem key={id} className="min-h-9 text-sm" disabled={!canPresent || !onPresent} title={presentTitle} onSelect={() => onPresent?.()}><Play className="h-4 w-4" aria-hidden="true" />{t("files.project.present")}</DropdownMenuItem>;
      case "share":
        return <DropdownMenuItem key={id} className="min-h-9 text-sm" onSelect={() => setShareOpen(true)}><Share2 className="h-4 w-4" aria-hidden="true" />{t("export.share.title")}</DropdownMenuItem>;
      case "instructions":
        return <DropdownMenuItem key={id} className="min-h-9 text-sm" onSelect={() => setInstructionsOpen(true)}><NotebookPen className="h-4 w-4" aria-hidden="true" />{t(instructionsActive ? "workspace.instructions.buttonActive" : "workspace.instructions.button")}</DropdownMenuItem>;
      case "backup":
        return <DropdownMenuItem key={id} className="min-h-9 text-sm" disabled={bundle.pending} onSelect={() => void bundle.onExport()}><Archive className="h-4 w-4" aria-hidden="true" />{t(bundle.pending ? "export.projectBundlePending" : "export.projectBundle")}</DropdownMenuItem>;
      default: {
        const unreachable: never = id;
        return unreachable;
      }
    }
  };

  return (
    <header className="shrink-0 border-b border-border bg-background">
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 max-[600px]:px-3">
      <div className="flex min-w-0 flex-1 items-center gap-3 basis-[14rem]">
        {onToggleChat && <button type="button" onClick={onToggleChat} aria-label={t(chatCollapsed ? "files.project.expandChat" : "files.project.collapseChat")} title={t(chatCollapsed ? "files.project.expandChat" : "files.project.collapseChat")} className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-[901px]:flex">{chatCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}</button>}
        <Link
          to="/"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("files.project.backToList")}
          title={t("files.project.home")}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white"><img src="/assets/burnguard-mark.png" alt="" className="h-7 w-7 object-contain" /></span>
        </Link>
        <div className="min-w-[6rem] flex-1">
          <div className="mb-0.5 flex items-center gap-1 text-xs text-muted-foreground max-[600px]:hidden"><span className="shrink-0">{t("files.project.label")}</span><ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" /><span className="truncate">{projectTypeLabel(project.type)}</span></div>
          <Tooltip content={displayName} side="bottom" wrapperClassName="flex min-w-0 max-w-full">
            <h1 tabIndex={0} className="min-w-0 truncate rounded-sm text-base font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {displayName}
            </h1>
          </Tooltip>
        </div>
      </div>
      <div className={PROJECT_ACTIONS_CLASS}>
        {inline.map(inlineAction)}
        {overflow.length > 0 && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className={BUTTON_CLASS} aria-label={t("workspace.project.moreActions")}>
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" /><span className="max-[600px]:sr-only">{t("workspace.project.more")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[14rem]">{overflow.map(menuItem)}</DropdownMenuContent>
          </DropdownMenu>
        )}
        {inline.includes("share") ? null : <VercelShare key={project.id} projectId={project.id} projectType={project.type} open={shareOpen} onOpenChange={setShareOpen} hideTrigger />}
        <ExportMenu projectId={project.id} projectType={project.type} projectOptionsJson={project.options_json} qualityGate={qualityGate} onOpenQuality={onOpenQuality} {...(platformFix === undefined ? {} : { platformFix })} />
      </div>
      </div>
      {tabsSlot && <div className="relative h-10 min-w-0 overflow-hidden border-t border-border bg-muted/20 max-[900px]:h-11">{tabsSlot}</div>}
      <ProjectInstructionsDialog projectId={project.id} open={instructionsOpen} onOpenChange={setInstructionsOpen} />
      <FigmaImportDialog
        projectId={project.id}
        artifactRevision={artifactRevision}
        artifactDigest={artifactDigest}
        open={figmaImportOpen}
        onOpenChange={setFigmaImportOpen}
        onImported={onFigmaImported}
      />
    </header>
  );
}

function stripInternalProjectTag(name: string): string {
  return name.replace(/^\[burnguard:[^\]]+\]\s*/, "");
}
