import { useState } from "react";
import type { AppScreen, AppScreensManifest } from "@bg/shared";
import { Button } from "@/components/ui/button";
import { projectFileUrl } from "@/api/files";
import { appScreenLinks, appScreenScale } from "@/lib/app-screens";
import { useT } from "@/i18n/t";
import { cn } from "@/lib/utils";
import ScreenPreview from "./ScreenPreview";
import PlayOverlay from "./PlayOverlay";

type Props = {
  readonly projectId: string;
  readonly manifest: AppScreensManifest;
  readonly activeFile: string | null;
  readonly revision: string;
  readonly onSelect: (file: string) => void;
};

function ScreenTile({ screen, board, onPlay }: {
  readonly screen: AppScreen;
  readonly board: Props;
  readonly onPlay: (file: string, opener: HTMLElement) => void;
}) {
  const t = useT();
  const [hrefs, setHrefs] = useState<readonly string[]>([]);
  const scale = appScreenScale(board.manifest.frame, { width: 320, height: 420 });
  const links = appScreenLinks(hrefs, new URL(projectFileUrl(board.projectId, screen.file), window.location.href).href, board.manifest);
  const titles = board.manifest.sections.flatMap((section) => section.screens).filter((item) => links.includes(item.file)).map((item) => item.title);
  return <article className="flex shrink-0 flex-col gap-2" style={{ width: board.manifest.frame.width * scale }}>
    <div className="flex min-h-8 items-center gap-2">
      <h3 className="min-w-0 flex-1 truncate text-sm font-medium" title={screen.title}>{screen.title}</h3>
    </div>
    <div className="relative">
      <ScreenPreview projectId={board.projectId} file={screen.file} title={screen.title} frame={board.manifest.frame}
        scale={scale} revision={board.revision} onLinks={setHrefs} />
      <button type="button" aria-label={t("appScreens.edit", { title: screen.title })} aria-pressed={screen.file === board.activeFile}
        onClick={() => board.onSelect(screen.file)}
        className={cn("absolute inset-0 rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          screen.file === board.activeFile ? "ring-2 ring-accent ring-offset-2" : "hover:ring-2 hover:ring-border")} />
    </div>
    <Button variant="outline" className="h-8 w-full" onClick={(event) => onPlay(screen.file, event.currentTarget)}>{t("appScreens.playHere")}</Button>
    <p className="break-words text-xs leading-relaxed text-muted-foreground">{titles.length > 0 ? t("appScreens.links", { titles: titles.join(", ") }) : t("appScreens.noLinks")}</p>
  </article>;
}

export default function Board(props: Props) {
  const t = useT();
  const [playing, setPlaying] = useState<string | null>(null);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  function play(file: string, trigger: HTMLElement) { setOpener(trigger); setPlaying(file); }
  const empty = props.manifest.sections.every((section) => section.screens.length === 0);
  return <>
    <div className="min-h-0 flex-1 overflow-auto bg-muted p-8" aria-label={t("appScreens.board")}>
      {empty ? <p className="text-sm text-muted-foreground">{t("appScreens.empty")}</p> :
        <div className="flex w-max items-start gap-16">
          {props.manifest.sections.map((section) => <section key={section.id} className="space-y-4">
            <header className="flex items-center gap-4">
              <h2 className="max-w-80 truncate text-base font-semibold" title={section.name}>{section.id === "screens" && section.name === "Screens" ? t("appScreens.screens") : section.name}</h2>
              <Button variant="outline" className="h-8" disabled={section.screens.length === 0}
                onClick={(event) => { const first = section.screens[0]; if (first) play(first.file, event.currentTarget); }}>{t("appScreens.playSection")}</Button>
            </header>
            <div className="flex items-start gap-10">{section.screens.map((screen) => <ScreenTile key={screen.file} screen={screen} board={props} onPlay={play} />)}</div>
          </section>)}
        </div>}
    </div>
    <PlayOverlay projectId={props.projectId} manifest={props.manifest} file={playing} revision={props.revision} opener={opener} onFile={setPlaying} />
  </>;
}
