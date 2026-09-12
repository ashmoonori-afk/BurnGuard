import { t } from "@/i18n/t";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { parseThreeScene, type ThreeSceneV1 } from "@bg/shared";
import { useLocaleStore } from "@/i18n/locale";

export function mountThreeScene(host: HTMLElement, initial: ThreeSceneV1, onSelect?: (id: string | null) => void) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.style.cssText = "width:100%;height:100%;display:block;touch-action:none";
  const updateLabel = () => renderer.domElement.setAttribute("aria-label", t("canvas.three.canvasLabel"));
  updateLabel();
  const unsubscribeLocale = useLocaleStore.subscribe(updateLabel);
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  camera.position.set(6, 5, 8);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.minDistance = 1; controls.maxDistance = 150;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 3));
  const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(4, 8, 5); scene.add(light);
  const group = new THREE.Group(); scene.add(group);
  const render = () => renderer.render(scene, camera);
  const disposeObjects = () => { for (const child of [...group.children]) { const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>; mesh.geometry.dispose(); mesh.material.dispose(); group.remove(mesh); } };
  const update = (value: ThreeSceneV1) => {
    const config = parseThreeScene(value);
    disposeObjects(); scene.background = new THREE.Color(config.background);
    for (const item of config.objects) {
      const geometry = item.shape === "cube" ? new THREE.BoxGeometry(1, 1, 1) : item.shape === "sphere" ? new THREE.SphereGeometry(0.65, 32, 24) : new THREE.TorusGeometry(0.6, 0.22, 16, 48);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: item.color, roughness: 0.45, metalness: 0.1 }));
      mesh.name = item.id; mesh.position.fromArray(item.position); mesh.rotation.set(...item.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]); mesh.scale.fromArray(item.scale); group.add(mesh);
    }
    render();
  };
  const resize = () => { const width = Math.max(1, host.clientWidth); const height = Math.max(1, host.clientHeight); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); render(); };
  const observer = new ResizeObserver(resize); observer.observe(host);
  const raycaster = new THREE.Raycaster();
  let down: { x: number; y: number } | null = null;
  const pointerDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY }; };
  const pointerUp = (event: PointerEvent) => {
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    onSelect?.(raycaster.intersectObjects(group.children)[0]?.object.name ?? null); down = null;
  };
  renderer.domElement.addEventListener("pointerdown", pointerDown);
  renderer.domElement.addEventListener("pointerup", pointerUp);
  controls.addEventListener("change", render);
  update(initial); resize();
  return { update, dispose() { unsubscribeLocale(); observer.disconnect(); controls.removeEventListener("change", render); controls.dispose(); disposeObjects(); renderer.domElement.removeEventListener("pointerdown", pointerDown); renderer.domElement.removeEventListener("pointerup", pointerUp); renderer.dispose(); renderer.domElement.remove(); } };
}

function boot() {
  document.querySelectorAll<HTMLElement>("[data-bg-three]").forEach((host) => {
    const config = host.querySelector('script[data-bg-three-config]');
    if (!config) return;
    try { mountThreeScene(host, parseThreeScene(JSON.parse(config.textContent || ""))); }
    catch { const error = document.createElement("p"); error.textContent = t("canvas.three.renderFailed"); error.setAttribute("role", "alert"); host.append(error); }
  });
}
if (typeof document !== "undefined") { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot(); }
