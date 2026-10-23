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
