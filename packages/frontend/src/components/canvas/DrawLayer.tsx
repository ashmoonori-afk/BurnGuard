import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent,
} from "react";

export type DrawTool = "pen" | "rect" | "arrow";

export interface PenShape {
  type: "pen";
  points: Array<[number, number]>;
  stroke: string;
  strokeWidth: number;
}
export interface RectShape {
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string;
  strokeWidth: number;
}
export interface ArrowShape {
  type: "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
}
export type DrawShape = PenShape | RectShape | ArrowShape;

export interface DrawLayerHandle {
  undo: () => void;
  redo: () => void;
  clear: () => void;
}

/**
 * SVG overlay for Draw mode. Shapes live in React state so undo/redo
 * + live preview are cheap; the parent receives `onCommit(shapes)` each
 * time a shape is finalized so it can PUT the serialized svg to the
 * backend. Pointer capture is enabled only while `active`, so the
 * iframe below still receives events in other modes.
 */
const DrawLayer = forwardRef<
  DrawLayerHandle,
  {
    active: boolean;
    tool: DrawTool;
    color: string;
    strokeWidth: number;
    initialShapes: DrawShape[];
    resetKey: string;
    onCommit: (shapes: DrawShape[]) => void;
  }
>(function DrawLayer(
  { active, tool, color, strokeWidth, initialShapes, resetKey, onCommit },
  ref,
) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [shapes, setShapes] = useState<DrawShape[]>(initialShapes);
  const [draft, setDraft] = useState<DrawShape | null>(null);
  const shapesRef = useRef(initialShapes);
  const draftRef = useRef<DrawShape | null>(null);
  const loadedResetKeyRef = useRef(resetKey);
  const redoStackRef = useRef<DrawShape[]>([]);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (loadedResetKeyRef.current === resetKey) return;
    loadedResetKeyRef.current = resetKey;
    shapesRef.current = initialShapes;
    setShapes(initialShapes);
    redoStackRef.current = [];
    draftRef.current = null;
    draggingRef.current = false;
    setDraft(null);
  }, [initialShapes, resetKey]);

  // Event handlers publish once. React may replay state updaters in StrictMode.
  const commit = (next: DrawShape[]) => {
    shapesRef.current = next;
    setShapes(next);
    onCommit(next);
  };

  const updateDraft = (next: DrawShape | null) => {
    draftRef.current = next;
    setDraft(next);
  };

  useImperativeHandle(
    ref,
    () => ({
      undo: () => {
        if (shapesRef.current.length === 0) return;
        const copy = shapesRef.current.slice();
        redoStackRef.current.push(copy.pop()!);
        commit(copy);
      },
      redo: () => {
        const next = redoStackRef.current.pop();
        if (!next) return;
        commit([...shapesRef.current, next]);
      },
      clear: () => {
        if (shapesRef.current.length === 0) return;
        redoStackRef.current = [];
        commit([]);
      },
    }),
    [onCommit],
  );

  const localPoint = (e: PointerEvent<SVGSVGElement>): [number, number] | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const handlePointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!active) return;
    if (e.button !== 0) return;
    const pt = localPoint(e);
    if (!pt) return;
    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    draggingRef.current = true;
    if (tool === "pen") {
      updateDraft({ type: "pen", points: [pt], stroke: color, strokeWidth });
    } else if (tool === "rect") {
      updateDraft({
        type: "rect",
        x: pt[0],
        y: pt[1],
        w: 0,
        h: 0,
        stroke: color,
        strokeWidth,
      });
    } else {
      updateDraft({
        type: "arrow",
        x1: pt[0],
        y1: pt[1],
        x2: pt[0],
        y2: pt[1],
        stroke: color,
        strokeWidth,
      });
    }
  };

  const handlePointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return;
    const pt = localPoint(e);
    if (!pt) return;
    const current = draftRef.current;
    if (!current) return;
    if (current.type === "pen") {
      updateDraft({ ...current, points: [...current.points, pt] });
    } else if (current.type === "rect") {
      updateDraft({ ...current, w: pt[0] - current.x, h: pt[1] - current.y });
    } else {
      updateDraft({ ...current, x2: pt[0], y2: pt[1] });
    }
  };

  const handlePointerUp = (e: PointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try {
      (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    const current = draftRef.current;
    updateDraft(null);
    if (!current || !active) return;
    const triviallySmall =
      (current.type === "rect" && Math.abs(current.w) < 4 && Math.abs(current.h) < 4) ||
      (current.type === "arrow" &&
        Math.abs(current.x2 - current.x1) < 4 &&
        Math.abs(current.y2 - current.y1) < 4) ||
      (current.type === "pen" && current.points.length < 2);
    if (triviallySmall) return;
    const normalized = normalize(current);
    redoStackRef.current = [];
    commit([...shapesRef.current, normalized]);
  };

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 h-full w-full"
      style={{
        pointerEvents: active ? "auto" : "none",
        cursor: active ? "crosshair" : "default",
        touchAction: "none",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        draggingRef.current = false;
        updateDraft(null);
      }}
    >
      {shapes.map((shape, i) => renderShape(shape, `s-${i}`))}
      {draft && renderShape(draft, "draft")}
    </svg>
  );
});

export default DrawLayer;

function normalize(shape: DrawShape): DrawShape {
  if (shape.type === "rect") {
    return {
      ...shape,
      x: shape.w < 0 ? shape.x + shape.w : shape.x,
      y: shape.h < 0 ? shape.y + shape.h : shape.y,
      w: Math.abs(shape.w),
      h: Math.abs(shape.h),
    };
  }
  return shape;
}

function renderShape(shape: DrawShape, key: string) {
  if (shape.type === "pen") {
    const d = shape.points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`)
      .join(" ");
    return (
      <path
        key={key}
        d={d}
        fill="none"
        stroke={shape.stroke}
        strokeWidth={shape.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }
  if (shape.type === "rect") {
    return (
      <rect
        key={key}
        x={shape.x}
        y={shape.y}
        width={Math.max(1, shape.w)}
        height={Math.max(1, shape.h)}
        fill="none"
        stroke={shape.stroke}
        strokeWidth={shape.strokeWidth}
      />
    );
  }
  // arrow
  const headSize = 10 + shape.strokeWidth * 2;
  const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
  const hx1 = shape.x2 - headSize * Math.cos(angle - Math.PI / 7);
  const hy1 = shape.y2 - headSize * Math.sin(angle - Math.PI / 7);
  const hx2 = shape.x2 - headSize * Math.cos(angle + Math.PI / 7);
  const hy2 = shape.y2 - headSize * Math.sin(angle + Math.PI / 7);
  return (
    <g key={key} stroke={shape.stroke} strokeWidth={shape.strokeWidth} fill={shape.stroke}>
      <line
        x1={shape.x1}
        y1={shape.y1}
        x2={shape.x2}
        y2={shape.y2}
        strokeLinecap="round"
      />
      <polygon points={`${shape.x2},${shape.y2} ${hx1},${hy1} ${hx2},${hy2}`} />
    </g>
  );
}

/**
 * Serialize a shape list to an SVG string that round-trips through
 * `deserializeDraws`. Each shape carries `data-shape` + `data-payload`
 * (JSON) so the deserializer can reconstruct the original geometry
 * without interpreting arbitrary SVG.
 */
export function serializeDraws(width: number, height: number, shapes: DrawShape[]): string {
  const safeW = Math.max(1, Math.floor(width));
  const safeH = Math.max(1, Math.floor(height));
  const bodies = shapes
    .map((shape) => {
      const payload = JSON.stringify(shape).replace(/"/g, "&quot;");
      return `<g data-shape="${shape.type}" data-payload="${payload}">${renderShapeToString(shape)}</g>`;
    })
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${safeW} ${safeH}" width="${safeW}" height="${safeH}">${bodies}</svg>`
  );
}

function renderShapeToString(shape: DrawShape): string {
  if (shape.type === "pen") {
    const d = shape.points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`)
      .join(" ");
    return `<path d="${d}" fill="none" stroke="${shape.stroke}" stroke-width="${shape.strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />`;
  }
  if (shape.type === "rect") {
    return `<rect x="${shape.x}" y="${shape.y}" width="${Math.max(1, shape.w)}" height="${Math.max(1, shape.h)}" fill="none" stroke="${shape.stroke}" stroke-width="${shape.strokeWidth}" />`;
  }
  const headSize = 10 + shape.strokeWidth * 2;
  const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
  const hx1 = shape.x2 - headSize * Math.cos(angle - Math.PI / 7);
  const hy1 = shape.y2 - headSize * Math.sin(angle - Math.PI / 7);
  const hx2 = shape.x2 - headSize * Math.cos(angle + Math.PI / 7);
  const hy2 = shape.y2 - headSize * Math.sin(angle + Math.PI / 7);
  return (
    `<g stroke="${shape.stroke}" stroke-width="${shape.strokeWidth}" fill="${shape.stroke}">` +
    `<line x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" stroke-linecap="round" />` +
    `<polygon points="${shape.x2},${shape.y2} ${hx1},${hy1} ${hx2},${hy2}" />` +
    `</g>`
  );
}

export function deserializeDraws(svg: string): DrawShape[] {
  if (!svg) return [];
  try {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const nodes = doc.querySelectorAll("[data-shape][data-payload]");
    const out: DrawShape[] = [];
    nodes.forEach((node) => {
      const raw = node.getAttribute("data-payload");
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as DrawShape;
        if (
          parsed &&
          (parsed.type === "pen" || parsed.type === "rect" || parsed.type === "arrow")
        ) {
          out.push(parsed);
        }
      } catch {
        // skip malformed entry
      }
    });
    return out;
  } catch {
    return [];
  }
}
