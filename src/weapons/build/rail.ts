// Code stand-ins for docs/asset-list.md W6, the rail cannon:
// - rail-cannon-hull: two long rails with a visible gap held by insulator yokes, coil rings that light up as it
//   charges (lamp sections; Glow_n along the rails), capacitor banks either side of the breech, coolant lines.
// - rail-cannon-2h: longer, on a stock with grips (Grip_R at the root, Grip_L on the fore grip).
// Moving: Recoil (the rails and breech kick back). Root: the trunnion (hull) or the rear grip (two-handed).
import { Build, Piece, v, X, Y, Z, lathe, loftZ, octRing, plate, boltRow, hazard, stencilDigits, prism, ribbedHose, tube, bezier, louvres, lightStrip, cableLoom } from "../kit";
import { cowl, readyLamp, trunnion } from "./common";
import type { ModelDef } from "../parts";

function rails(B: Build, T: Piece, z0: number, z1: number, gap: number, k: number, glows: number) {
  const L = z1 - z0;
  T.heatAt = (p) => (p.z > z1 - L * 0.25 && Math.abs(p.y) < gap * 0.5 + 0.1 * k ? (p.z - (z1 - L * 0.25)) / (L * 0.25) : 0);
  for (const s of [1, -1]) {
    // Each rail: a tall flat bar, its inner face bare metal, tapering at the muzzle.
    loftZ(T, [[z0, octRing(0.075 * k, 0.11 * k, 0.03 * k)], [z1 - 0.25 * k, octRing(0.075 * k, 0.11 * k, 0.03 * k)], [z1, octRing(0.06 * k, 0.085 * k, 0.025 * k)]], "mechanical", { y0: s * (gap / 2 + 0.11 * k) });
  }
  T.heatAt = () => 0;
  // Insulator yokes round both rails, with coil rings that glow.
  const n = glows;
  for (let i = 0; i < n; i++) {
    const z = z0 + L * (0.12 + (0.78 * i) / Math.max(1, n - 1));
    lathe(T, v(0, 0, z - 0.06 * k), Z(), [[0, 0.24 * k], [0, 0.3 * k], [0.12 * k, 0.3 * k], [0.12 * k, 0.24 * k]], "secondary", { n: 8, ring: true, phase: Math.PI / 8 });
    lathe(T, v(0, 0, z + 0.07 * k), Z(), [[0, 0.24 * k], [0, 0.27 * k], [0.05 * k, 0.27 * k], [0.05 * k, 0.24 * k]], "lighting", { n: 8, ring: true, phase: Math.PI / 8 });
    B.socket(`Recoil/Glow_${i}`, v(0, 0.29 * k, z + 0.09 * k));
  }
  // A spine over the rails (coolant manifold) and a muzzle fork.
  prism(T, v(0, gap / 2 + 0.26 * k, z0), v(0, gap / 2 + 0.26 * k, z1 - L * 0.12), octRing(0.05 * k, 0.04 * k, 0.015 * k), "dark");
  lathe(T, v(0, 0, z1 - 0.1 * k), Z(), [[0, 0.22 * k], [0, 0.3 * k], [0.14 * k, 0.3 * k], [0.18 * k, 0.24 * k], [0.18 * k, 0.22 * k]], "dark", { n: 8, ring: true, phase: Math.PI / 8 });
}

function capacitors(T: Piece, x: number, z0: number, z1: number, k: number) {
  loftZ(T, [[z0, octRing(0.13 * k, 0.17 * k, 0.05 * k, 0.02 * k)], [z1, octRing(0.13 * k, 0.17 * k, 0.05 * k, 0.02 * k)]], "secondary", { x0: x, y0: -0.05 * k });
  for (let i = 0; i < 4; i++) lathe(T, v(x, 0.13 * k, z0 + (z1 - z0) * (0.15 + i * 0.22)), Y(), [[0, 0], [0, 0.05 * k], [0.06 * k, 0.05 * k], [0.07 * k, 0.03 * k], [0.07 * k, 0]], "mechanical", { n: 8 });
}

/**
 * Hull rail cannon (in place of an arm), rebalanced (Keith 2026-11-02: "sitting way too far forward, especially on the
 * hull mounts"): the rails are cut back to reach 2.75 m and the power sits behind the shoulder, a capacitor bank of
 * four cells either side of a long breech, a radiator stack on top and a heavy power cell at the very back with cables
 * running forward to the rails. The axis hangs 0.95 m outboard of the shoulder.
 */
export function railCannonHull(sd: 1 | -1 = -1, seed = 8): ModelDef {
  const B = new Build(seed, 2, sd), P = B.piece("Body"), o = B.out, rd = B.read;
  cowl(P, -0.75, 0.4, 0.44, 0.36, -0.04);
  louvres(P, v(sd * 0.445, 0.02, -0.25), rd.clone().negate(), Y(), 0.5, 0.36, 5);
  boltRow(P, v(sd * 0.44, 0.27, -0.6), v(sd * 0.44, 0.27, 0.3), 5, o, 0.02);
  stencilDigits(P, v(0, 0.365, 0.05), X().negate(), Z(), 0.18, "44");
  hazard(P, v(sd * 0.445, -0.25, 0.2), rd, Y(), 0.3, 0.09, 6);
  trunnion(B, P, 0.16, 0.5, v(-sd * 0.42, 0, 0));
  // The power cell behind the shoulder: a heavy block with a radiator stack, a lamp and a stencil.
  loftZ(P, [[-1.75, octRing(0.38, 0.42, 0.1, 0.04)], [-1.62, octRing(0.46, 0.5, 0.12, 0.04)], [-0.75, octRing(0.46, 0.5, 0.12, 0.04)]], "secondary", { y0: 0.06 });
  plate(P, v(0, 0.06, -1.76), X(), Y(), 0.6, 0.7, 0.08, "dark", { bevel: 0.02 });
  for (let i = 0; i < 8; i++) plate(P, v(0, 0.58, -1.6 + i * 0.12), X(), Z().negate(), 0.7, 0.05, 0.1, "mechanical", { bevel: 0, ch: 0.01 });
  hazard(P, v(sd * 0.425, -0.22, -1.15), rd, Y(), 0.5, 0.08, 6);
  stencilDigits(P, v(sd * 0.425, 0.12, -1.15), rd, Y(), 0.16, "HV");
  readyLamp(P, v(-sd * 0.25, 0.37, -0.5), Y(), 0.03);
  lightStrip(P, v(sd * 0.2, 0.5, -0.6), Z(), X(), 0.22, 0.03);
  for (const s of [1, -1]) tube(P, bezier(v(s * 0.3, 0.3, -1.3), v(s * 0.5, 0.5, -0.6), v(s * 0.45, 0.45, 0.0), v(s * 0.3, 0.3, 0.3), 8), 0.035, "dark", { n: 6 });
  const T = B.piece("Recoil", v());
  rails(B, T, 0.15, 2.7, 0.1, 1, 4);
  capacitors(T, sd * 0.32, -1.25, -0.05, 1);
  capacitors(T, -sd * 0.32, -1.25, -0.05, 1);
  // A long breech behind the rails and coolant lines from the capacitors forward.
  loftZ(T, [[-1.4, octRing(0.24, 0.24, 0.07)], [-0.9, octRing(0.28, 0.28, 0.08)], [0.2, octRing(0.28, 0.28, 0.08)]], "plating");
  for (const s of [1, -1]) ribbedHose(T, bezier(v(s * 0.32, 0.15, -0.1), v(s * 0.3, 0.3, 0.3), v(s * 0.12, 0.38, 0.5), v(0.0, 0.3, 0.8), 12), 0.03, 0.07, "dark", "mechanical", 8);
  cableLoom(T, v(sd * 0.3, -0.18, -0.1), v(sd * 0.05, -0.22, 1.6), v(0, -0.1, 0), 0.018, 3);
  B.move({ node: "Recoil", kind: "slide", travel: 0.2 });
  B.socket("Recoil/Muzzle_0", v(0, 0, 2.75), Z());
  B.socket("Mount", v(-sd * 0.95, 0, 0));
  return B.def();
}

/** Two-handed rail cannon: longer rails on a stock, grips for both hands. */
export function railCannon2h(sd: 1 | -1 = -1, seed = 9): ModelDef {
  const B = new Build(seed, 2.4, sd), P = B.piece("Body"), rd = B.read;
  const k = 0.85;
  // Stock and receiver with the rear grip at the root, a fore grip under the capacitors.
  loftZ(P, [[-1.2, octRing(0.12, 0.2, 0.06), 0.05], [-0.9, octRing(0.14, 0.24, 0.07), 0.05], [-0.25, octRing(0.22, 0.24, 0.07)], [0.6, octRing(0.24, 0.26, 0.07)]], "plating");
  for (const [z, name] of [[0, "Grip_R"], [1.1, "Grip_L"]] as const) {
    prism(P, v(0, -0.15, z), v(0, -0.6, z - 0.12), octRing(0.07, 0.09, 0.03), "dark", Z(), octRing(0.06, 0.08, 0.03));
    B.socket(name, v(0, -0.38, z - 0.06));
  }
  loftZ(P, [[0.7, octRing(0.2, 0.15, 0.05), -0.12], [1.5, octRing(0.2, 0.15, 0.05), -0.12]], "secondary");
  louvres(P, v(sd * 0.245, 0.02, 0.1), rd.clone().negate(), Y(), 0.45, 0.3, 5);
  stencilDigits(P, v(0, 0.265, -0.4), X().negate(), Z(), 0.15, "2H");
  readyLamp(P, v(0, 0.26, 0.4), Y(), 0.028);
  const T = B.piece("Recoil", v());
  rails(B, T, 0.4, 4.3, 0.09 * k, k, 6);
  capacitors(T, 0.27, 0.6, 1.5, k);
  capacitors(T, -0.27, 0.6, 1.5, k);
  B.move({ node: "Recoil", kind: "slide", travel: 0.15 });
  B.socket("Recoil/Muzzle_0", v(0, 0, 4.35), Z());
  B.socket("Mount", v());
  return B.def();
}
