import { useEffect, useRef, useState } from "react";
import { DEFAULT_THREE_SCENE, parseThreeScene, type ThreeObjectV1, type ThreeSceneDocumentV1, type ThreeSceneV1, type ThreeShape } from "@bg/shared";
import { apiFetch } from "@/api/client";
import { mountThreeScene } from "./three-scene-runtime";

export default function ThreeScenePanel({ projectId, relPath, disabled, onSaved, onRequestAI }: { projectId: string; relPath: string; disabled: boolean; onSaved: () => void; onRequestAI: (text: string) => Promise<void> }) {
  const [document, setDocument] = useState<ThreeSceneDocumentV1 | null>(null);
  const [scene, setScene] = useState<ThreeSceneV1>(DEFAULT_THREE_SCENE);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
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
    }).catch(() => { if (!controller.signal.aborted) setError("3D 장면을 불러오지 못했어요. 파일을 새로고침하고 다시 시도해 주세요."); });
    return () => controller.abort();
  }, [url, reload]);

  useEffect(() => {
    if (!hostRef.current) return;
    try { previewRef.current = mountThreeScene(hostRef.current, DEFAULT_THREE_SCENE, setSelected); }
    catch { setError("WebGL을 사용할 수 없어요. 브라우저의 하드웨어 가속을 확인해 주세요."); }
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
    setStatus("3D 장면을 HTML에 저장했어요. 실행 취소로 되돌릴 수 있어요."); onSaved(); setReload((value) => value + 1);
  };
  const busy = disabled || pending || !document;
  return <section aria-label="3D 장면 편집기" className="flex max-h-[50vh] min-h-64 shrink-0 gap-3 overflow-y-auto border-t border-border bg-background p-3 max-[700px]:flex-col">
    <div className="min-w-0 flex-1">
      <div className="text-xs font-semibold">기본 3D 장면 · {relPath}</div>
      <div ref={hostRef} className="mt-2 h-56 min-w-48 overflow-hidden rounded border border-border" />
      <p className="mt-1 text-[10px] text-muted-foreground">드래그로 카메라 회전 · 휠로 거리 조절 · 오브젝트를 클릭해 선택해요.</p>
    </div>
    <div className="w-64 shrink-0 space-y-2 text-xs max-[700px]:w-full">
      <div className="flex gap-2">{(["cube", "sphere", "torus"] as const).map((shape) => <button key={shape} type="button" disabled={busy || scene.objects.length >= 16} className="rounded border px-2 py-1 disabled:opacity-50" onClick={() => add(shape)}>{({ cube: "큐브", sphere: "구", torus: "도넛" })[shape]} +</button>)}</div>
      <label className="flex items-center gap-2">오브젝트 <select className="min-w-0 flex-1 rounded border bg-background" value={selected ?? ""} onChange={(event) => setSelected(event.target.value || null)}><option value="">선택 없음</option>{scene.objects.map((object, index) => <option key={object.id} value={object.id}>{index + 1}. {object.shape}</option>)}</select></label>
      <label className="flex items-center gap-2">배경 <input aria-label="3D 배경색" type="color" disabled={busy} value={scene.background} onChange={(event) => setScene({ ...scene, background: event.target.value })} /></label>
      {item && <>
        <label className="flex items-center gap-2">색상 <input aria-label="3D 오브젝트 색상" type="color" disabled={busy} value={item.color} onChange={(event) => edit({ color: event.target.value })} /></label>
        {(["position", "rotation", "scale"] as const).map((field) => <div key={field}><span>{({ position: "위치", rotation: "회전(도)", scale: "크기" })[field]}</span><div className="flex gap-1">{([0, 1, 2] as const).map((axis) => <label className="flex min-w-0 flex-1 items-center gap-1" key={axis}><span>{"XYZ"[axis]}</span><input className="w-full min-w-0 rounded border bg-background px-1" aria-label={`3D ${field} ${"XYZ"[axis]}`} type="number" disabled={busy} min={field === "scale" ? 0.1 : field === "rotation" ? -360 : -50} max={field === "scale" ? 10 : field === "rotation" ? 360 : 50} step={field === "rotation" ? 5 : 0.1} value={item[field][axis]} onChange={(event) => { const value = event.currentTarget.valueAsNumber; if (!Number.isFinite(value) || !event.currentTarget.validity.valid) return; const vector: [number, number, number] = [...item[field]]; vector[axis] = value; edit({ [field]: vector }); }} /></label>)}</div></div>)}
        <button type="button" disabled={busy} className="text-destructive underline" onClick={() => { setScene({ ...scene, objects: scene.objects.filter((object) => object.id !== selected) }); setSelected(null); }}>선택 오브젝트 삭제</button>
      </>}
      <div className="flex gap-2"><button type="button" disabled={busy} className="rounded border px-2 py-1 disabled:opacity-50" onClick={async () => { setPending(true); setError(""); try { await save(); } catch { setError("저장하지 못했어요. 다른 변경이 있다면 저장본을 다시 불러온 뒤 수정해 주세요."); } finally { setPending(false); } }}>HTML에 저장</button><button type="button" disabled={pending} className="underline" onClick={() => setReload((value) => value + 1)}>저장본 다시 불러오기</button></div>
      <label className="block">AI에 3D 수정 요청<input className="mt-1 w-full rounded border bg-background p-1" value={request} onChange={(event) => setRequest(event.target.value)} placeholder="파란 구 3개를 나란히 배치해 주세요" /></label>
      <button type="button" disabled={busy || !request.trim()} className="rounded border px-2 py-1 disabled:opacity-50" onClick={async () => { setPending(true); setError(""); try { await save(); await onRequestAI(`파일 ${JSON.stringify(relPath)}의 data-bg-three 관리형 3D 장면을 다음 요청에 맞게 수정해 주세요. ThreeSceneV1 계약을 유지하고 변경 결과를 설명해 주세요.\n${request.trim()}`); } catch { setError("AI 요청을 완료하지 못했어요. 저장된 장면과 대화 상태를 확인해 주세요."); } finally { setPending(false); } }}>장면 저장 후 AI에 요청</button>
      {error && <p role="alert" className="text-destructive">{error}</p>}{status && <p role="status">{status}</p>}
    </div>
  </section>;
}
