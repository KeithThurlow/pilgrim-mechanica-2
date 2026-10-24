// Input helpers: WASD / arrows relative to the camera, and click or tap on the ground (a click that isn't a drag).
import * as THREE from "three/webgpu";

export class Keys {
  private down = new Set<string>();
  constructor() {
    addEventListener("keydown", (e) => { if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) this.down.add(e.code); });
    addEventListener("keyup", (e) => this.down.delete(e.code));
    addEventListener("blur", () => this.down.clear());
  }
  has(code: string) { return this.down.has(code); }

  /** Stick from WASD / arrows in world x/z, relative to where the camera looks. Zero when nothing is held. */
  move(camera: THREE.Camera, out = new THREE.Vector3()) {
    const f = (this.has("KeyW") || this.has("ArrowUp") ? 1 : 0) - (this.has("KeyS") || this.has("ArrowDown") ? 1 : 0);
    const r = (this.has("KeyD") || this.has("ArrowRight") ? 1 : 0) - (this.has("KeyA") || this.has("ArrowLeft") ? 1 : 0);
    out.set(0, 0, 0);
    if (!f && !r) return out;
    const fw = new THREE.Vector3();
    camera.getWorldDirection(fw);
    fw.y = 0;
    fw.normalize();
    const right = new THREE.Vector3().crossVectors(fw, new THREE.Vector3(0, 1, 0));
    out.addScaledVector(fw, f).addScaledVector(right, r);
    if (out.lengthSq() > 1) out.normalize();
    return out;
  }
  get sprint() { return this.has("ShiftLeft") || this.has("ShiftRight"); }
}

/** Calls back with the ground point under a click or tap that wasn't a drag (orbit drags still work). */
export function onGroundTap(canvas: HTMLCanvasElement, camera: THREE.Camera, ground: THREE.Object3D, cb: (p: THREE.Vector3) => void) {
  let sx = 0, sy = 0, t = 0;
  const ray = new THREE.Raycaster();
  canvas.addEventListener("pointerdown", (e) => { sx = e.clientX; sy = e.clientY; t = performance.now(); });
  canvas.addEventListener("pointerup", (e) => {
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > 6 || performance.now() - t > 400) return;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObject(ground, true)[0];
    if (hit) cb(hit.point);
  });
}
