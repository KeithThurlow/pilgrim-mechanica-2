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
  /** URL flags shared by every lab: ?webgl, ?auto, ?shot, ?seed=N, ?norender */
  params: URLSearchParams;
  /** A PNG data URL of the next rendered frame (taken right after it renders, before the canvas clears). */
  capture(): Promise<string>;
  /** The last frame: its times (ms: the whole frame, the ticks, the render call's CPU submit), draw calls, triangles. */
  last: { frame: number; tick: number; render: number; calls: number; tris: number };
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
  let prev = performance.now(), time = 0;
  const last = { frame: 0, tick: 0, render: 0, calls: 0, tris: 0 };
  const noRender = params.has("norender");
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const raw = (now - prev) / 1000;
    prev = now;
    const dt = Math.min(raw, 1 / 20);
    time += dt;
    const t0 = performance.now();
    for (const t of ticks) t(dt, time);
    const t1 = performance.now();
    // ?norender: run the ticks without drawing (headless CPU measurements, e.g. the stress lab on a software GPU).
    if (!noRender) renderer.render(scene, camera);
    const t2 = performance.now();
    if (captures.length) {
      let url = "";
      try { url = renderer.domElement.toDataURL("image/png"); } catch { /* tainted or lost: send without */ }
      for (const c of captures.splice(0)) c(url);
    }
    last.frame = raw * 1000; last.tick = t1 - t0; last.render = t2 - t1;
    last.calls = renderer.info.render.drawCalls; last.tris = renderer.info.render.triangles;
    hud.frame(raw * 1000, renderer.info.render.drawCalls, renderer.info.render.triangles, t1 - t0, t2 - t1);
  });

  const app: App = {
    renderer, scene, camera, hud, backend, params, last,
    onTick: (fn) => ticks.push(fn),
    capture: () => new Promise<string>((res) => captures.push(res)),
  };
  // For agents' probes in a headless browser (scene contents, triangle counts): window.__app.
  (window as unknown as { __app: App }).__app = app;
  return app;
}
