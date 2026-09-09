export type ThreeShape = "cube" | "sphere" | "torus";
export interface ThreeObjectV1 {
  readonly id: string;
  readonly shape: ThreeShape;
  readonly color: string;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
}
export interface ThreeSceneV1 {
  readonly schema_version: 1;
  readonly background: string;
  readonly objects: readonly ThreeObjectV1[];
}
export interface ThreeSceneDocumentV1 {
  readonly schema_version: 1;
  readonly scene: ThreeSceneV1 | null;
  readonly revision: number;
  readonly artifact_digest: string;
  readonly file_hash: string;
}
export const DEFAULT_THREE_SCENE: ThreeSceneV1 = { schema_version: 1, background: "#eef2f6", objects: [] };

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) throw new Error("invalid_three_scene");
  return value as Record<string, unknown>;
}
function color(value: unknown): string {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error("invalid_three_scene");
  return value.toLowerCase();
}
function vector(value: unknown, min: number, max: number): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || value.some((part: unknown) => typeof part !== "number" || !Number.isFinite(part) || part < min || part > max)) throw new Error("invalid_three_scene");
  return [value[0] as number, value[1] as number, value[2] as number];
}
export function parseThreeScene(value: unknown): ThreeSceneV1 {
  const scene = record(value, ["schema_version", "background", "objects"]);
  if (scene.schema_version !== 1 || !Array.isArray(scene.objects) || scene.objects.length > 16) throw new Error("invalid_three_scene");
  const ids = new Set<string>();
  const objects = scene.objects.map((raw: unknown): ThreeObjectV1 => {
    const item = record(raw, ["id", "shape", "color", "position", "rotation", "scale"]);
    if (typeof item.id !== "string" || !/^[a-zA-Z0-9_-]{1,40}$/.test(item.id) || ids.has(item.id) || !["cube", "sphere", "torus"].includes(String(item.shape))) throw new Error("invalid_three_scene");
    ids.add(item.id);
    return { id: item.id, shape: item.shape as ThreeShape, color: color(item.color), position: vector(item.position, -50, 50), rotation: vector(item.rotation, -360, 360), scale: vector(item.scale, 0.1, 10) };
  });
  return { schema_version: 1, background: color(scene.background), objects };
}
