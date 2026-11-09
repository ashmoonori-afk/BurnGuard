import { useLayoutEffect, useState } from "react";
import type { AppScreensManifest } from "@bg/shared";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { projectFileUrl } from "@/api/files";
import { appScreenPosition, appScreenScale, appScreenTarget, stepAppScreen } from "@/lib/app-screens";
import { useT } from "@/i18n/t";
import ScreenPreview from "./ScreenPreview";
import "./app-screens.css";

type Props = {
  readonly projectId: string;
  readonly manifest: AppScreensManifest;
  readonly file: string | null;
  readonly revision: string;
  readonly opener: HTMLElement | null;
  readonly onFile: (file: string | null) => void;
};

export default function PlayOverlay({ projectId, manifest, file, revision, opener, onFile }: Props) {
  const t = useT();
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const position = file === null ? null : appScreenPosition(manifest, file);
  useLayoutEffect(() => {
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBounds({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stage]);
  const current = position?.section.screens[position.index];
  const previous = file === null ? null : stepAppScreen(manifest, file, -1);
  const next = file === null ? null : stepAppScreen(manifest, file, 1);
  return <Dialog open={position !== null} onOpenChange={(open) => { if (!open) onFile(null); }}>
    <DialogContent hideClose aria-describedby={undefined} className="app-screens-play flex h-[calc(100dvh-3rem)] max-w-[calc(100vw-3rem)] flex-col gap-4 overflow-hidden p-4"
      overlayClassName="app-screens-play"
      onCloseAutoFocus={(event) => { event.preventDefault(); opener?.focus(); }}>
      <header className="flex shrink-0 items-center gap-4">
        <DialogTitle className="min-w-0 flex-1 truncate text-base" title={position?.section.name}>
          {position && t("appScreens.position", { section: position.section.id === "screens" && position.section.name === "Screens" ? t("appScreens.screens") : position.section.name, current: position.index + 1, total: position.section.screens.length })}
        </DialogTitle>
        <Button variant="outline" className="h-8" onClick={() => onFile(null)}>{t("appScreens.close")}</Button>
      </header>
      <div ref={setStage} className="grid min-h-0 flex-1 place-items-center overflow-hidden rounded-control bg-muted">
        {current && bounds.width > 0 && bounds.height > 0 && <ScreenPreview key={current.file} projectId={projectId}
          file={current.file} title={current.title} frame={manifest.frame} scale={appScreenScale(manifest.frame, bounds)} revision={revision} interactive
          onDismiss={() => onFile(null)}
          onNavigate={(href) => {
            const target = appScreenTarget(href, new URL(projectFileUrl(projectId, current.file), window.location.href).href, manifest);
            if (target !== null) onFile(target);
          }} />}
      </div>
      <footer className="flex shrink-0 justify-center gap-3">
        <Button variant="outline" className="h-8" disabled={previous === null} onClick={() => { if (previous !== null) onFile(previous); }}>{t("appScreens.previous")}</Button>
        <Button variant="outline" className="h-8" disabled={next === null} onClick={() => { if (next !== null) onFile(next); }}>{t("appScreens.next")}</Button>
      </footer>
    </DialogContent>
  </Dialog>;
}
