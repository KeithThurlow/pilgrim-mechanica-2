// The sword's swish (Keith 2026-11-01, round 6: "swing arcs ... communicate a little more like speed"): a ribbon swept
// by the blade, from part way up it to the tip, through the poses of the last `swordSwishLife` s. Bright at the tip and
// newest, fading inward and with age; additive, so it reads as speed light over the sand. It lives in the hull's frame
// (the arsenal hangs it there and feeds it the blade's poses in that frame, many per frame through a cut, so the arc
// stays smooth however fast the blade goes). The bent air along the arc is blast-wave puffs (src/fx/blastWaves.ts),
// posted by the arsenal. Cosmetic.
import * as THREE from "three/webgpu";

type V = { x: number; y: number; z: number };
interface Sample { ix: number; iy: number; iz: number; ox: number; oy: number; oz: number; t: number }

export class SwordSwish {
  readonly mesh: THREE.Mesh;
  private pts: Sample[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private geo: THREE.BufferGeometry;
  private readonly max: number;
  private readonly base = new THREE.Color(0xfff1d6);
  private colour = this.base;
  /** Tint the ribbon (a power cut's colour), or null for the plain light. */
  tint(c: THREE.Color | null) { this.colour = c ?? this.base; }

  constructor(max = 64) {
    this.max = max;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 2 * 3);
    this.col = new Float32Array(max * 2 * 3);
    const idx: number[] = [];
    for (let i = 0; i < max - 1; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, b, d, c); }
    this.geo.setIndex(idx);
    const pa = new THREE.BufferAttribute(this.pos, 3), ca = new THREE.BufferAttribute(this.col, 3);
    pa.setUsage(THREE.DynamicDrawUsage); ca.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("position", pa);
    this.geo.setAttribute("color", ca);
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
  }

  /** The blade at time t (s, the swish's own clock): hand and way in the hull's frame, drawn length, inner share. */
  push(hand: V, fwd: V, len: number, inner: number, t: number) {
    const a = len * inner;
    const s: Sample = { ix: hand.x + fwd.x * a, iy: hand.y + fwd.y * a, iz: hand.z + fwd.z * a, ox: hand.x + fwd.x * len, oy: hand.y + fwd.y * len, oz: hand.z + fwd.z * len, t };
    // Skip a sample right on top of the last (the blade at rest or stalled in a body).
    const l = this.pts[0];
    if (l && Math.hypot(l.ox - s.ox, l.oy - s.oy, l.oz - s.oz) < 0.04) { l.t = t; return; }
    this.pts.unshift(s);
    if (this.pts.length > this.max) this.pts.length = this.max;
  }

  clear() { this.pts.length = 0; this.mesh.visible = false; this.geo.setDrawRange(0, 0); }

  /** Rebuild for now (t), dropping samples older than life; gain scales the light (0 hides it). */
  update(t: number, life: number, gain: number) {
    while (this.pts.length && t - this.pts[this.pts.length - 1].t > life) this.pts.pop();
    const n = this.pts.length;
    if (n < 2 || gain <= 0 || life <= 0) { this.mesh.visible = false; this.geo.setDrawRange(0, 0); return; }
    const c = this.colour;
    for (let i = 0; i < n; i++) {
      const s = this.pts[i], age = Math.max(0, Math.min(1, (t - s.t) / life));
      // Bright when new and at the tip; the oldest end of the arc thins away.
      const k = (1 - age) * (1 - age) * gain;
      const o = i * 6;
      this.pos[o] = s.ix; this.pos[o + 1] = s.iy; this.pos[o + 2] = s.iz;
      this.pos[o + 3] = s.ox; this.pos[o + 4] = s.oy; this.pos[o + 5] = s.oz;
      const ki = k * 0.08, ko = k * 0.75;
      this.col[o] = c.r * ki; this.col[o + 1] = c.g * ki; this.col[o + 2] = c.b * ki;
      this.col[o + 3] = c.r * ko; this.col[o + 4] = c.g * ko; this.col[o + 5] = c.b * ko;
    }
    (this.geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    this.geo.setDrawRange(0, (n - 1) * 6);
    this.mesh.visible = true;
  }
}
