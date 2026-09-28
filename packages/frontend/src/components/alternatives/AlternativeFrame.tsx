import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { VisualAlternativeSummary } from "@bg/shared";
import { authorizedFetch } from "@/api/client";
import { buildSandboxedArtifactSrcDoc } from "@/components/canvas/frame-bridge";
import { embedCanvasImages } from "@/lib/canvas-images";
import { hydrateCanvasCharts } from "@/lib/canvas-charts";
import {
  compareViewport,
  type CompareViewport,
} from "@/lib/visual-alternative-compare";
import { useT } from "@/i18n/t";

export default function AlternativeFrame({
  alternative,
  viewport,
}: {
  readonly alternative: VisualAlternativeSummary;
  readonly viewport: CompareViewport;
}) {
  const t = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [document, setDocument] = useState<{
    readonly source: string;
    readonly srcDoc: string;
  } | null>(null);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const source = alternative.entrypoint_url;
  const srcDoc = document?.source === source ? document.srcDoc : null;
  const failed = failedSource === source;
  const size = compareViewport(viewport);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setScale(entry.contentRect.width / size.width);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [size.width]);
  useEffect(() => {
    void loadAttempt;
    if (source === null) return;
    const controller = new AbortController();
    setFailedSource(null);
    void authorizedFetch(source, {
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    })
      .then((response) => {
        if (!response.ok) throw new Error("alternative_load_failed");
        return response.text();
      })
      .then((html) =>
        embedCanvasImages(
          html,
          new URL(source, window.location.href).href,
          controller.signal,
        )
      )
      .then(hydrateCanvasCharts)
      .then((html) => {
        if (!controller.signal.aborted) {
          setDocument({
            source,
            srcDoc: buildSandboxedArtifactSrcDoc(
              html,
              new URL(source, window.location.href).href,
            ),
          });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && error instanceof Error) {
          setFailedSource(source);
        }
      });
    return () => controller.abort();
  }, [loadAttempt, source]);
  return (
    <div
      ref={hostRef}
      className="relative overflow-hidden bg-muted"
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
    >
      {failed ? (
        <div className="grid h-full place-items-center gap-2 p-4 text-center text-xs text-muted-foreground">
          <span>{t("workspace.alternatives.loadFailed")}</span>
          <button
            type="button"
            className="min-h-11 rounded-md bg-secondary px-3 font-medium text-secondary-foreground"
            onClick={() => setLoadAttempt((value) => value + 1)}
          >
            {t("workspace.alternatives.retry")}
          </button>
        </div>
      ) : srcDoc === null ? (
        <div className="grid h-full place-items-center text-xs text-muted-foreground">
          {t("workspace.alternatives.loading")}
        </div>
      ) : (
        <iframe
          title={alternative.name}
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          style={{
            width: size.width,
            height: size.height,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        />
      )}
    </div>
  );
}
