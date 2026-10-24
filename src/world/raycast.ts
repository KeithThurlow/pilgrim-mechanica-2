// Ray against the ground height function: march, then bisect. Exact on any streamed or unstreamed ground and
// far cheaper than raycasting chunk triangles.
import * as THREE from "three/webgpu";
import type { Ground } from "../mech/walker";

export function rayGround(origin: THREE.Vector3, dir: THREE.Vector3, ground: Ground, maxDist = 600, out = new THREE.Vector3()): THREE.Vector3 | null {
  const step = 1.5;
  let prevT = 0;
  let prevAbove = origin.y - ground.height(origin.x, origin.z);
  if (prevAbove < 0) return null;
  for (let t = step; t <= maxDist; t += step) {
    const y = origin.y + dir.y * t, x = origin.x + dir.x * t, z = origin.z + dir.z * t;
    const above = y - ground.height(x, z);
    if (above <= 0) {
      let lo = prevT, hi = t;
      for (let i = 0; i < 12; i++) {
        const m = (lo + hi) / 2;
        const a = origin.y + dir.y * m - ground.height(origin.x + dir.x * m, origin.z + dir.z * m);
        if (a > 0) lo = m; else hi = m;
      }
      return out.copy(origin).addScaledVector(dir, hi);
    }
    prevT = t;
    prevAbove = above;
  }
  return null;
}

/** Ground point under a screen position (client pixels) for this camera. */
export function screenToGround(cx: number, cy: number, canvas: HTMLCanvasElement, camera: THREE.Camera, ground: Ground, out = new THREE.Vector3()) {
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  return rayGround(ray.ray.origin, ray.ray.direction, ground, 600, out);
}

/**
 * How much sun reaches a point past the dunes (1 lit .. 0 behind a dune): march toward the sun and see how close the
 * sand comes to the ray, with a soft metre either side. For effects that can't read the shadow map cheaply.
 */
export function sunReach(ground: Ground, x: number, y: number, z: number, sunDir: { x: number; y: number; z: number }): number {
  let clear = 2;
  for (let t = 2; t <= 80; t += t < 20 ? 2 : 4) {
    clear = Math.min(clear, y + sunDir.y * t - ground.height(x + sunDir.x * t, z + sunDir.z * t));
    if (clear < -1) break;
  }
  return Math.min(1, Math.max(0, (clear + 1) / 2));
}
