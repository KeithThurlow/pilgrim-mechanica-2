// Code stand-ins for docs/asset-list.md W7 and W8, hull guns that shoot shells:
// - autocannon-hull: a big receiver, one thick barrel in a recoil sleeve (Barrel slides back) with cooling rings and
//   a perforated muzzle brake, a box magazine with a stencil, an ejection port. Recoil 0.2 m.
// - cannon-hull: a tank-gun look: a long barrel with a fume extractor and a thermal sleeve, a big breech, a
//   mantlet. Recoil 0.4 m.
// Root at the trunnion on the barrel's axis. Sockets Muzzle_0, Eject, Mount, Glow_n (barrel heat, lamps).
import { Build, Piece, v, X, Y, Z, lathe, loftZ, octRing, plate, prism, bolt, boltRow, boltCircle, hazard, chevrons, stencilDigits, heatRings, louvres, lightStrip, serrations, bezier, sweep } from "../kit";
import { cowl, laserEmitter, readyLamp, trunnion } from "./common";
import type { ModelDef } from "../parts";

/** A barrel along +Z from z0 to z1 (radius r) with a perforated brake at the muzzle; heat toward the muzzle. */
function barrel(P: Piece, z0: number, z1: number, r: number, brake: number) {
  const L = z1 - z0;
  P.heatAt = (p) => Math.max(0, Math.min(1, (p.z - (z0 + L * 0.45)) / (L * 0.5)));
  lathe(P, v(0, 0, z0), Z(), [[0, 0], [0, r * 1.2], [L * 0.05, r * 1.2], [L * 0.06, r], [L - brake, r * 0.92], [L - brake, 0]], "mechanical", { n: 12 });
  // Brake: a block with ports on both sides.
  const zb = z1 - brake;
  lathe(P, v(0, 0, zb), Z(), [[0, 0], [0, r * 1.5], [brake * 0.2, r * 1.6], [brake * 0.8, r * 1.6], [brake, r * 1.4], [brake, r * 0.6], [brake - r, r * 0.55], [brake - r, 0]], "dark", { n: 8, phase: Math.PI / 8 });
  for (let i = 0; i < 3; i++) for (const s of [1, -1]) plate(P, v(s * r * 1.55, 0, zb + brake * (0.28 + i * 0.22)), v(0, 0, -s), Y(), brake * 0.14, r * 1.6, r * 0.12, "mechanical", { bevel: 0 });
  P.heatAt = () => 0;
}

/** Hull autocannon (Keith 2026-11-02, weight behind the shoulder): a long receiver, a big belt box behind the shoulder
 * with its chute into the breech, a counterweight, a casing port; the barrel reaches 2.65 m. */
export function autocannonHull(sd: 1 | -1 = -1, seed = 10): ModelDef {
  const B = new Build(seed, 1.8, sd), P = B.piece("Body"), o = B.out, rd = B.read;
  cowl(P, -0.95, 0.3, 0.46, 0.4, -0.02);
  trunnion(B, P, 0.17, 0.5, v(-sd * 0.44, 0, 0));
  // The belt box behind the shoulder, taller than the receiver, stencilled; its chute into the outboard flank.
  loftZ(P, [[-1.7, octRing(0.42, 0.44, 0.08, 0.03)], [-0.95, octRing(0.42, 0.44, 0.08, 0.03)]], "secondary", { y0: 0.08 });
  plate(P, v(0, 0.53, -1.32), X(), Z().negate(), 0.7, 0.6, 0.04, "dark", { bevel: 0.01 });
  stencilDigits(P, v(sd * 0.425, 0.12, -1.32), rd, Y(), 0.2, "30");
  hazard(P, v(sd * 0.425, -0.22, -1.32), rd, Y(), 0.6, 0.08, 8);
  boltRow(P, v(sd * 0.425, 0.42, -1.6), v(sd * 0.425, 0.42, -1.05), 4, o, 0.02);
  prism(P, v(sd * 0.3, 0.3, -0.98), v(sd * 0.42, 0.2, -0.55), octRing(0.14, 0.04, 0.01), "dark", Y());
  for (let i = 0; i < 4; i++) plate(P, v(sd * (0.33 + i * 0.03), 0.3 - i * 0.025, -0.9 + i * 0.1), X(), Z(), 0.2, 0.05, 0.03, "trim", { bevel: 0 });
  plate(P, v(0, 0.08, -1.71), X(), Y(), 0.7, 0.7, 0.08, "dark", { bevel: 0.02 });
  plate(P, v(-sd * 0.1, -0.42, -0.4), X(), Z(), 0.4, 0.16, 0.03, "dark", { bevel: 0 });
  B.socket("Eject", v(-sd * 0.1, -0.44, -0.4), Y().negate());
  louvres(P, v(0, 0.405, -0.5), X().negate(), Z(), 0.5, 0.4, 5);
  chevrons(P, v(0, 0.405, 0.05), Z(), X(), 0.3, 0.16, 3);
  readyLamp(P, v(sd * 0.3, 0.4, 0.15), Y(), 0.03);
  B.socket("Glow_1", v(sd * 0.3, 0.43, 0.15));
  laserEmitter(B, P, v(-sd * 0.25, -0.33, 0.3), 0.05);
  // The barrel in its recoil sleeve (Barrel slides back) and the mantlet ring.
  lathe(P, v(0, 0, 0.3), Z(), [[0, 0], [0, 0.26], [0.12, 0.26], [0.18, 0.2], [0.18, 0]], "plating", { n: 12 });
  boltCircle(P, v(0, 0, 0.35), Z(), 0.22, 8, 0.016);
  const Bl = B.piece("Barrel", v(0, 0, 0.45));
  lathe(Bl, v(0, 0, 0.35), Z(), [[0, 0], [0, 0.16], [0.5, 0.16], [0.55, 0.13], [0.55, 0]], "secondary", { n: 12 });
  heatRings(Bl, v(0, 0, 0.95), Z(), 0.1, 0.14, 5, 0.42, "dark", 10);
  barrel(Bl, 0.45, 2.6, 0.09, 0.3);
  B.move({ node: "Barrel", kind: "slide", travel: 0.25 });
  B.socket("Barrel/Muzzle_0", v(0, 0, 2.65), Z());
  B.socket("Barrel/Glow_0", v(0, 0, 2.1));
  B.socket("Mount", v(-sd * 0.94, 0, 0));
  return B.def();
}

/**
 * The Rampart's own minigun pod gets more behind it (Keith 2026-11-02: "even it could have more construction sitting
 * behind"): an ammo drum lying across behind the pod with a belt chute arching into the pod's back, side braces and a
 * counterweight plate. Hangs on the pod's kick pivot (the shoulder); built round the pod's barrel axis, which sits
 * 0.94 m outboard and 0.32 m below the shoulder on the Rampart. No muzzle: the pod fires.
 */
export function minigunFeedHull(sd: 1 | -1 = -1, seed = 16): ModelDef {
  const B = new Build(seed, 1.6, sd), P = B.piece("Body"), o = B.out, rd = B.read;
  const c = v(0, 0.12, -1.45), R = 0.44, W = 0.62;
  lathe(P, c.clone().addScaledVector(o, -W / 2), o, [[0, 0], [0, R * 0.9], [0.04, R], [W - 0.04, R], [W, R * 0.9], [W, 0]], "secondary", { n: 18 });
  for (const t of [0.12, W - 0.16]) lathe(P, c.clone().addScaledVector(o, -W / 2 + t), o, [[0, R], [0, R + 0.035], [0.04, R + 0.035], [0.04, R]], "dark", { n: 18, ring: true });
  lathe(P, c.clone().addScaledVector(o, W / 2), o, [[0, 0], [0, 0.14], [0.05, 0.12], [0.05, 0]], "mechanical", { n: 10 });
  boltCircle(P, c.clone().addScaledVector(o, W / 2 + 0.002), o, 0.25, 6, 0.02);
  stencilDigits(P, c.clone().addScaledVector(o, W / 2 + 0.003).add(v(0, -0.25, 0)), rd, Y(), 0.12, "800");
  // The belt chute: links arching from the drum's top into the back of the pod.
  const path = bezier(v(0, c.y + R - 0.05, c.z + 0.05), v(0, c.y + R + 0.25, c.z + 0.3), v(0, 0.75, -0.95), v(0, 0.62, -0.78), 8);
  sweep(P, path, octRing(0.13, 0.05, 0.015), "dark");
  for (let i = 1; i < path.length - 1; i++) plate(P, path[i].clone().add(v(0, 0.055, 0)), X(), path[i + 1].clone().sub(path[i - 1]).normalize(), 0.24, 0.05, 0.02, "trim", { bevel: 0 });
  // Side braces from the pod's back to the drum's hubs, a cradle under it and a counterweight plate behind.
  for (const s of [1, -1]) plate(P, v(s * (W / 2 + 0.03), 0.02, -1.2), v(s, 0, 0), Z(), 0.6, 0.16, 0.04, "mechanical", { bevel: 0.01 });
  loftZ(P, [[-1.85, octRing(0.3, 0.06, 0.02)], [-1.0, octRing(0.3, 0.06, 0.02)]], "plating", { y0: c.y - R - 0.04 });
  plate(P, v(0, c.y, -1.92), X(), Y(), 0.5, 0.6, 0.08, "dark", { bevel: 0.02 });
  hazard(P, v(sd * 0.32, c.y - R - 0.0, -1.4), rd, Y(), 0.5, 0.05, 6);
  // The pod's own muzzle (the feed has none; the arsenal's laser falls back to it).
  B.socket("Muzzle_0", v(0, 0, 2.0), Z());
  B.socket("Mount", v(-sd * 0.94, 0.32, 0));
  return B.def();
}

/**
 * The breach cannon (hull; src/weapons/cannon.ts), rebalanced (Keith 2026-11-02: "you'd expect to have shells and
 * casings and potentially a large magazine sitting behind ... the weight of this thing"). The weight sits behind the
 * shoulder: an armoured autoloader bustle with a rack of ready shells showing through its open outboard flank, a
 * counterweight plate at the back, a spent casing chute and a catcher basket under the bustle. Ahead: a short
 * mantlet, two recuperator cylinders over the barrel and a stubby barrel (fume extractor, two-baffle brake) that
 * reaches 3 m, not the old 4.8. The gun axis hangs 1 m outboard of the shoulder. Recoil 0.4 m.
 */
export function cannonHull(sd: 1 | -1 = -1, seed = 11): ModelDef {
  const B = new Build(seed, 2.4, sd), P = B.piece("Body"), o = B.out, rd = B.read;
  // Mantlet housing round the breech, just ahead of the shoulder.
  cowl(P, -0.4, 0.5, 0.48, 0.42, 0);
  trunnion(B, P, 0.18, 0.55, v(-sd * 0.46, 0, 0));
  loftZ(P, [[0.42, octRing(0.42, 0.36, 0.12, 0.04)], [0.62, octRing(0.34, 0.3, 0.1, 0.04)]], "plating");
  boltCircle(P, v(0, 0, 0.62), Z(), 0.24, 10, 0.018);
  // The autoloader bustle behind the shoulder: taller and wider than the mantlet, battered top, tapering to the back.
  loftZ(P, [
    [-1.5, octRing(0.44, 0.42, 0.13, 0.06, 0.05), 0.06],
    [-1.25, octRing(0.52, 0.5, 0.15, 0.06, 0.05), 0.08],
    [-0.42, octRing(0.5, 0.48, 0.14, 0.05, 0.04), 0.06],
  ], "plating");
  serrations(P, v(0, 0.58, -0.85), Z(), X(), 0.6, 0.55, 7, 0.03, "dark");
  readyLamp(P, v(-sd * 0.3, 0.585, -0.55), Y(), 0.032);
  B.socket("Glow_1", v(-sd * 0.3, 0.615, -0.55));
  lightStrip(P, v(-sd * 0.3, 0.585, -1.05), Z(), X(), 0.3, 0.03);
  // The ready rack: shells lying fore and aft in an open frame along the outboard flank, brass cases, dark noses.
  const rx = sd * 0.53;
  plate(P, v(rx, 0.06, -0.93), rd.clone().negate(), Y(), 0.98, 0.8, 0.04, "dark", { bevel: 0 });
  for (const y of [0.42, -0.3]) plate(P, v(rx + sd * 0.1, 0.06 + y, -0.93), rd.clone().negate(), o, 1.0, 0.2, 0.05, "secondary", { bevel: 0.01 });
  for (let i = 0; i < 3; i++) {
    const y = 0.28 - i * 0.22;
    lathe(P, v(rx + sd * 0.11, 0.06 + y, -1.36), Z(), [[0, 0], [0, 0.085], [0.04, 0.09], [0.56, 0.09], [0.58, 0.08], [0.58, 0]], "trim", { n: 10, secs: ["trim", "trim", "trim", "trim", "trim"] });
    lathe(P, v(rx + sd * 0.11, 0.06 + y, -0.78), Z(), [[0, 0], [0, 0.08], [0.1, 0.07], [0.2, 0.035], [0.24, 0]], "dark", { n: 10 });
  }
  stencilDigits(P, v(rx + sd * 0.12, 0.43, -1.25), rd, Y(), 0.12, "105");
  hazard(P, v(sd * 0.505, -0.35, 0.25), rd, Y(), 0.4, 0.08, 6);
  boltRow(P, v(sd * 0.505, 0.33, -0.3), v(sd * 0.505, 0.33, 0.4), 4, o, 0.022);
  // Counterweight: a thick bolted plate across the back of the bustle.
  plate(P, v(0, 0.06, -1.5), X(), Y(), 0.82, 0.78, 0.12, "secondary", { bevel: 0.03 });
  for (const x of [-0.28, 0, 0.28]) for (const y of [-0.22, 0.34]) bolt(P, v(x, 0.06 + y, -1.625), Z().negate(), 0.03);
  // Spent casings: a chute out of the bustle's belly and a wire basket under it with a couple of empty cases.
  prism(P, v(-sd * 0.12, -0.42, -0.7), v(-sd * 0.12, -0.62, -0.9), octRing(0.13, 0.11, 0.03), "dark");
  B.socket("Eject", v(-sd * 0.12, -0.64, -0.92), Y().negate());
  loftZ(P, [[-1.32, octRing(0.24, 0.13, 0.04)], [-0.95, octRing(0.24, 0.13, 0.04)]], "mechanical", { y0: -0.58, x0: sd * 0.12 });
  for (let i = 0; i < 2; i++) lathe(P, v(sd * (0.04 + i * 0.16), -0.46, -1.28 + i * 0.05), Z(), [[0, 0], [0, 0.07], [0.3, 0.075], [0.3, 0]], "trim", { n: 8 });
  // Recuperators over the barrel and the laser under the mantlet.
  for (const x of [-0.17, 0.17]) lathe(P, v(x, 0.27, 0.55), Z(), [[0, 0], [0, 0.075], [0.5, 0.075], [0.55, 0.05], [0.55, 0]], "mechanical", { n: 10 });
  laserEmitter(B, P, v(sd * 0.3, -0.3, 0.64), 0.05);
  // The recoiling gun: breech block (inside the housing), barrel, thermal sleeve bands, fume extractor, muzzle brake.
  const T = B.piece("Recoil", v());
  loftZ(T, [[-0.95, octRing(0.24, 0.24, 0.06)], [-0.3, octRing(0.26, 0.26, 0.07)]], "mechanical");
  barrel(T, 0.6, 3.0, 0.11, 0.38);
  T.heatAt = (p) => (p.z > 2.0 ? 0.6 : 0);
  lathe(T, v(0, 0, 1.45), Z(), [[0, 0.11], [0.1, 0.18], [0.45, 0.18], [0.58, 0.11]], "secondary", { n: 12, ring: false });
  T.heatAt = () => 0;
  for (const z of [0.85, 1.2]) lathe(T, v(0, 0, z), Z(), [[0, 0.11], [0, 0.145], [0.1, 0.145], [0.1, 0.11]], "dark", { n: 10, ring: true });
  B.move({ node: "Recoil", kind: "slide", travel: 0.4 });
  B.socket("Recoil/Muzzle_0", v(0, 0, 3.05), Z());
  B.socket("Recoil/Glow_0", v(0, 0, 2.5));
  B.socket("Mount", v(-sd * 1.0, 0, 0));
  return B.def();
}
