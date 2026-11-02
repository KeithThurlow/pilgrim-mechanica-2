// Code-built models for the round guns' hull weapons (Keith 2026-11-02, src/weapons/guns.ts), built so their weight sits
// behind the shoulder (Keith 2026-11-02: magazines, feeds, casings and counterweights behind, less barrel out front):
// - flak-hull: a squat receiver with a big flat pan magazine on top behind the shoulder (it reads from the game
//   camera), a feed throat into the breech, three short wide barrels in a clamped triangle, hot vents, a casing chute.
// - sniper-hull: the longshot rifle: a long receiver with the bolt housing and a box magazine behind the shoulder, a
//   recoil-buffered butt block as the counterweight, a big scope over the shoulder, then a fluted barrel to 4 m.
// Root at the shoulder joint (Mount), the gun's axis about 1 m outboard. Recoil slides back on a shot.
import { Build, v, X, Y, Z, lathe, loftZ, octRing, plate, prism, bolt, boltRow, boltCircle, hazard, stencilDigits, louvres, lightStrip, heatRings } from "../kit";
import { cowl, laserEmitter, readyLamp, trunnion } from "./common";
import type { ModelDef } from "../parts";

/** Flak cannon (hull). */
export function flakHull(sd: 1 | -1 = -1, seed = 21): ModelDef {
  const B = new Build(seed, 2, sd), P = B.piece("Body"), o = B.out, rd = B.read;
  // The receiver: squat and wide, most of it behind the shoulder.
  cowl(P, -1.2, 0.35, 0.5, 0.42, 0);
  trunnion(B, P, 0.17, 0.55, v(-sd * 0.48, 0, 0));
  boltRow(P, v(sd * 0.5, 0.3, -1.05), v(sd * 0.5, 0.3, 0.2), 5, o, 0.02);
  stencilDigits(P, v(sd * 0.505, 0.02, -0.55), rd, Y(), 0.2, "40");
  hazard(P, v(sd * 0.505, -0.28, -0.1), rd, Y(), 0.5, 0.08, 6);
  // Hot vents along the outboard flank (they glow after a burst).
  P.heatAt = () => 1;
  for (let i = 0; i < 3; i++) plate(P, v(sd * 0.5, 0.12 - i * 0.12, 0.1), rd.clone().negate(), Y(), 0.5, 0.05, 0.03, "lighting", { bevel: 0 });
  P.heatAt = () => 0;
  // The pan magazine: a big flat drum lying on top, behind the shoulder, with a hub, ribs and a feed throat forward.
  const pan = v(0, 0.5, -0.72), pr = 0.66;
  lathe(P, pan, Y(), [[0, 0], [0, pr * 0.92], [0.03, pr], [0.24, pr], [0.27, pr * 0.9], [0.27, 0]], "secondary", { n: 18, secs: ["secondary", "secondary", "plating", "secondary", "secondary"] });
  lathe(P, pan.clone().add(v(0, 0.27, 0)), Y(), [[0, 0], [0, 0.16], [0.07, 0.14], [0.07, 0]], "mechanical", { n: 10 });
  boltCircle(P, pan.clone().add(v(0, 0.272, 0)), Y(), 0.11, 6, 0.018);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, d = v(Math.cos(a), 0, Math.sin(a));
    prism(P, pan.clone().add(v(0, 0.272, 0)).addScaledVector(d, 0.18), pan.clone().add(v(0, 0.272, 0)).addScaledVector(d, pr * 0.86), octRing(0.025, 0.012, 0.005), "dark");
  }
  loftZ(P, [[-0.25, octRing(0.16, 0.12, 0.04)], [0.05, octRing(0.14, 0.1, 0.03)]], "dark", { y0: 0.48 });
  readyLamp(P, v(-sd * 0.3, 0.42, 0.2), Y(), 0.03);
  B.socket("Glow_1", v(-sd * 0.3, 0.45, 0.2));
  // Casings drop out of a chute under the breech.
  prism(P, v(-sd * 0.1, -0.42, -0.35), v(-sd * 0.1, -0.6, -0.5), octRing(0.12, 0.09, 0.03), "dark");
  B.socket("Eject", v(-sd * 0.1, -0.62, -0.52), Y().negate());
  // Counterweight plate at the back.
  plate(P, v(0, 0, -1.21), X(), Y(), 0.8, 0.66, 0.1, "secondary", { bevel: 0.03 });
  for (const x of [-0.25, 0.25]) for (const y of [-0.2, 0.2]) bolt(P, v(x, y, -1.315), Z().negate(), 0.028);
  laserEmitter(B, P, v(sd * 0.32, -0.3, 0.5), 0.05);
  // Three short wide barrels in a triangle, clamped, flash hiders at the mouths (Recoil).
  const T = B.piece("Recoil", v());
  const tri: [number, number][] = [[0, 0.16], [0.15, -0.1], [-0.15, -0.1]];
  T.heatAt = (p) => (p.z > 1.2 ? Math.min(1, (p.z - 1.2) / 0.7) : 0);
  tri.forEach(([x, y], i) => {
    lathe(T, v(x, y, 0.4), Z(), [[0, 0], [0, 0.1], [1.35, 0.095], [1.35, 0]], "mechanical", { n: 10 });
    lathe(T, v(x, y, 1.62), Z(), [[0, 0], [0, 0.12], [0.08, 0.135], [0.28, 0.135], [0.3, 0.11], [0.3, 0.07], [0.22, 0.065], [0.22, 0]], "dark", { n: 8, phase: Math.PI / 8 });
    B.socket(`Recoil/Muzzle_${i}`, v(x, y, 1.95), Z());
  });
  T.heatAt = () => 0;
  for (const z of [0.7, 1.3]) lathe(T, v(0, 0.02, z), Z(), [[0, 0.3], [0, 0.34], [0.12, 0.34], [0.12, 0.3]], "secondary", { n: 12, ring: true });
  heatRings(T, v(0, 0.02, 0.42), Z(), 0.28, 0.32, 3, 0.2, "dark", 12);
  B.move({ node: "Recoil", kind: "slide", travel: 0.18 });
  B.socket("Mount", v(-sd * 1.0, 0, 0));
  return B.def();
}

/** Longshot rifle (hull). */
export function sniperHull(sd: 1 | -1 = -1, seed = 22): ModelDef {
  const B = new Build(seed, 2, sd), P = B.piece("Body"), o = B.out, rd = B.read;
  // A long receiver from the butt to just ahead of the shoulder.
  cowl(P, -1.25, 0.5, 0.3, 0.3, 0);
  trunnion(B, P, 0.15, 0.5, v(-sd * 0.28, 0, 0));
  louvres(P, v(sd * 0.305, 0.04, -0.15), rd.clone().negate(), Y(), 0.5, 0.3, 5);
  boltRow(P, v(sd * 0.3, 0.22, -1.1), v(sd * 0.3, 0.22, 0.35), 6, o, 0.016);
  stencilDigits(P, v(sd * 0.305, 0.05, -0.8), rd, Y(), 0.16, "127");
  // The bolt housing: a raised block on the outboard side with the bolt handle sticking out.
  loftZ(P, [[-0.85, octRing(0.1, 0.12, 0.03)], [-0.25, octRing(0.1, 0.12, 0.03)]], "mechanical", { x0: sd * 0.36, y0: 0.05 });
  prism(P, v(sd * 0.44, 0.08, -0.4), v(sd * 0.62, 0.0, -0.45), octRing(0.03, 0.03, 0.01), "dark");
  lathe(P, v(sd * 0.62, 0.0, -0.45), o, [[0, 0], [0, 0.06], [0.08, 0.06], [0.08, 0]], "dark", { n: 8 });
  // The box magazine under the receiver, behind the shoulder; a spare clipped to its side.
  loftZ(P, [[-0.85, octRing(0.16, 0.24, 0.04)], [-0.35, octRing(0.16, 0.24, 0.04)]], "secondary", { y0: -0.46 });
  hazard(P, v(sd * 0.165, -0.5, -0.6), rd, Y(), 0.4, 0.06, 5);
  // The butt block: a buffered counterweight at the back, a pad and two buffer rods.
  loftZ(P, [[-1.9, octRing(0.26, 0.36, 0.08, 0.02)], [-1.3, octRing(0.3, 0.38, 0.09, 0.02)]], "plating", { y0: -0.04 });
  plate(P, v(0, -0.04, -1.91), X(), Y(), 0.46, 0.62, 0.06, "dark", { bevel: 0.02 });
  for (const y of [0.14, -0.2]) lathe(P, v(0, y, -1.32), Z(), [[0, 0], [0, 0.05], [0.12, 0.05], [0.12, 0]], "mechanical", { n: 8 });
  lightStrip(P, v(-sd * 0.15, 0.31, -0.95), Z(), X(), 0.28, 0.03);
  readyLamp(P, v(-sd * 0.15, 0.31, -0.6), Y(), 0.028);
  // The scope over the shoulder: a long tube on two rings, a lit lens forward, a sunshade.
  lathe(P, v(0, 0.52, -0.95), Z(), [[0, 0], [0, 0.11], [0.1, 0.13], [1.1, 0.13], [1.25, 0.16], [1.45, 0.16], [1.45, 0]], "dark", { n: 12 });
  for (const z of [-0.65, 0.05]) plate(P, v(0, 0.36, z), X(), Y(), 0.12, 0.2, 0.08, "mechanical", { bevel: 0.01 });
  lathe(P, v(0, 0.52, 0.51), Z(), [[0, 0], [0, 0.14], [0.01, 0.14], [0.01, 0]], "visor", { n: 12 });
  B.socket("Glow_0", v(0, 0.52, 0.53));
  B.socket("Laser", v(0, 0.52, 0.54), Z());
  // The barrel (Recoil): a heavy chamber, three fluted lengths thinning out, a wide three-port brake.
  const T = B.piece("Recoil", v());
  loftZ(T, [[-1.2, octRing(0.16, 0.16, 0.05)], [0.55, octRing(0.16, 0.16, 0.05)]], "mechanical");
  T.heatAt = (p) => Math.max(0, Math.min(1, (p.z - 2.2) / 1.5));
  lathe(T, v(0, 0, 0.5), Z(), [[0, 0], [0, 0.15], [0.5, 0.13], [1.2, 0.11], [2.2, 0.09], [3.15, 0.08], [3.15, 0]], "mechanical", { n: 12 });
  const zb = 3.6;
  lathe(T, v(0, 0, zb), Z(), [[0, 0], [0, 0.15], [0.05, 0.17], [0.35, 0.17], [0.4, 0.13], [0.4, 0]], "dark", { n: 8, phase: Math.PI / 8 });
  for (let i = 0; i < 3; i++) for (const s of [1, -1]) plate(T, v(s * 0.175, 0, zb + 0.1 + i * 0.1), v(0, 0, -s), Y(), 0.05, 0.22, 0.02, "mechanical", { bevel: 0 });
  T.heatAt = () => 0;
  for (const z of [1.0, 1.8, 2.6]) lathe(T, v(0, 0, z), Z(), [[0, 0.1], [0, 0.14], [0.06, 0.14], [0.06, 0.1]], "secondary", { n: 10, ring: true });
  B.move({ node: "Recoil", kind: "slide", travel: 0.25 });
  B.socket("Recoil/Muzzle_0", v(0, 0, zb + 0.42), Z());
  B.socket("Mount", v(-sd * 0.95, 0, 0));
  return B.def();
}
