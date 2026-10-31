// Headless check of the baked bandit (public/models/bandit-vat.*, written by tools/mixamo/bake-bandit.ts) and its
// clip playback (src/combat/banditAnim.ts). Must never happen: feet off or through the ground, vertices jumping
// between frames (an exploded retarget or a bad loop seam), triangles stretched or crushed far past their size in the aim pose (a
// few at the shoulders and elbows do at full swing: linear skinning; under half a percent),
// the rifle bending, the rifle clips aiming anywhere but forward (+Z), a crossfade that never ends.
import { readFileSync } from "node:fs";
import * as THREE from "three";
import type { VatHeader } from "../src/combat/banditVatFormat";
import { VAT_CLIPS } from "../src/combat/banditVatFormat";
import { BanditAnim, type AnimClip } from "../src/combat/banditAnim";

const h = JSON.parse(readFileSync("public/models/bandit-vat.json", "utf8")) as VatHeader;
const buf = readFileSync("public/models/bandit-vat.bin");
const bin = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const V = h.vertices, F = h.frames, T = h.triangles;
const half = new Uint16Array(bin, h.offsets.pos, V * F * 4);
const oct = new Uint8Array(bin, h.offsets.normal, V * F * 2);
const index = new Uint16Array(bin, h.offsets.index, T * 3);
const RIFLE = 216, rifle0 = V - RIFLE; // six boxes, 36 vertices each, last in the vertex list
const fail: string[] = [];
const must = (ok: boolean, msg: string) => { if (!ok) fail.push(msg); };

const pos = (f: number, v: number, out: THREE.Vector3) => {
  const o = (f * V + v) * 4;
  return out.set(THREE.DataUtils.fromHalfFloat(half[o]), THREE.DataUtils.fromHalfFloat(half[o + 1]), THREE.DataUtils.fromHalfFloat(half[o + 2]));
};
const nrm = (f: number, v: number, out: THREE.Vector3) => {
  const o = (f * V + v) * 2;
  const x = (oct[o] / 255) * 2 - 1, y = (oct[o + 1] / 255) * 2 - 1, z = 1 - Math.abs(x) - Math.abs(y), t = Math.max(-z, 0);
  return out.set(x - Math.sign(x) * t, y - Math.sign(y) * t, z).normalize();
};

must(T >= 1500 && T <= 3200, `triangles ${T} outside 1500..3200`);
must(VAT_CLIPS.every((c) => h.clips[c]), "a clip the drawer needs is missing");
must(Object.values(h.clips).reduce((s, c) => s + c.frames, 0) === F, "clip frames don't add up to the texture");
must(h.height > 1.7 && h.height < 1.95, `height ${h.height} m`);

const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3();
const restLen = new Float32Array(T * 3);
const rest = h.clips.aim.start;
for (let t = 0; t < T * 3; t++) {
  const i0 = index[t], i1 = index[t - (t % 3) + ((t + 1) % 3)];
  restLen[t] = pos(rest, i0, a).distanceTo(pos(rest, i1, b));
}

for (const [name, clip] of Object.entries(h.clips)) {
  let minFoot = Infinity, maxFoot = -Infinity, jump = 0, worstEdge = 1, bad = 0, edges = 0, rifleBend = 0, outward = 0, nCount = 0;
  let aimFwd = Infinity;
  for (let k = 0; k < clip.frames; k++) {
    const f = clip.start + k;
    let lo = Infinity;
    for (let v = 0; v < rifle0; v++) lo = Math.min(lo, pos(f, v, a).y);
    minFoot = Math.min(minFoot, lo); maxFoot = Math.max(maxFoot, lo);
    // Frame to frame (and across the loop seam).
    const next = k + 1 < clip.frames ? f + 1 : clip.loop ? clip.start : -1;
    if (next >= 0) for (let v = 0; v < V; v++) jump = Math.max(jump, pos(f, v, a).distanceTo(pos(next, v, b)));
    // Triangle edges against the rest pose: the body may squash a little at the joints, the rifle not at all.
    for (let t = 0; t < T * 3; t++) {
      const i0 = index[t], i1 = index[t - (t % 3) + ((t + 1) % 3)];
      if (restLen[t] < 1e-3) continue;
      const r = pos(f, i0, a).distanceTo(pos(f, i1, b)) / restLen[t];
      // The rifle: absolute (half floats hold about a millimetre at a metre out, so short edges wobble in ratio).
      if (i0 >= rifle0) { rifleBend = Math.max(rifleBend, Math.abs(r - 1) * restLen[t]); continue; }
      edges++;
      if (r < 0.4 || r > 2.2) bad++;
      worstEdge = Math.max(worstEdge, r, 1 / r);
    }
    // Normals belong to this frame: they match the faces round each vertex (the source's winding faces out).
    const fn = new Float32Array(V * 3);
    for (let t = 0; t < T; t++) {
      const i0 = index[t * 3], i1 = index[t * 3 + 1], i2 = index[t * 3 + 2];
      pos(f, i0, a); pos(f, i1, b).sub(a); pos(f, i2, c).sub(a); b.cross(c);
      for (const i of [i0, i1, i2]) { fn[i * 3] += b.x; fn[i * 3 + 1] += b.y; fn[i * 3 + 2] += b.z; }
    }
    for (let v = 0; v < V; v++) {
      c.fromArray(fn, v * 3);
      if (c.lengthSq() < 1e-12) continue;
      nCount++;
      if (nrm(f, v, b).dot(c.normalize()) > 0.7) outward++;
    }
    // The rifle: barrel (box 3) ahead of the stock (box 4).
    const cen = (box: number) => { d.set(0, 0, 0); for (let v = 0; v < 36; v++) d.add(pos(f, rifle0 + box * 36 + v, a)); return d.divideScalar(36).clone(); };
    const axis = cen(2).sub(cen(3)).normalize();
    aimFwd = Math.min(aimFwd, axis.z);
  }
  const share = bad / Math.max(1, edges);
  const out = outward / Math.max(1, nCount);
  console.log(`${name.padEnd(8)} ${String(clip.frames).padStart(3)} frames, ${clip.speed.toFixed(2)} m/s: lowest point ${minFoot.toFixed(3)}..${maxFoot.toFixed(3)} m, ` +
    `max jump ${jump.toFixed(3)} m/frame, worst edge ×${worstEdge.toFixed(2)} (${(share * 100).toFixed(2)}% past 0.4..2.2), rifle bend ${(rifleBend * 1000).toFixed(1)} mm, ` +
    `normals match faces ${(out * 100).toFixed(0)}%, rifle forward ${aimFwd.toFixed(2)}`);
  // The dive roll (Keith 2026-10-31) leaves the ground in the dive and tucks the shoulder into the sand as it rolls:
  // looser bounds, and a fast tumble moves vertices further per frame.
  const roll = name === "roll";
  must(minFoot > (roll ? -0.25 : -0.06), `${name}: a foot ${minFoot.toFixed(3)} m through the ground`);
  must(maxFoot < (roll ? 0.4 : 0.1), `${name}: both feet ${maxFoot.toFixed(3)} m off the ground`);
  must(jump < (roll ? 0.6 : 0.4), `${name}: a vertex jumps ${jump.toFixed(2)} m in one frame`);
  must(share < 0.005, `${name}: ${(share * 100).toFixed(2)}% of edges stretched or crushed`);
  must(rifleBend < 0.005, `${name}: the rifle bends ${(rifleBend * 1000).toFixed(1)} mm`);
  must(out > 0.9, `${name}: only ${(out * 100).toFixed(0)}% of normals match their faces`);
  if (name !== "sprint" && name !== "flinch" && name !== "roll") must(aimFwd > 0.5, `${name}: the rifle points ${aimFwd.toFixed(2)} along +Z`);
}

// Playback: rows wrap inside the clip, crossfades finish, the cycle phase carries between moving loops.
const clips: AnimClip[] = VAT_CLIPS.map((n) => ({ ...h.clips[n], cycle: n !== "aim" && n !== "flinch" && n !== "roll" }));
must(!!h.clips.roll && h.clips.roll.frames > 20 && !h.clips.roll.loop, "the dive roll clip is missing from the bake");
const anim = new BanditAnim(clips, 4), rows = new Float32Array(8);
const run = VAT_CLIPS.indexOf("run"), sprint = VAT_CLIPS.indexOf("sprint"), aim = VAT_CLIPS.indexOf("aim"), flinch = VAT_CLIPS.indexOf("flinch");
anim.reset(0, run, 0);
for (let k = 0; k < 500; k++) {
  anim.play(0, k < 250 ? run : aim, k < 120 ? 1.4 : -0.8);
  anim.step(0, 1 / 60, 0.2);
  anim.rows(0, rows, 0);
  const c0 = clips[anim.clip[0]];
  must(rows[0] >= c0.start && rows[0] < c0.start + c0.frames && rows[1] >= c0.start && rows[1] < c0.start + c0.frames, `rows ${rows[0]},${rows[1]} outside the clip`);
  must(rows[2] >= 0 && rows[2] < 1, "between-frame weight outside 0..1");
}
must(rows[3] === 0, `crossfade never finished (${rows[3]})`);
anim.reset(1, run, h.clips.run.duration * 0.25);
anim.play(1, sprint, 1);
must(Math.abs(anim.t[1] / h.clips.sprint.duration - 0.25) < 1e-4, "phase not carried from run to sprint");
anim.play(1, flinch, 1, true);
anim.step(1, 0.05, 0.2); anim.rows(1, rows, 0);
must(rows[3] > 0.5 && anim.t[1] < 0.06, "a restarted flinch doesn't start from its beginning with the old clip still showing");
for (let k = 0; k < 100; k++) anim.step(1, 1 / 60, 0.2);
anim.rows(1, rows, 0);
must(rows[0] === h.clips.flinch.start + h.clips.flinch.frames - 1 && anim.left(1) < 0, "the flinch doesn't hold its last frame");

console.log(`bandit bake: ${V} vertices, ${T} triangles, ${F} frames (${(buf.byteLength / 1024).toFixed(0)} KB)`);
if (fail.length) { console.error("FAIL\n  " + fail.join("\n  ")); process.exit(1); }
console.log("bandit-vat-check: OK");
