import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDefaultPalette, emitPaletteCss, paletteShareFragment, parsePaletteShareFragment, parsePaletteState,
  redoPalette, serializePalette, transitionPalette, undoPalette,
  type DesignSystemPaletteResponse, type PaletteHistory, type PaletteState,
} from "@bg/shared/palette";
import { UpgradeContractError } from "@bg/shared/contract-parser";
import { ApiError } from "@/api/client";
import { getDesignSystemPalette, saveDesignSystemPalette } from "@/api/design-system-palette";
import PaletteEditor, { type PaletteEditorProps } from "@/components/systems/PaletteEditor";
import { usePaletteEditorText } from "@/components/systems/palette-editor-text";
import { Button } from "@/components/ui/button";
import { useT, type MessageKey } from "@/i18n/t";

type Status = { readonly tone: "info" | "success" | "error"; readonly key: MessageKey } | null;

function initialDraft(saved: PaletteState | null): { readonly history: PaletteHistory; readonly status: Status } {
  let present = saved ?? createDefaultPalette();
  let status: Status = null;
  if (window.location.hash.startsWith("#bg-palette=")) {
    try {
      present = parsePaletteShareFragment(window.location.hash);
      status = { tone: "info", key: "palette.sharedDraft" };
    } catch (error) {
      if (!(error instanceof UpgradeContractError) && !(error instanceof SyntaxError)) throw error;
      status = { tone: "error", key: "palette.shareInvalid" };
    }
  }
  return { history: { past: [], present, future: [] }, status };
}

export default function DesignSystemPalettePanel({ systemId }: { readonly systemId: string }) {
  const t = useT();
  const query = useQuery({
    queryKey: ["design-systems", "palette", systemId],
    queryFn: () => getDesignSystemPalette(systemId),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
  });
  return <section id="system-palette" className="my-5 min-w-0 scroll-mt-6">
    <div className="mb-4">
      <h2 className="text-lg font-semibold">{t("palette.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("palette.help")}</p>
    </div>
    {query.isPending || query.isFetching
      ? <p role="status">{t("palette.loading")}</p>
      : query.isError || query.data === undefined
        ? <div role="alert" className="space-y-3">
          <p>{t("palette.loadFailed")}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>{t("palette.retry")}</Button>
        </div>
        : <PaletteWorkspace systemId={systemId} saved={query.data} reload={() => void query.refetch()} />}
  </section>;
}

function PaletteWorkspace({
  systemId, saved, reload,
}: {
  readonly systemId: string;
  readonly saved: DesignSystemPaletteResponse;
  readonly reload: () => void;
}) {
  const t = useT();
  const text = usePaletteEditorText();
  const client = useQueryClient();
  const [initial] = useState(() => initialDraft(saved.state));
  const [history, setHistory] = useState(initial.history);
  const [preview, setPreview] = useState<PaletteState | null>(null);
  const [status, setStatus] = useState<Status>(initial.status);
  const [conflicted, setConflicted] = useState(false);
  useEffect(() => {
    if (window.location.hash.startsWith("#bg-palette=")) {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
  }, []);
  const draft = preview ?? history.present;
  const dirty = saved.state === null || serializePalette(draft) !== serializePalette(saved.state);
  const save = useMutation({
    mutationFn: (state: PaletteState) => saveDesignSystemPalette(systemId, { expected_digest: saved.expected_digest, state }),
    onSuccess: (response) => {
      client.setQueryData(["design-systems", "palette", systemId], response);
      setConflicted(false);
      setStatus({ tone: "success", key: "palette.stateSaved" });
    },
    onError: (error) => {
      const stale = error instanceof ApiError && error.code === "expected_digest_conflict";
      setConflicted(stale);
      setStatus({ tone: "error", key: stale ? "palette.conflict" : "palette.saveFailed" });
    },
  });
  const change: PaletteEditorProps["onChange"] = (next, phase) => {
    if (phase === "preview") setPreview(next);
    else {
      setPreview(null);
      setHistory(current => transitionPalette(current, next));
    }
    if (!conflicted) setStatus(null);
  };
  const download = (format: "json" | "css") => {
    const bytes = format === "json" ? serializePalette(draft) : emitPaletteCss(draft);
    const url = URL.createObjectURL(new Blob([bytes], { type: format === "json" ? "application/json" : "text/css" }));
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `palette.${format}`;
      anchor.click();
    } finally { URL.revokeObjectURL(url); }
  };
  const copyLink = async () => {
    const url = new URL(window.location.pathname, window.location.origin);
    url.hash = paletteShareFragment(draft);
    try {
      await navigator.clipboard.writeText(url.href);
      setStatus({ tone: "success", key: "palette.linkCopied" });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setStatus({ tone: "error", key: "palette.copyFailed" });
    }
  };
  return <>
    {saved.state === null && status === null
      ? <p className="mb-3 text-sm text-muted-foreground">{t("palette.previewOnly")}</p> : null}
    {conflicted ? <div className="mb-3 space-y-2 rounded-control border border-border p-3">
      <p className="text-sm">{t("palette.reloadHelp")}</p>
      <Button variant="outline" disabled={save.isPending} data-palette-action="reload" onClick={reload}>{t("palette.reload")}</Button>
    </div> : null}
    <PaletteEditor
      state={draft} text={text} dirty={dirty} saving={save.isPending}
      saved={saved.state !== null && !dirty} unavailable={conflicted}
      canUndo={history.past.length > 0} canRedo={history.future.length > 0}
      status={status === null ? null : { tone: status.tone, message: t(status.key) }}
      onGestureStart={() => setPreview(null)} onGestureCancel={() => setPreview(null)}
      onChange={change}
      onSave={() => { if (dirty && !save.isPending && !conflicted) save.mutate(draft); }}
      onUndo={() => { setPreview(null); setHistory(undoPalette); }}
      onRedo={() => { setPreview(null); setHistory(redoPalette); }}
      onReset={() => change(createDefaultPalette(), "commit")}
      onImport={json => change(parsePaletteState(json), "commit")}
      onExport={download} onCopyLink={() => void copyLink()}
    />
  </>;
}
