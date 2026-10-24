// One renderer, scene, camera and loop for every lab and, later, the game.
// WebGPU first; Three.js falls back to WebGL 2 by itself. ?webgl in the URL forces WebGL (used by headless shots).
import * as THREE from "three/webgpu";
import { FrameHud } from "./hud";

export type Tick = (dt: number, time: number) => void;

export interface App {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  hud: FrameHud;
  backend: "WebGPU" | "WebGL2";
  /** Called every frame before rendering. dt is clamped so a stalled tab never explodes a sim. */
  onTick(fn: Tick): void;
  /** URL flags shared by every lab: ?webgl, ?auto, ?shot, ?seed=N */
  params: URLSearchParams;
  /** A PNG data URL of the next rendered frame (taken right after it renders, before the canvas clears). */
  capture(): Promise<string>;
}

export async function createApp(container: HTMLElement): Promise<App> {
  const params = new URLSearchParams(location.search);
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: params.has("webgl") });
  await renderer.init();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 2000);
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? "WebGPU" : "WebGL2";
  const hud = new FrameHud(container, backend);

  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(container);
  resize();

  const ticks: Tick[] = [];
  const captures: ((url: string) => void)[] = [];
  let last = performance.now(), time = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const raw = (now - last) / 1000;
    last = now;
    const dt = Math.min(raw, 1 / 20);
    time += dt;
    for (const t of ticks) t(dt, time);
    renderer.render(scene, camera);
    if (captures.length) {
      let url = "";
      try { url = renderer.domElement.toDataURL("image/png"); } catch { /* tainted or lost: send without */ }
      for (const c of captures.splice(0)) c(url);
    }
    hud.frame(raw * 1000, renderer.info.render.drawCalls, renderer.info.render.triangles);
  });

  return {
    renderer, scene, camera, hud, backend, params,
    onTick: (fn) => ticks.push(fn),
    capture: () => new Promise<string>((res) => captures.push(res)),
  };
}
