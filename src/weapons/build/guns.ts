// Code stand-ins for docs/asset-list.md W7 and W8, hull guns that shoot shells:
// - autocannon-hull: a big receiver, one thick barrel in a recoil sleeve (Barrel slides back) with cooling rings and
//   a perforated muzzle brake, a box magazine with a stencil, an ejection port. Recoil 0.2 m.
// - cannon-hull: a tank-gun look: a long barrel with a fume extractor and a thermal sleeve, a big breech, a
//   mantlet. Recoil 0.4 m.
// Root at the trunnion on the barrel's axis. Sockets Muzzle_0, Eject, Mount, Glow_n (barrel heat, lamps).
import { Build, Piece, v, X, Y, Z, lathe, loftZ, octRing, plate, boltRow, boltCircle, hazard, chevrons, stencilDigits, heatRings, louvres, lightStrip, serrations } from "../kit";
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

/** Hull autocannon. */
export function autocannonHull(sd: 1 | -1 = -1, seed = 10): ModelDef {
  const B = new Build(seed, 1.8, sd), P = B.piece("Body"), o = B.out, rd = B.read;
  cowl(P, -0.75, 0.45, 0.46, 0.4, -0.02);
  trunnion(B, P, 0.17, 0.5, v(-sd * 0.44, 0, -0.1));
  // Box magazine on the outboard side with a stencil, the ejection port under.
  loftZ(P, [[-0.55, octRing(0.16, 0.3, 0.05)], [0.2, octRing(0.16, 0.3, 0.05)]], "secondary", { x0: sd * 0.6, y0: -0.06 });
  stencilDigits(P, v(sd * 0.765, -0.02, -0.17), rd, Y(), 0.2, "30");
  hazard(P, v(sd * 0.765, 0.2, -0.17), rd, Y(), 0.6, 0.08, 8);
  boltRow(P, v(sd * 0.765, -0.3, -0.5), v(sd * 0.765, -0.3, 0.15), 4, o, 0.02);
  plate(P, v(-sd * 0.1, -0.42, -0.1), X(), Z(), 0.4, 0.16, 0.03, "dark", { bevel: 0 });
  B.socket("Eject", v(-sd * 0.1, -0.44, -0.1), Y().negate());
  louvres(P, v(0, 0.405, -0.35), X().negate(), Z(), 0.5, 0.4, 5);
  chevrons(P, v(0, 0.405, 0.2), Z(), X(), 0.3, 0.16, 3);
  readyLamp(P, v(sd * 0.3, 0.4, 0.3), Y(), 0.03);
  B.socket("Glow_1", v(sd * 0.3, 0.43, 0.3));
  laserEmitter(B, P, v(-sd * 0.25, -0.33, 0.45), 0.05);
  // The barrel in its recoil sleeve (Barrel slides back) and the mantlet ring.
  lathe(P, v(0, 0, 0.45), Z(), [[0, 0], [0, 0.26], [0.12, 0.26], [0.18, 0.2], [0.18, 0]], "plating", { n: 12 });
  boltCircle(P, v(0, 0, 0.5), Z(), 0.22, 8, 0.016);
  const Bl = B.piece("Barrel", v(0, 0, 0.6));
  lathe(Bl, v(0, 0, 0.5), Z(), [[0, 0], [0, 0.16], [0.6, 0.16], [0.65, 0.13], [0.65, 0]], "secondary", { n: 12 });
  heatRings(Bl, v(0, 0, 1.2), Z(), 0.1, 0.14, 6, 0.5, "dark", 10);
  barrel(Bl, 0.6, 2.9, 0.09, 0.32);
  B.move({ node: "Barrel", kind: "slide", travel: 0.25 });
  B.socket("Barrel/Muzzle_0", v(0, 0, 2.95), Z());
  B.socket("Barrel/Glow_0", v(0, 0, 2.4));
  B.socket("Mount", v(-sd * 0.94, 0, -0.1));
  return B.def();
}

/** Hull cannon: a long tank gun with a fume extractor and a big breech. */
export function cannonHull(sd: 1 | -1 = -1, seed = 11): ModelDef {
  const B = new Build(seed, 2.4, sd), P = B.piece("Body"), o = B.out, rd = B.read;
  cowl(P, -0.6, 0.4, 0.5, 0.42, 0);
  trunnion(B, P, 0.18, 0.5, v(-sd * 0.48, 0, -0.05));
  // Mantlet: a battered armour block on the front with a bolt circle.
  loftZ(P, [[0.35, octRing(0.44, 0.38, 0.12, 0.04)], [0.6, octRing(0.38, 0.32, 0.1, 0.04)]], "plating");
  boltCircle(P, v(0, 0, 0.6), Z(), 0.26, 10, 0.018);
  plate(P, v(sd * 0.5, 0, -0.1), rd.clone().negate(), Y(), 0.8, 0.5, 0.05, "secondary");
  stencilDigits(P, v(sd * 0.555, 0.03, -0.1), rd, Y(), 0.24, "105");
  serrations(P, v(0, 0.42, -0.2), Z(), X(), 0.5, 0.5, 6, 0.03, "dark");
  hazard(P, v(sd * 0.505, -0.3, 0.25), rd, Y(), 0.4, 0.08, 6);
  boltRow(P, v(sd * 0.505, 0.33, -0.55), v(sd * 0.505, 0.33, 0.3), 5, o, 0.022);
  readyLamp(P, v(-sd * 0.3, 0.42, -0.4), Y(), 0.032);
  B.socket("Glow_1", v(-sd * 0.3, 0.45, -0.4));
  lightStrip(P, v(-sd * 0.3, 0.42, 0.1), Z(), X(), 0.3, 0.03);
  plate(P, v(-sd * 0.15, -0.43, -0.2), X(), Z(), 0.4, 0.2, 0.03, "dark", { bevel: 0 });
  B.socket("Eject", v(-sd * 0.15, -0.46, -0.2), Y().negate());
  laserEmitter(B, P, v(sd * 0.3, -0.3, 0.62), 0.05);
  // The recoiling gun: breech block, barrel, thermal sleeve bands, fume extractor, muzzle brake.
  const T = B.piece("Recoil", v());
  loftZ(T, [[-1.15, octRing(0.24, 0.24, 0.06)], [-0.55, octRing(0.26, 0.26, 0.07)]], "mechanical");
  plate(T, v(0, 0, -1.16), X(), Y().negate(), 0.36, 0.36, 0.04, "dark", { bevel: 0.015 });
  barrel(T, 0.55, 4.0, 0.1, 0.36);
  T.heatAt = (p) => (p.z > 2.6 ? 0.6 : 0);
  lathe(T, v(0, 0, 2.2), Z(), [[0, 0.1], [0.12, 0.17], [0.55, 0.17], [0.7, 0.1]], "secondary", { n: 12, ring: false });
  T.heatAt = () => 0;
  for (const z of [0.9, 1.35, 1.8]) lathe(T, v(0, 0, z), Z(), [[0, 0.1], [0, 0.135], [0.12, 0.135], [0.12, 0.1]], "dark", { n: 10, ring: true });
  B.move({ node: "Recoil", kind: "slide", travel: 0.4 });
  B.socket("Recoil/Muzzle_0", v(0, 0, 4.05), Z());
  B.socket("Recoil/Glow_0", v(0, 0, 3.3));
  B.socket("Mount", v(-sd * 0.98, 0, -0.05));
  return B.def();
}
