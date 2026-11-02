// Code-built held round guns (Keith 2026-11-02, src/weapons/guns.ts), held in an arm's hand: the battle rifle, the SMG
// and the scattergun. Laid out after the sister project's rifle template (pilgrim-mechanica
// tools/blender/templates/rifle.py: a receiver the rest hangs off, a pistol grip at the origin, a barrel with a
// handguard round its back part, a stock behind, the magazine just ahead of the grip, an optic on top, a muzzle
// device), at mech scale. The Unity project had no rifle or SMG meshes, so these are built in the same kit as the
// hull guns, and each reads by its silhouette from the game camera: the rifle long with a scope, the SMG stubby with
// a long stick magazine and a folded wire stock, the scattergun with two fat barrels, a pump and a drum.
// Root at the grip (Mount), +Z along the barrel. Recoil slides back on a shot.
import { Build, Piece, v, X, Y, Z, lathe, loftZ, octRing, plate, prism, boltRow, hazard, stencilDigits, louvres, heatRings, type V3 } from "../kit";
import type { ModelDef } from "../parts";

/** The pistol grip under the receiver, raked back, a trigger guard ahead of it. */
function grip(P: Piece, k: number) {
  prism(P, v(0, -0.06 * k, 0.02 * k), v(0, -0.36 * k, -0.08 * k), octRing(0.055 * k, 0.075 * k, 0.02 * k), "dark", Z(), octRing(0.05 * k, 0.07 * k, 0.02 * k));
  prism(P, v(0, -0.09 * k, 0.06 * k), v(0, -0.09 * k, 0.2 * k), octRing(0.02 * k, 0.012 * k, 0.004 * k), "mechanical");
  prism(P, v(0, -0.09 * k, 0.2 * k), v(0, -0.04 * k, 0.21 * k), octRing(0.02 * k, 0.012 * k, 0.004 * k), "mechanical");
}

/** A barrel along +Z from z0 to z1 at height y, radius r, heat toward the muzzle. */
function barrelZ(P: Piece, y: number, z0: number, z1: number, r: number, x = 0) {
  const L = z1 - z0;
  P.heatAt = (p) => Math.max(0, Math.min(1, (p.z - (z0 + L * 0.4)) / (L * 0.6)));
  lathe(P, v(x, y, z0), Z(), [[0, 0], [0, r * 1.15], [L * 0.06, r * 1.15], [L * 0.07, r], [L, r * 0.95], [L, 0]], "mechanical", { n: 10 });
  P.heatAt = () => 0;
}

/** Battle rifle: receiver, solid stock, slab handguard, curved magazine ahead of the grip, a scope, a muzzle brake. */
export function rifleHeld(sd: 1 | -1 = -1, seed = 31): ModelDef {
  const B = new Build(seed, 1.2, sd), P = B.piece("Body"), rd = B.read;
  const yb = 0.08;
  // Receiver: the mass everything hangs off.
  loftZ(P, [[-0.3, octRing(0.1, 0.13, 0.03)], [-0.25, octRing(0.115, 0.15, 0.035)], [0.55, octRing(0.115, 0.15, 0.035)], [0.62, octRing(0.1, 0.13, 0.03)]], "plating", { y0: 0.04 });
  louvres(P, v(sd * 0.116, 0.06, 0.25), rd.clone().negate(), Y(), 0.3, 0.12, 4);
  stencilDigits(P, v(sd * 0.117, 0.0, 0.0), rd, Y(), 0.08, "762");
  grip(P, 1);
  // Solid stock behind, tapering down to a butt pad.
  loftZ(P, [[-1.0, octRing(0.07, 0.17, 0.03), -0.04], [-0.95, octRing(0.08, 0.18, 0.03), -0.03], [-0.3, octRing(0.085, 0.11, 0.03), 0.02]], "secondary");
  plate(P, v(0, -0.04, -1.01), X(), Y(), 0.15, 0.34, 0.03, "dark", { bevel: 0.01 });
  // Curved box magazine ahead of the grip: two angled lengths.
  prism(P, v(0, -0.1, 0.33), v(0, -0.3, 0.38), octRing(0.055, 0.1, 0.015), "dark", Z());
  prism(P, v(0, -0.3, 0.38), v(0, -0.46, 0.5), octRing(0.055, 0.1, 0.015), "dark", Z());
  // The scope on two rings, lit lens forward.
  lathe(P, v(0, 0.3, -0.05), Z(), [[0, 0], [0, 0.06], [0.06, 0.075], [0.42, 0.075], [0.5, 0.085], [0.5, 0]], "dark", { n: 10 });
  for (const z of [0.05, 0.35]) plate(P, v(0, 0.215, z), X(), Y(), 0.06, 0.1, 0.04, "mechanical", { bevel: 0 });
  lathe(P, v(0, 0.3, 0.45), Z(), [[0, 0], [0, 0.075], [0.006, 0.075], [0.006, 0]], "visor", { n: 10 });
  B.socket("Glow_0", v(0, 0.3, 0.46));
  // The recoiling barrel group: a slab handguard round its back part, the barrel, a slotted brake.
  const T = B.piece("Recoil", v());
  loftZ(T, [[0.6, octRing(0.085, 0.085, 0.025)], [1.2, octRing(0.08, 0.08, 0.025)]], "secondary", { y0: yb - 0.01 });
  boltRow(T, v(sd * 0.086, yb + 0.03, 0.68), v(sd * 0.086, yb + 0.03, 1.12), 4, B.out, 0.01);
  barrelZ(T, yb, 0.6, 1.95, 0.045);
  lathe(T, v(0, yb, 1.92), Z(), [[0, 0], [0, 0.07], [0.02, 0.08], [0.16, 0.08], [0.17, 0.06], [0.17, 0]], "dark", { n: 8, phase: Math.PI / 8 });
  for (let i = 0; i < 2; i++) for (const s of [1, -1]) plate(T, v(s * 0.082, yb, 1.97 + i * 0.06), v(0, 0, -s), Y(), 0.025, 0.1, 0.01, "mechanical", { bevel: 0 });
  B.socket("Recoil/Muzzle_0", v(0, yb, 2.1), Z());
  B.socket("Laser", v(sd * 0.1, yb + 0.06, 1.2), Z());
  B.move({ node: "Recoil", kind: "slide", travel: 0.08 });
  B.socket("Grip_R", v(0, -0.2, -0.03));
  B.socket("Grip_L", v(0, yb - 0.1, 0.9));
  B.socket("Mount", v());
  return B.def();
}

/** SMG: a stubby receiver, a perforated shroud over a short barrel, a long stick magazine, a folded wire stock. */
export function smgHeld(sd: 1 | -1 = -1, seed = 32): ModelDef {
  const B = new Build(seed, 1, sd), P = B.piece("Body"), o = B.out, rd = B.read;
  const yb = 0.08;
  loftZ(P, [[-0.25, octRing(0.12, 0.14, 0.04)], [-0.2, octRing(0.13, 0.16, 0.04)], [0.5, octRing(0.13, 0.16, 0.04)], [0.56, octRing(0.115, 0.14, 0.035)]], "plating", { y0: 0.04 });
  stencilDigits(P, v(sd * 0.131, 0.06, 0.1), rd, Y(), 0.08, "9");
  hazard(P, v(sd * 0.131, -0.06, 0.32), rd, Y(), 0.18, 0.04, 4);
  grip(P, 1);
  // The stick magazine: long and straight down ahead of the grip (the tell from above: it sticks out under the arm).
  prism(P, v(0, -0.1, 0.32), v(0, -0.62, 0.36), octRing(0.05, 0.075, 0.015), "dark", Z());
  plate(P, v(0, -0.63, 0.36), Y().negate(), Z(), 0.12, 0.18, 0.03, "mechanical", { bevel: 0 });
  // Folded wire stock along the outboard flank, the butt plate hooked over the back.
  for (const y of [0.11, -0.05]) prism(P, v(sd * 0.15, y, 0.3), v(sd * 0.15, y, -0.55), octRing(0.015, 0.015, 0.005), "mechanical");
  plate(P, v(sd * 0.1, 0.03, -0.56), X(), Y(), 0.12, 0.24, 0.03, "dark", { bevel: 0.01 });
  // A top rail with a small sight block.
  plate(P, v(0, 0.205, 0.15), Y(), Z(), 0.06, 0.5, 0.02, "dark", { bevel: 0 });
  plate(P, v(0, 0.24, 0.3), X(), Y(), 0.08, 0.06, 0.1, "mechanical", { bevel: 0.01 });
  // The recoiling barrel: a perforated shroud, the barrel poking out, a compensator.
  const T = B.piece("Recoil", v());
  lathe(T, v(0, yb, 0.55), Z(), [[0, 0], [0, 0.085], [0.45, 0.085], [0.48, 0.07], [0.48, 0]], "secondary", { n: 10 });
  for (let i = 0; i < 4; i++) for (const s of [1, -1]) plate(T, v(s * 0.086, yb, 0.62 + i * 0.1), v(0, 0, -s), Y(), 0.035, 0.05, 0.004, "dark", { bevel: 0 });
  barrelZ(T, yb, 1.0, 1.15, 0.035);
  lathe(T, v(0, yb, 1.12), Z(), [[0, 0], [0, 0.055], [0.1, 0.055], [0.1, 0]], "dark", { n: 8, phase: Math.PI / 8 });
  heatRings(T, v(0, yb, 0.58), Z(), 0.085, 0.095, 2, 0.08, "dark", 10);
  B.socket("Recoil/Muzzle_0", v(0, yb, 1.24), Z());
  B.move({ node: "Recoil", kind: "slide", travel: 0.06 });
  void o;
  B.socket("Grip_R", v(0, -0.2, -0.03));
  B.socket("Mount", v());
  return B.def();
}

/** Scattergun: two fat barrels one over the other, a ribbed pump fore-end, a drum under the receiver, a solid stock. */
export function shotgunHeld(sd: 1 | -1 = -1, seed = 33): ModelDef {
  const B = new Build(seed, 1.1, sd), P = B.piece("Body"), rd = B.read;
  loftZ(P, [[-0.28, octRing(0.12, 0.15, 0.04)], [-0.22, octRing(0.135, 0.17, 0.045)], [0.55, octRing(0.135, 0.17, 0.045)], [0.6, octRing(0.12, 0.15, 0.04)]], "plating", { y0: 0.03 });
  stencilDigits(P, v(sd * 0.136, 0.08, 0.15), rd, Y(), 0.09, "12");
  grip(P, 1);
  // The drum magazine under the receiver, lying across.
  const dc = v(0, -0.2, 0.32);
  lathe(P, dc.clone().add(v(-0.11, 0, 0)), X(), [[0, 0], [0, 0.17], [0.02, 0.19], [0.2, 0.19], [0.22, 0.17], [0.22, 0]], "secondary", { n: 14 });
  lathe(P, dc.clone().add(v(0.11, 0, 0)), X(), [[0, 0], [0, 0.07], [0.02, 0.06], [0.02, 0]], "mechanical", { n: 8 });
  // Solid stock.
  loftZ(P, [[-0.95, octRing(0.075, 0.18, 0.03), -0.06], [-0.9, octRing(0.085, 0.19, 0.03), -0.05], [-0.28, octRing(0.09, 0.12, 0.03), 0]], "secondary");
  plate(P, v(0, -0.06, -0.96), X(), Y(), 0.16, 0.36, 0.03, "dark", { bevel: 0.01 });
  // The barrels (Recoil): over and under, a pump with ribs round the lower one, a bead sight.
  const T = B.piece("Recoil", v());
  for (const y of [0.11, -0.05]) {
    barrelZ(T, y, 0.55, 1.75, 0.065);
    lathe(T, v(0, y, 1.72), Z(), [[0, 0], [0, 0.085], [0.06, 0.085], [0.06, 0]], "dark", { n: 10 });
  }
  B.socket("Recoil/Muzzle_0", v(0, 0.11, 1.8), Z());
  B.socket("Recoil/Muzzle_1", v(0, -0.05, 1.8), Z());
  loftZ(T, [[0.75, octRing(0.1, 0.075, 0.03)], [1.2, octRing(0.1, 0.075, 0.03)]], "dark", { y0: -0.07 });
  for (let i = 0; i < 5; i++) loftZ(T, [[0.8 + i * 0.08, octRing(0.105, 0.08, 0.03)], [0.83 + i * 0.08, octRing(0.105, 0.08, 0.03)]], "secondary", { y0: -0.07 });
  plate(T, v(0, 0.18, 1.7), Y(), Z(), 0.03, 0.04, 0.02, "trim", { bevel: 0 });
  B.move({ node: "Recoil", kind: "slide", travel: 0.1 });
  B.socket("Grip_R", v(0, -0.2, -0.03));
  B.socket("Grip_L", v(0, -0.08, 1.0));
  B.socket("Mount", v());
  return B.def();
}

export type { V3 };
