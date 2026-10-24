// Draws a platform's pipe runs (pipes.ts) as one merged mesh: tubes, elbows, bracket straps, flanges, valves and
// junction boxes, in a few weathered tones.
import * as THREE from "three/webgpu";
import { Kit, KIT_MAT } from "./kit";
import { PAL } from "./furniture";
import type { PipeSet, V3 } from "./pipes";

/** Pipes get their own material so hold-V can light them apart from the platform. */
export const PIPE_MAT = KIT_MAT.clone();
const TONES = [0x9a948a, 0x8a4a2a, 0x55504a, 0xb08a3e];

const v = (a: V3) => new THREE.Vector3(a[0], a[1], a[2]);

export function pipesGeometry(set: PipeSet): THREE.BufferGeometry {
  const k = new Kit();
  for (const t of set.tubes) k.between(t.a, t.b, t.r, TONES[t.tone % TONES.length], t.r > 0.15 ? 8 : 6);
  for (const b of set.bits) {
    const az = v(b.axis).normalize(), ax = v(b.across).normalize();
    // Make the across axis square to the run, then the third.
    ax.addScaledVector(az, -ax.dot(az)).normalize();
    const ay = new THREE.Vector3().crossVectors(az, ax);
    if (b.kind === "elbow") {
      k.geo(new THREE.IcosahedronGeometry(b.size, 0), TONES[2], new THREE.Matrix4().makeTranslation(...b.at));
    } else if (b.kind === "bracket") {
      k.oriented([b.w, b.size, 0.09], b.at, ax, ay, az, PAL.dark);
    } else if (b.kind === "flange") {
      const a = v(b.at).addScaledVector(az, -b.w / 2), c = v(b.at).addScaledVector(az, b.w / 2);
      k.between([a.x, a.y, a.z], [c.x, c.y, c.z], b.size, PAL.steel, 8);
    } else if (b.kind === "valve") {
      // Body on the pipe, a stem out from the surface (b.across is the lift axis here), a red handwheel.
      const s = Math.max(0.1, b.size);
      k.oriented([s * 2.6, s * 2.2, s * 3], b.at, ax, ay, az, PAL.steel);
      const lift = v(b.across).normalize();
      const top = v(b.at).addScaledVector(lift, s * 3.2);
      k.between(b.at, [top.x, top.y, top.z], 0.025, PAL.dark, 4);
      const w0 = top.clone().addScaledVector(lift, -0.03), w1 = top.clone().addScaledVector(lift, 0.03);
      k.between([w0.x, w0.y, w0.z], [w1.x, w1.y, w1.z], s * 1.8, PAL.red, 8);
    } else if (b.kind === "box") {
      // A junction box on the wall, its back against it (axis = the wall's normal).
      const n = v(b.axis).normalize(), along = v(b.across).normalize();
      const up = new THREE.Vector3().crossVectors(n, along).normalize();
      // Keep it right-handed with up pointing up: flip both the along and up axes together.
      if (up.y < 0) { up.negate(); along.negate(); }
      const at = v(b.at).addScaledVector(n, -b.size * 0.3);
      k.oriented([b.w, b.size * 2.4, b.size], [at.x, at.y, at.z], along, up, n, PAL.bone);
    }
  }
  return k.build();
}
