// Code stand-ins for docs/asset-list.md W2 and W3 (Keith 2026-10-25, explosives first):
// - mortar-heavy: one huge tube on a shoulder cradle. Barrel hinges up from stowed (20° up, along the hull) to firing
//   (70°); the tube (Recoil, riding Barrel) slides down its cradle 0.3 m on firing. Spring pack, ammo rack, markings.
// - mortar-line: a long low rack of seven short tubes in a fore-aft staircase (rear ones higher, firing over the
//   front ones) that ripple-fire so the shells land in a line. The rack tilts (Barrel); each tube recoils (Tube_n).
// - mortar-shell: the projectile.
// Root at the cradle's foot on the shoulder.
import { Build, Piece, v, X, Y, Z, lathe, loftZ, octRing, plate, boltRow, boltCircle, hazard, chevrons, stencilDigits, prism, ribbedHose, bezier, frame, lightStrip, type V3 } from "../kit";
import { readyLamp } from "./common";
import type { ModelDef } from "../parts";
import type { Section } from "../palette";

const D2R = Math.PI / 180;

/** A mortar shell lying along d with its tail at c: teardrop body, a driving band, a fin boom with fins. */
export function shell(P: Piece, c: V3, d: V3, r: number, len: number, n = 10, body: Section = "secondary") {
  const L = len;
  lathe(P, c, d, [
    [0, 0], [0, r * 0.32], [L * 0.32, r * 0.32], [L * 0.36, r * 0.55], [L * 0.42, r * 0.88], [L * 0.5, r], [L * 0.56, r], [L * 0.58, r * 1.04],
    [L * 0.62, r * 1.04], [L * 0.64, r * 0.98], [L * 0.86, r * 0.62], [L * 0.96, r * 0.24], [L, 0],
  ], body, { n, secs: ["mechanical", "mechanical", "mechanical", body, body, body, "trim", "trim", "trim", body, body, "mechanical"] });
  const [u, w] = frame(d);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2, s = u.clone().multiplyScalar(Math.cos(a)).addScaledVector(w, Math.sin(a));
    plate(P, c.clone().addScaledVector(d, L * 0.15).addScaledVector(s, r * 0.5), d, s, L * 0.24, r * 0.55, r * 0.07, "dark", { bevel: 0, ch: r * 0.1 });
  }
}

/** Heavy mortar on a shoulder cradle. */
export function mortarHeavy(sd: 1 | -1 = -1, seed = 4): ModelDef {
  const B = new Build(seed, 2, sd), P = B.piece("Body"), o = B.out, rd = B.read;
  // The cradle: a battered base block, cheeks rising at the back to the trunnion, a slewing ring underneath.
  lathe(P, v(0, 0, -0.15), Y(), [[0, 0], [0, 0.46], [0.08, 0.46], [0.1, 0.4], [0.12, 0]], "mechanical", { n: 16 });
  boltCircle(P, v(0, 0.1, -0.15), Y(), 0.42, 12, 0.018);
  loftZ(P, [[-0.95, octRing(0.5, 0.14, 0.05, 0.06, 0.02)], [0.55, octRing(0.5, 0.14, 0.05, 0.06, 0.02)], [0.75, octRing(0.42, 0.1, 0.05, 0.08, 0.02)]], "plating", { y0: 0.24 });
  const piv = v(0, 0.62, -0.55);
  for (const s of [1, -1]) {
    loftZ(P, [[-0.9, octRing(0.06, 0.28, 0.06), 0.62], [-0.25, octRing(0.06, 0.2, 0.06), 0.52], [0.05, octRing(0.05, 0.08, 0.04), 0.42]], "plating", { x0: s * 0.44 });
    lathe(P, v(s * 0.44, piv.y, piv.z), v(s, 0, 0), [[0, 0], [0, 0.15], [0.08, 0.15], [0.1, 0.11], [0.12, 0.11], [0.12, 0]], "mechanical", { n: 12 });
    boltCircle(P, v(s * 0.5, piv.y, piv.z), v(s, 0, 0), 0.1, 6, 0.014);
  }
  plate(P, v(sd * 0.505, 0.24, -0.2), rd.clone().negate(), Y(), 1.1, 0.22, 0.03, "secondary", { bevel: 0.012 });
  stencilDigits(P, v(sd * 0.54, 0.24, -0.25), rd, Y(), 0.15, "120");
  hazard(P, v(0, 0.385, 0.62), X().negate(), Z(), 0.8, 0.16, 8, "trim", "dark");
  chevrons(P, v(0, 0.385, 0.25), Z(), X(), 0.4, 0.18, 3, "trim");
  // Ammo rack on the outboard side: three shells standing in a frame.
  for (let i = 0; i < 3; i++) {
    const z = -0.6 + i * 0.32, x = sd * 0.68;
    shell(P, v(x, 0.12, z), Y(), 0.12, 0.62, 10);
    lathe(P, v(x, 0.1, z), Y(), [[0, 0.135], [0, 0.155], [0.08, 0.155], [0.08, 0.135]], "dark", { n: 10, ring: true });
  }
  prism(P, v(sd * 0.68, 0.06, -0.85), v(sd * 0.68, 0.06, 0.15), octRing(0.17, 0.05, 0.02), "dark");
  prism(P, v(sd * 0.55, 0.12, -0.6), v(sd * 0.55, 0.12, 0.05), octRing(0.03, 0.08, 0.02), "mechanical");
  readyLamp(P, v(-sd * 0.3, 0.385, -0.75), Y(), 0.035);
  B.socket("Glow_1", v(-sd * 0.3, 0.42, -0.75));
  lightStrip(P, v(sd * 0.25, 0.385, -0.75), Z(), X(), 0.25, 0.03);
  // The barrel cradle (Barrel, hinged at the trunnion): stowed 20° up; sleeve clamps and the spring pack ride it.
  const el = 20 * D2R, d = v(0, Math.sin(el), Math.cos(el));
  const [u, w] = frame(d);
  const at = (t: number, du = 0, dw = 0) => piv.clone().addScaledVector(d, t).addScaledVector(u, du).addScaledVector(w, dw);
  const C = B.piece("Barrel", piv);
  lathe(C, piv.clone().addScaledVector(X(), -0.38), X(), [[0, 0], [0, 0.13], [0.76, 0.13], [0.76, 0]], "dark", { n: 12 });
  for (const t of [0.05, 1.05]) lathe(C, at(t), d, [[0, 0.33], [0, 0.42], [0.22, 0.42], [0.22, 0.33]], "secondary", { n: 14, ring: true });
  for (const s of [1, -1]) {
    // Recoil springs: ribbed cylinders under the tube, either side.
    ribbedHose(C, [at(-0.15, s * 0.22, -0.34), at(1.3, s * 0.22, -0.34)], 0.07, 0.13, "mechanical", "dark", 8, 0.25);
    lathe(C, at(1.3, s * 0.22, -0.34), d, [[0, 0], [0, 0.09], [0.1, 0.09], [0.1, 0]], "dark", { n: 10 });
  }
  boltRow(C, at(0.1, 0, 0.42), at(0.1, 0, 0.42).addScaledVector(d, 0.001), 1, w, 0.03);
  B.move({ node: "Barrel", kind: "hinge", angleDeg: -50 });
  // The tube (Recoil, riding the cradle): huge and stubby, a domed breech, bands, a crown with a hazard band.
  const T = B.piece("Recoil", piv, "Barrel");
  const r = 0.32, L = 2.3, back = -0.45;
  T.heatAt = (p) => (p.clone().sub(piv).dot(d) > L + back - 0.4 ? 1 : 0);
  lathe(T, at(back), d, [
    [-0.18, 0], [-0.16, r * 0.5], [-0.05, r * 0.92], [0, r], [L * 0.3, r], [L * 0.3, r * 1.07], [L * 0.36, r * 1.07], [L * 0.36, r],
    [L * 0.82, r * 0.96], [L * 0.86, r * 1.1], [L * 0.94, r * 1.1], [L * 0.96, r * 1.0], [L, r * 1.0], [L, r * 0.8], [L - 0.5, r * 0.78], [L - 0.5, 0],
  ], "plating", { n: 18, secs: ["mechanical", "mechanical", "plating", "plating", "secondary", "secondary", "secondary", "plating", "trim", "trim", "dark", "mechanical", "dark", "dark", "dark"] });
  T.heatAt = () => 0;
  hazard(T, at(L * 0.6 + back, 0, r * 0.985), d, X().negate(), 0.42, 0.18, 6, "trim", "dark");
  stencilDigits(T, at(L * 0.45 + back, 0, r * 0.99), d.clone().negate(), X(), 0.13, "3");
  B.move({ node: "Recoil", kind: "slide", travel: 0.3, axis: [0, -d.y, -d.z] });
  B.socket("Recoil/Muzzle_0", at(L + back + 0.05), d);
  B.socket("Recoil/Glow_0", at(L + back - 0.2));
  B.socket("Mount", v());
  void o;
  return B.def();
}

/** Line mortar: a long low rack of seven short tubes in a fore-aft staircase that ripple-fire. */
export function mortarLine(sd: 1 | -1 = -1, seed = 5): ModelDef {
  const B = new Build(seed, 1.4, sd), P = B.piece("Body"), rd = B.read;
  // Base: a low rail bed with a turntable and the hinge block at the back.
  lathe(P, v(0, 0, -0.2), Y(), [[0, 0], [0, 0.32], [0.07, 0.32], [0.09, 0.28], [0.1, 0]], "mechanical", { n: 14 });
  loftZ(P, [[-1.05, octRing(0.3, 0.09, 0.04, 0.04)], [0.75, octRing(0.3, 0.09, 0.04, 0.04)], [0.9, octRing(0.22, 0.07, 0.03, 0.04)]], "plating", { y0: 0.18 });
  const piv = v(0, 0.36, -0.95);
  for (const s of [1, -1]) {
    loftZ(P, [[-1.1, octRing(0.04, 0.16, 0.04), 0.3], [-0.75, octRing(0.04, 0.1, 0.03), 0.27]], "plating", { x0: s * 0.33 });
    lathe(P, v(s * 0.33, piv.y, piv.z), v(s, 0, 0), [[0, 0], [0, 0.09], [0.06, 0.09], [0.06, 0]], "mechanical", { n: 10 });
  }
  plate(P, v(sd * 0.305, 0.18, -0.15), rd.clone().negate(), Y(), 1.2, 0.13, 0.02, "secondary", { bevel: 0.008 });
  stencilDigits(P, v(sd * 0.33, 0.18, -0.15), rd, Y(), 0.09, "7");
  chevrons(P, v(0, 0.275, 0.65), Z(), X(), 0.3, 0.14, 2, "trim");
  readyLamp(P, v(0, 0.275, 0.82), Y(), 0.028);
  B.socket("Glow_7", v(0, 0.3, 0.82));
  // The rack (Barrel, hinged at the back): a long frame with seven tube cradles stepping up toward the back.
  const R = B.piece("Barrel", piv);
  const el = 22 * D2R, d = v(0, Math.sin(el), Math.cos(el));
  const N = 7, pitch = 0.27, r = 0.095, len = 0.62;
  loftZ(R, [[-0.95, octRing(0.24, 0.05, 0.02), 0.42], [0.8, octRing(0.24, 0.05, 0.02), 0.3]], "secondary");
  for (const s of [1, -1]) {
    prism(R, v(s * 0.25, 0.48, -0.98), v(s * 0.25, 0.36, 0.85), octRing(0.025, 0.09, 0.02), "plating");
    hazard(R, v(s * 0.278, 0.4, 0.6), v(0, 0, -s), Y(), 0.4, 0.1, 6, "trim", "dark");
  }
  ribbedHose(R, bezier(v(-sd * 0.2, 0.5, -0.9), v(-sd * 0.3, 0.6, -0.4), v(-sd * 0.3, 0.55, 0.2), v(-sd * 0.22, 0.45, 0.7), 12), 0.03, 0.07, "dark", "mechanical", 8);
  for (let i = 0; i < N; i++) {
    // Front tube lowest; each one back steps up so the rack fires over itself.
    const z = 0.62 - i * pitch, y = 0.42 + i * 0.075;
    const base = v(0, y, z - len * 0.35 * d.z);
    lathe(R, base.clone().addScaledVector(d, len * 0.12), d, [[0, r * 1.25], [0, r * 1.45], [0.07, r * 1.45], [0.07, r * 1.25]], "dark", { n: 10, ring: true });
    prism(R, v(0, 0.36 + i * 0.045, z), base.clone().addScaledVector(d, len * 0.12), octRing(0.05, 0.03, 0.01), "mechanical");
    const T = B.piece(`Tube_${i}`, base, "Barrel");
    T.heatAt = (p) => (p.clone().sub(base).dot(d) > len * 0.75 ? 1 : 0);
    lathe(T, base, d, [[0, 0], [0, r * 0.7], [0.04, r], [len * 0.88, r], [len * 0.9, r * 1.12], [len, r * 1.12], [len, r * 0.82], [len - 0.2, r * 0.8], [len - 0.2, 0]], "plating", { n: 12, secs: ["mechanical", "mechanical", "plating", "trim", "trim", "dark", "dark", "dark"] });
    T.heatAt = () => 0;
    B.move({ node: `Tube_${i}`, kind: "slide", travel: 0.12, axis: [0, -d.y, -d.z] });
    B.socket(`Tube_${i}/Muzzle_${i}`, base.clone().addScaledVector(d, len + 0.04), d);
    B.socket(`Tube_${i}/Glow_${i}`, base.clone().addScaledVector(d, len - 0.1));
  }
  B.move({ node: "Barrel", kind: "hinge", angleDeg: -40 });
  B.socket("Mount", v());
  return B.def();
}

/** The mortar shell projectile: tail at the origin, nose along +Z. */
export function mortarShellProjectile(): ModelDef {
  const B = new Build(6, 0.5), P = B.piece("Body");
  shell(P, v(), Z(), 0.13, 0.6, 8);
  return B.def();
}
