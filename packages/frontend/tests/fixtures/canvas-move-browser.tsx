import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import TweaksLayer, { tweaksTargetFromHit, type TweakApplyOptions, type TweaksLayerActions, type TweaksStyleKey, type TweaksTarget } from "../../src/components/canvas/TweaksLayer";
import { buildSandboxedArtifactSrcDoc, requestFrameBgAtPoint, requestFrameRectForBgId } from "../../src/components/canvas/frame-bridge";
import { PositionSection } from "../../src/components/modes/TweaksPanel";
import { moveRefusal, type AlignMode, type MoveRefusal } from "../../src/lib/element-geometry";

type Patch = Partial<Record<TweaksStyleKey, string | null>>;
interface Box { x: number; y: number; width: number; height: number }

declare global {
  var canvasMoveTest: {
    mount(zoom: number): Promise<void>;
    /** Starts listening for the next redraw of the Move surface and for the next save. Call it before the action. */
    arm(): void;
    /** Where the Move surface was drawn at the redraw after `arm`. */
    preview(): Promise<Box>;
    /** The styles of the save after `arm`, once the saved page is on screen again. */
    saved(): Promise<Patch>;
    /** How many saves the overlay has asked for since the page was mounted. */
    saves(): number;
    /** What the canvas would select at this point of the frame, and whether the move tools refuse it. */
    refusalAt(x: number, y: number): Promise<{ tag: string; refusal: MoveRefusal | null } | null>;
    align(mode: AlignMode): void;
    /** How many saves were refused because the file was no longer at the revision their identity named. */
    stale(): number;
    /**
     * Presses Align and, before the frame can answer its measurement, lets another save land on the selected element.
     * Resolves with the file once Align's own save has been refused.
     */
    alignWhileFileChanges(mode: AlignMode): Promise<string>;
    /** Whether the canvas kept what the frame answered for a point and for a node. */
    answersAt(x: number, y: number, bgId: string): Promise<{ hit: boolean; rect: boolean }>;
  };
}

const WAIT_MS = 5000;
const container = document.getElementById("root");
if (!container) throw new Error("canvas_move_root_missing");
const root = createRoot(container);
const actions: { current: TweaksLayerActions | null } = { current: null };
let saves = 0;
let stale = 0;
let revision = 0;
let selectedId: string | null = null;
let onStale: (() => void) | null = null;
const readIdentity = async () => ({ expected_revision: revision, expected_artifact_digest: "digest", expected_file_hash: "hash", node_fingerprint: "node" });
let frame: HTMLIFrameElement | null = null;
let onLoad: (() => void) | null = null;
let onSaved: ((patch: Patch) => void) | null = null;
let armed: { preview: Promise<Box>; saved: Promise<Patch> } | null = null;

/** A promise that rejects by name when its signal never comes. */
function awaited<T>(name: string, subscribe: (resolve: (value: T) => void) => () => void): Promise<T> {
  const result = new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => { stop(); reject(new Error(`${name}_timeout`)); }, WAIT_MS);
    const stop = subscribe((value) => { window.clearTimeout(timer); stop(); resolve(value); });
  });
  result.catch(() => undefined);
  return result;
}

function Harness({ html, zoom }: { html: string; zoom: number }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [page, setPage] = useState({ html, version: 0 });
  const [target, setTarget] = useState<TweaksTarget | null>(null);
  const [pending, setPending] = useState<Patch | null>(null);
  selectedId = target?.bg_id ?? null;
  // The canvas does the same: it saves, then shows the saved file and the styles it now carries. Like the backend, it
  // refuses a save whose identity names an older revision of the file.
  const apply = (patch: Patch, options?: TweakApplyOptions) => {
    if (!target) return;
    saves += 1;
    setPending(patch);
    void (options?.identity ?? readIdentity())
      .then((identity) => {
        if (identity.expected_revision !== revision) return null;
        revision += 1;
        return fetch("/save", { method: "POST", body: JSON.stringify({ node_bg_id: target.bg_id, styles: patch }) }).then((response) => response.text());
      })
      .then((saved) => {
        if (saved === null) {
          stale += 1;
          setPending(null);
          onStale?.();
          return;
        }
        const inline = { ...target.inline };
        for (const key of Object.keys(patch) as TweaksStyleKey[]) {
          const value = patch[key];
          if (value == null) delete inline[key]; else inline[key] = value;
        }
        setTarget({ ...target, inline });
        setPage((current) => ({ html: saved, version: current.version + 1 }));
      });
  };
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: `scale(${zoom})`, transformOrigin: "0 0" }}>
        <iframe ref={(element) => { iframeRef.current = element; frame = element; }} key={page.version} title="canvas" sandbox="allow-scripts" className="absolute inset-0 h-full w-full border-0 bg-background"
          srcDoc={buildSandboxedArtifactSrcDoc(page.html, new URL("/page.html", window.location.href).toString())}
          onLoad={() => {
            onLoad?.();
            if (pending === null) return;
            setPending(null);
            onSaved?.(pending);
          }} />
        <TweaksLayer active iframeRef={iframeRef} selectedBgId={target?.bg_id ?? null} target={target} saving={pending !== null}
          onSelect={setTarget} onApply={apply} zoom={zoom} magnet={false}
          readIdentity={readIdentity}
          actionsRef={actions} />
      </div>
      {target && <aside style={{ position: "absolute", right: 0, bottom: 0, width: 320, pointerEvents: "none" }}>
        <PositionSection target={target} moving={null} saving={pending !== null} onApply={apply} />
      </aside>}
    </div>
  );
}

globalThis.canvasMoveTest = {
  async mount(zoom) {
    const html = await (await fetch("/document")).text();
    const loaded = awaited<void>("canvas_move_load", (resolve) => { onLoad = () => resolve(); return () => { onLoad = null; }; });
    flushSync(() => root.render(<Harness html={html} zoom={zoom} />));
    await loaded;
  },
  arm() {
    const surface = document.querySelector("[data-canvas-move]");
    const box = surface?.parentElement;
    if (!surface || !box) throw new Error("canvas_move_surface_missing");
    armed = {
      preview: awaited<Box>("canvas_move_preview", (resolve) => {
        const observer = new MutationObserver(() => {
          const rect = surface.getBoundingClientRect();
          resolve({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        });
        observer.observe(box, { attributes: true, attributeFilter: ["style"] });
        return () => observer.disconnect();
      }),
      saved: awaited<Patch>("canvas_move_save", (resolve) => { onSaved = resolve; return () => { onSaved = null; }; }),
    };
  },
  preview: () => armed?.preview ?? Promise.reject(new Error("canvas_move_not_armed")),
  saved: () => armed?.saved ?? Promise.reject(new Error("canvas_move_not_armed")),
  saves: () => saves,
  async refusalAt(x, y) {
    const target = tweaksTargetFromHit(await requestFrameBgAtPoint(frame, x, y));
    return target && { tag: target.tag, refusal: moveRefusal(target) };
  },
  align(mode) {
    if (!actions.current) throw new Error("canvas_move_actions_missing");
    actions.current.align(mode);
  },
  stale: () => stale,
  async alignWhileFileChanges(mode) {
    if (!actions.current || selectedId === null) throw new Error("canvas_move_actions_missing");
    const refused = awaited<void>("canvas_move_stale", (resolve) => { onStale = () => resolve(); return () => { onStale = null; }; });
    actions.current.align(mode);
    // Still the task of the press: the frame's measurement cannot have come back yet.
    revision += 1;
    await fetch("/save", { method: "POST", body: JSON.stringify({ node_bg_id: selectedId, styles: { translate: "99px 0px" } }) });
    await refused;
    return (await fetch("/document")).text();
  },
  async answersAt(x, y, bgId) {
    const [hit, rect] = await Promise.all([requestFrameBgAtPoint(frame, x, y), requestFrameRectForBgId(frame, bgId)]);
    return { hit: hit !== null, rect: rect !== null };
  },
};
