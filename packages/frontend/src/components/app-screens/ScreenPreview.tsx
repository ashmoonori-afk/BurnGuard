import { useLayoutEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AppScreenFrame } from "@bg/shared";
import { projectFileUrl, readProjectFileText } from "@/api/files";
import { embedCanvasImages } from "@/lib/canvas-images";
import { hydrateCanvasCharts } from "@/lib/canvas-charts";
import { buildSandboxedArtifactSrcDoc, subscribeFrameEvent } from "@/components/canvas/frame-bridge";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/t";

type Props = {
  readonly projectId: string;
  readonly file: string;
  readonly title: string;
  readonly frame: AppScreenFrame;
  readonly scale: number;
  readonly revision: string;
  readonly interactive?: boolean;
  readonly onNavigate?: (href: string) => void;
  readonly onDismiss?: () => void;
  readonly onLinks?: (hrefs: readonly string[]) => void;
};

export default function ScreenPreview(props: Props) {
  const t = useT();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const url = new URL(projectFileUrl(props.projectId, props.file), window.location.href).href;
  const documentKey = JSON.stringify([url, props.revision]);
  const query = useQuery({
    queryKey: ["app-screen-preview", props.projectId, props.file, props.revision],
    queryFn: async ({ signal }) => {
      const html = await readProjectFileText(props.projectId, props.file, signal);
      const doc = new DOMParser().parseFromString(html, "text/html");
      const hrefs = Array.from(doc.querySelectorAll("a[href]"), (link) => link.getAttribute("href") ?? "");
      const embedded = await hydrateCanvasCharts(await embedCanvasImages(html, url, signal));
      return { hrefs, srcDoc: buildSandboxedArtifactSrcDoc(embedded, url, { presentationKey: documentKey }) };
    },
    retry: false,
    staleTime: Infinity,
  });
  useLayoutEffect(() => {
    if (query.data) props.onLinks?.(query.data.hrefs);
  }, [query.data, props.onLinks]);
  useLayoutEffect(() => {
    if (!props.interactive) return;
    const unsubscribe = subscribeFrameEvent(iframeRef.current, "navigate", (payload) => {
      props.onNavigate?.(payload?.href);
    });
    const dismiss = subscribeFrameEvent(iframeRef.current, "present-dismiss", (payload) => {
      if (payload?.documentKey === documentKey) props.onDismiss?.();
    });
    return () => { unsubscribe(); dismiss(); };
  }, [query.data, documentKey, props.interactive, props.onNavigate, props.onDismiss]);
  return <div className="relative shrink-0 overflow-hidden rounded-control border border-border bg-background"
    style={{ width: props.frame.width * props.scale, height: props.frame.height * props.scale }}>
    {query.data && <iframe ref={iframeRef} title={props.title} srcDoc={query.data.srcDoc}
      sandbox="allow-scripts" referrerPolicy="no-referrer" tabIndex={props.interactive ? 0 : -1}
      className={props.interactive ? "absolute left-0 top-0 border-0" : "pointer-events-none absolute left-0 top-0 border-0"}
      style={{ width: props.frame.width, height: props.frame.height, transform: `scale(${props.scale})`, transformOrigin: "0 0" }} />}
    {!query.data && <div className="grid h-full place-content-center gap-3 p-4 text-center text-sm text-muted-foreground" role={query.isError ? "alert" : "status"}>
      <p>{t(query.isError ? "appScreens.loadError" : "appScreens.loading")}</p>
      {query.isError && <Button variant="outline" className="relative z-10" onClick={() => void query.refetch()}>{t("appScreens.retry")}</Button>}
    </div>}
  </div>;
}
