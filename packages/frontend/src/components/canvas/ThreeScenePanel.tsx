import { useT, type MessageKey } from "@/i18n/t";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_THREE_SCENE, parseThreeScene, type ThreeObjectV1, type ThreeSceneDocumentV1, type ThreeSceneV1, type ThreeShape } from "@bg/shared";
import { apiFetch } from "@/api/client";
import { mountThreeScene } from "./three-scene-runtime";

const SHAPE_COPY = { cube: "canvas.three.cube", sphere: "canvas.three.sphere", torus: "canvas.three.torus" } as const satisfies Record<ThreeShape, MessageKey>;
const FIELD_COPY = { position: "canvas.three.position", rotation: "canvas.three.rotation", scale: "canvas.three.scale" } as const satisfies Record<"position" | "rotation" | "scale", MessageKey>;

export default function ThreeScenePanel({ projectId, relPath, disabled, onSaved, onRequestAI }: { projectId: string; relPath: string; disabled: boolean; onSaved: () => void; onRequestAI: (text: string) => Promise<void> }) {
  const t = useT();
  const [document, setDocument] = useState<ThreeSceneDocumentV1 | null>(null);
  const [scene, setScene] = useState<ThreeSceneV1>(DEFAULT_THREE_SCENE);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MessageKey | "">("");
  const [status, setStatus] = useState<MessageKey | "">("");
  const [request, setRequest] = useState("");
  const [reload, setReload] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<ReturnType<typeof mountThreeScene> | null>(null);
  const url = `/api/projects/${projectId}/three-scene?path=${encodeURIComponent(relPath)}`;

  useEffect(() => {
    const controller = new AbortController();
    setDocument(null); setError("");
    void apiFetch<ThreeSceneDocumentV1>(url, { signal: controller.signal }).then((value) => {
      if (controller.signal.aborted) return;
      if (value.schema_version !== 1 || !Number.isSafeInteger(value.revision) || !/^[0-9a-f]{64}$/.test(value.artifact_digest) || !/^[0-9a-f]{64}$/.test(value.file_hash)) throw new Error("invalid_scene_identity");
      const next = value.scene === null ? DEFAULT_THREE_SCENE : parseThreeScene(value.scene);
      setDocument(value); setScene(next); setSelected(next.objects[0]?.id ?? null);
    }).catch(() => { if (!controller.signal.aborted) setError("canvas.three.loadFailed"); });
    return () => controller.abort();
  }, [url, reload]);

  useEffect(() => {
    if (!hostRef.current) return;
    try { previewRef.current = mountThreeScene(hostRef.current, DEFAULT_THREE_SCENE, setSelected); }
    catch { setError("canvas.three.webglUnavailable"); }
    return () => { previewRef.current?.dispose(); previewRef.current = null; };
  }, []);
  useEffect(() => { previewRef.current?.update(scene); }, [scene]);

  const item = scene.objects.find((object) => object.id === selected);
  const edit = (patch: Partial<ThreeObjectV1>) => setScene((current) => ({ ...current, objects: current.objects.map((object) => object.id === selected ? { ...object, ...patch } : object) }));
  const add = (shape: ThreeShape) => {
    if (scene.objects.length >= 16) return;
    const id = `object_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    setScene((current) => ({ ...current, objects: [...current.objects, { id, shape, color: "#3366ff", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }] }));
    setSelected(id); setStatus("");
  };
  const save = async () => {
    if (!document) throw new Error("scene_not_loaded");
    const next = parseThreeScene(scene);
    await apiFetch(url, { method: "PUT", body: JSON.stringify({ scene: next, expected_revision: document.revision, expected_artifact_digest: document.artifact_digest, expected_file_hash: document.file_hash }) });
    setStatus("canvas.three.saved"); onSaved(); setReload((value) => value + 1);
  };
  const busy = disabled || pending || !document;
  return <section aria-label={t("canvas.three.editor")} className="flex max-h-[50vh] min-h-64 shrink-0 gap-3 overflow-y-auto border-t border-border bg-background p-3 max-[700px]:flex-col">
    <div className="min-w-0 flex-1">
      <div className="text-xs font-semibold">{t("canvas.three.title")}{" "}{relPath}</div>
      <div ref={hostRef} className="mt-2 h-56 min-w-48 overflow-hidden rounded border border-border" />
      <p className="mt-1 text-[10px] text-muted-foreground">{t("canvas.three.controls")}</p>
    </div>
    <div className="w-64 shrink-0 space-y-2 text-xs max-[700px]:w-full">
      <div className="flex gap-2">{(["cube", "sphere", "torus"] as const).map((shape) => <button key={shape} type="button" disabled={busy || scene.objects.length >= 16} className="rounded border px-2 py-1 disabled:opacity-50" onClick={() => add(shape)}>{t(SHAPE_COPY[shape])} +</button>)}</div>
      <label className="flex items-center gap-2">{t("canvas.three.object")}{" "}<select className="min-w-0 flex-1 rounded border bg-background" value={selected ?? ""} onChange={(event) => setSelected(event.target.value || null)}><option value="">{t("canvas.three.noSelection")}</option>{scene.objects.map((object, index) => <option key={object.id} value={object.id}>{index + 1}. {t(SHAPE_COPY[object.shape])}</option>)}</select></label>
      <label className="flex items-center gap-2">{t("canvas.three.background")}{" "}<input aria-label={t("canvas.three.backgroundColor")} type="color" disabled={busy} value={scene.background} onChange={(event) => setScene({ ...scene, background: event.target.value })} /></label>
      {item && <>
        <label className="flex items-center gap-2">{t("canvas.color")}{" "}<input aria-label={t("canvas.three.objectColor")} type="color" disabled={busy} value={item.color} onChange={(event) => edit({ color: event.target.value })} /></label>
        {(["position", "rotation", "scale"] as const).map((field) => <div key={field}><span>{t(FIELD_COPY[field])}</span><div className="flex gap-1">{([0, 1, 2] as const).map((axis) => <label className="flex min-w-0 flex-1 items-center gap-1" key={axis}><span>{"XYZ"[axis]}</span><input className="w-full min-w-0 rounded border bg-background px-1" aria-label={t("canvas.three.axis", { field: t(FIELD_COPY[field]), axis: "XYZ"[axis]! })} type="number" disabled={busy} min={field === "scale" ? 0.1 : field === "rotation" ? -360 : -50} max={field === "scale" ? 10 : field === "rotation" ? 360 : 50} step={field === "rotation" ? 5 : 0.1} value={item[field][axis]} onChange={(event) => { const value = event.currentTarget.valueAsNumber; if (!Number.isFinite(value) || !event.currentTarget.validity.valid) return; const vector: [number, number, number] = [...item[field]]; vector[axis] = value; edit({ [field]: vector }); }} /></label>)}</div></div>)}
        <button type="button" disabled={busy} className="text-destructive underline" onClick={() => { setScene({ ...scene, objects: scene.objects.filter((object) => object.id !== selected) }); setSelected(null); }}>{t("canvas.three.deleteObject")}</button>
      </>}
      <div className="flex gap-2"><button type="button" disabled={busy} className="rounded border px-2 py-1 disabled:opacity-50" onClick={async () => { setPending(true); setError(""); try { await save(); } catch { setError("canvas.three.saveFailed"); } finally { setPending(false); } }}>{t("canvas.three.save")}</button><button type="button" disabled={pending} className="underline" onClick={() => setReload((value) => value + 1)}>{t("canvas.reloadSaved")}</button></div>
      <label className="block">{t("canvas.three.aiRequest")}<input className="mt-1 w-full rounded border bg-background p-1" value={request} onChange={(event) => setRequest(event.target.value)} placeholder={t("canvas.three.aiPlaceholder")} /></label>
      <button type="button" disabled={busy || !request.trim()} className="rounded border px-2 py-1 disabled:opacity-50" onClick={async () => { setPending(true); setError(""); try { await save(); await onRequestAI(`파일 ${JSON.stringify(relPath)}의 data-bg-three 관리형 3D 장면을 다음 요청에 맞게 수정해 주세요. ThreeSceneV1 계약을 유지하고 변경 결과를 설명해 주세요.\n${request.trim()}`); } catch { setError("canvas.three.aiFailed"); } finally { setPending(false); } }}>{t("canvas.three.saveAndRequest")}</button>
      {error && <p role="alert" className="text-destructive">{t(error)}</p>}{status && <p role="status">{t(status)}</p>}
    </div>
  </section>;
}
