import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import {
  LOGO_GEOMETRY_FILE,
  compileLogoGeometry,
  logoConstructionProgress,
  logoConstructionTimeline,
  parseLogoGeometryV1,
  renderLogoConstruction,
  type LogoConstructionTheme,
  type LogoGeometryCompiled,
  type LogoGeometryV1,
} from "@bg/shared";
import { readProjectFileText } from "@/api/files";
import { listProjectFiles } from "@/api/project";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/i18n/t";

type View = "design" | "construction";

interface Sheet {
  readonly geometry: LogoGeometryV1;
  readonly compiled: LogoGeometryCompiled;
}

/**
 * The symbol card of a geometric mark (doc/26-logo-construction-2026-11-09.md): the mark itself, or
 * its construction drawn in from the same record. It reads `logo-geometry.json` from the project
 * tree and compiles it in the browser with the shared compiler, so the drawing cannot disagree with
 * the mark. A project without the file (a raster mark) shows nothing.
 */
export default function LogoConstructionCard({ projectId }: { readonly projectId: string }) {
  const t = useT();
  // The project tree listing is shared with the project view, so a turn that rewrites the record
  // changes `version` and the card reads the new file instead of polling for it.
  const files = useQuery({ queryKey: ["project", projectId, "files"], queryFn: () => listProjectFiles(projectId) });
  const entry = files.data?.find((file) => file.rel_path === LOGO_GEOMETRY_FILE);
  const version = entry === undefined ? null : entry.hash ?? String(entry.updated_at ?? 0);
  const sheet = useQuery({
    queryKey: ["projects", projectId, "logo-geometry", version],
    enabled: version !== null,
    retry: false,
    queryFn: async ({ signal }): Promise<Sheet> => {
      const { geometry } = parseLogoGeometryV1(JSON.parse(await readProjectFileText(projectId, LOGO_GEOMETRY_FILE, signal)));
      return { geometry, compiled: compileLogoGeometry(geometry) };
    },
  });
  const [view, setView] = useState<View>("design");
  const [run, setRun] = useState(0);
  if (version === null) return null;

  return (
    <section aria-label={t("logo.construction.title")} className="shrink-0 border-b border-border bg-card px-3 py-3 sm:px-4">
      <Tabs value={view} onValueChange={(next) => { setView(next as View); setRun((value) => value + 1); }} className="flex min-w-0 items-start gap-4">
        <div className="h-48 w-48 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-card">
          {sheet.data ? (
            <>
              <TabsContent value="design" className="m-0 h-full data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-200 motion-reduce:animate-none">
                <svg viewBox="0 0 64 64" role="img" aria-label={t("logo.construction.markLabel")} className="h-full w-full text-foreground">
                  <path d={sheet.data.compiled.path} fill="currentColor" />
                </svg>
              </TabsContent>
              <TabsContent value="construction" className="m-0 h-full data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-200 motion-reduce:animate-none">
                <ConstructionPlayer key={run} sheet={sheet.data} label={t("logo.construction.sheetLabel")} />
              </TabsContent>
            </>
          ) : sheet.isError ? null : <Skeleton className="h-full w-full" />}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h2 className="truncate text-sm font-semibold text-foreground">{t("logo.construction.title")}</h2>
          {sheet.isError ? (
            <p role="alert" className="text-xs leading-5 text-muted-foreground">{t("logo.construction.invalid")}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <TabsList aria-label={t("logo.construction.view")} className="h-auto">
                  <TabsTrigger value="design" className="min-h-11 min-w-20" disabled={!sheet.data}>{t("logo.construction.design")}</TabsTrigger>
                  <TabsTrigger value="construction" className="min-h-11 min-w-20" disabled={!sheet.data}>{t("logo.construction.drawing")}</TabsTrigger>
                </TabsList>
                {view === "construction" ? (
                  <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => setRun((value) => value + 1)}>
                    <RotateCcw aria-hidden="true" />
                    {t("logo.construction.replay")}
                  </Button>
                ) : null}
              </div>
              <p className="text-xs leading-5 text-muted-foreground">{t("logo.construction.hint")}</p>
            </>
          )}
        </div>
      </Tabs>
    </section>
  );
}

/** Plays the draw-in once from the start; a remount (new `key`) replays it. */
function ConstructionPlayer({ sheet, label }: { readonly sheet: Sheet; readonly label: string }) {
  const theme = useDocumentTheme();
  const timeline = useMemo(() => logoConstructionTimeline(sheet.geometry, sheet.compiled), [sheet]);
  const [t, setT] = useState(() => logoConstructionProgress(0, timeline, prefersReducedMotion()));

  useEffect(() => {
    // Reduced motion shows the finished drawing at once; otherwise the clock starts once per mount.
    if (prefersReducedMotion()) { setT(1); return; }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number): void => {
      const next = logoConstructionProgress(now - start, timeline, prefersReducedMotion());
      setT(next);
      if (next < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [timeline]);

  // The SVG text is built from parsed numbers, fixed colours and the escaped label only.
  const svg = useMemo(() => renderLogoConstruction(sheet.geometry, sheet.compiled, t, { theme, label }), [sheet, t, theme, label]);
  return <div data-construction-progress={t} className="h-full w-full [&>svg]:block [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

function useDocumentTheme(): LogoConstructionTheme {
  return useSyncExternalStore(subscribeTheme, () => (document.documentElement.dataset["theme"] === "dark" ? "dark" : "light"));
}
