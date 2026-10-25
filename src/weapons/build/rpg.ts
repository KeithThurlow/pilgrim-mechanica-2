// Code stand-ins for docs/asset-list.md W1, the RPG rocket launchers (Keith 2026-10-25, explosives first):
// - hull (rocket-launcher-hull): replaces an arm. One fat tube in an armoured cowl, the warhead's bright nose out of
//   the muzzle, a flared backblast vent behind with a Lid that flaps open, a sight box, hazard stripes, a laser.
//   Root at the trunnion on the tube's axis (the gun side's pivot).
// - shoulder (rocket-launcher-shoulder): two tubes on a yoke over a pedestal that elevates (Launcher hinge).
//   Root at the pedestal's foot.
// Moving: Recoil (back 0.15 m), Lid, Missile_n (the loaded rockets; hide them once fired). Sockets: Muzzle_n,
// Laser, Mount, Glow_n (bore and vent heat, the ready lamp).
import { Build, Piece, v, X, Y, Z, lathe, loftZ, octRing, plate, boltRow, boltCircle, hazard, chevrons, stencilDigits, serrations, prism, ribbedHose, bezier, lightStrip, type V3 } from "../kit";
import { cowl, laserEmitter, readyLamp, rocket, trunnion } from "./common";
import type { ModelDef } from "../parts";

/** One launch tube along +Z from z0 to z1 (outer radius r) at c: bands, a flared lip, the bore; a backblast vent. */
export function launchTube(P: Piece, c: V3, z0: number, z1: number, r: number, venturi = true) {
  const L = z1 - z0, b = "secondary" as const, d = "dark" as const;
  P.heatAt = (p) => (p.z > c.z + z1 - 0.3 && Math.hypot(p.x - c.x, p.y - c.y) < r * 0.95 ? 1 : 0);
  lathe(P, v(c.x, c.y, c.z + z0), Z(), [
    [0, 0], [0, r * 0.9], [L * 0.04, r], [L * 0.22, r], [L * 0.22, r * 1.1], [L * 0.27, r * 1.1], [L * 0.27, r],
    [L * 0.62, r], [L * 0.62, r * 1.1], [L * 0.67, r * 1.1], [L * 0.67, r], [L * 0.93, r], [L * 0.95, r * 1.16], [L, r * 1.16],
    [L, r * 0.84], [L - r * 1.2, r * 0.82], [L - r * 1.2, 0],
  ], "plating", { n: 14, secs: ["plating", "plating", "plating", b, b, b, "plating", "trim", "trim", "trim", "plating", "mechanical", "mechanical", d, d, d] });
  P.heatAt = () => 0;
  if (!venturi) return;
  P.heatAt = (p) => (p.z < c.z + z0 - r * 0.6 ? 0.8 : 0);
  lathe(P, v(c.x, c.y, c.z + z0), Z().negate(), [
    [0, 0], [0, r * 0.74], [r * 0.5, r * 0.64], [r * 1.6, r * 1.18], [r * 1.75, r * 1.26], [r * 1.75, r * 1.04], [r * 1.0, r * 0.5], [r * 1.0, 0],
  ], "mechanical", { n: 14, secs: ["mechanical", "mechanical", "mechanical", "mechanical", "mechanical", d, d] });
  P.heatAt = () => 0;
}

/** The blast cover on a vent's mouth: a disc hanging from a hinge on its top edge (the part's pivot). */
function lid(B: Build, name: string, c: V3, R: number, parent?: string) {
  const hinge = v(c.x, c.y + R * 1.05, c.z - 0.01);
  const L = B.piece(name, hinge, parent);
  lathe(L, v(c.x, c.y, c.z - 0.01), Z().negate(), [[0, 0], [0, R * 1.08], [R * 0.08, R * 1.08], [R * 0.12, R * 0.9], [R * 0.12, 0]], "secondary", { n: 14 });
  hazard(L, v(c.x, c.y, c.z - 0.01 - R * 0.125), X(), Y(), R * 1.2, R * 0.36, 6, "trim", "dark");
  lathe(L, hinge, X(), [[-R * 0.3, 0], [-R * 0.3, R * 0.09], [R * 0.3, R * 0.09], [R * 0.3, 0]], "mechanical", { n: 8 });
  B.move({ node: name, kind: "hinge", angleDeg: 100 });
}

/** Hull RPG launcher in place of an arm: a 0.5 m tube, 2.8 m long, in an armoured cowl. */
export function rocketLauncherHull(sd: 1 | -1 = -1, seed = 1): ModelDef {
  const B = new Build(seed, 1.8, sd), P = B.piece("Body"), o = B.out, rd = B.read;
  const r = 0.25, z0 = -1.05, z1 = 1.75;
  // The cowl round the breech, with the trunnion boss inboard: static.
  cowl(P, -0.75, 0.55, 0.42, 0.34, -0.05);
  plate(P, v(sd * 0.42, -0.02, -0.12), rd.clone().negate(), Y(), 0.95, 0.42, 0.05, "secondary");
  stencilDigits(P, v(sd * 0.475, 0.0, -0.12), rd, Y(), 0.22, "07");
  boltRow(P, v(sd * 0.425, 0.24, -0.62), v(sd * 0.425, 0.24, 0.4), 5, o, 0.022);
  boltRow(P, v(sd * 0.425, -0.26, -0.62), v(sd * 0.425, -0.26, 0.2), 4, o, 0.022);
  chevrons(P, v(0, 0.345, 0.1), Z(), X(), 0.42, 0.16, 3, "trim");
  trunnion(B, P, 0.16, 0.5, v(-sd * 0.4, 0, -0.1));
  const sightC = v(sd * 0.18, 0.4, -0.05);
  loftZ(P, [[-0.32, octRing(0.09, 0.08, 0.03)], [0.12, octRing(0.09, 0.08, 0.03)], [0.18, octRing(0.075, 0.066, 0.025)]], "dark", { x0: sightC.x, y0: sightC.y });
  lathe(P, v(sightC.x, sightC.y, 0.18), Z(), [[0, 0], [0, 0.05], [0.02, 0.045], [0.025, 0]], "visor", { n: 8 });
  readyLamp(P, v(sightC.x, sightC.y + 0.08, -0.26), Y(), 0.03);
  B.socket("Glow_2", v(sightC.x, sightC.y + 0.11, -0.26));
  lightStrip(P, v(-sd * 0.2, 0.345, -0.4), Z(), X(), 0.3, 0.035);
  laserEmitter(B, P, v(sd * 0.12, -r - 0.07, 0.62), 0.06);
  ribbedHose(P, bezier(v(-sd * 0.2, -0.3, -0.7), v(-sd * 0.25, -0.42, -0.95), v(-sd * 0.15, -0.3, -1.15), v(0, -r * 0.8, -1.05), 10), 0.035, 0.08, "dark", "mechanical", 8);
  // The recoiling tube: bands, heat shield, hazard band at the muzzle, the vent and its lid; the rocket rides it.
  const T = B.piece("Recoil", v());
  launchTube(T, v(), z0, z1, r);
  plate(T, v(0, r + 0.03, 1.0), Z(), X(), 0.75, 0.3, 0.035, "secondary", { bevel: 0.015 });
  serrations(T, v(0, r + 0.065, 1.0), Z(), X(), 0.7, 0.24, 9, 0.025, "dark");
  B.move({ node: "Recoil", kind: "slide", travel: 0.15 });
  lid(B, "Lid", v(0, 0, z0 - r * 1.75), r * 1.26, "Recoil");
  const tail = z1 - 0.55;
  const R = B.piece("Missile_0", v(0, 0, tail), "Recoil");
  rocket(R, v(0, 0, tail), r * 0.62, 1.25, { bulb: 1.62 });
  B.move({ node: "Missile_0", kind: "slide", travel: 1.2, axis: [0, 0, 1] });
  B.socket("Recoil/Muzzle_0", v(0, 0, z1 + 0.7), Z());
  B.socket("Recoil/Glow_0", v(0, 0, z1 - 0.1));
  B.socket("Recoil/Glow_1", v(0, 0, z0 - r * 1.2));
  B.socket("Mount", v(-sd * 0.9, 0, -0.1));
  return B.def();
}

/** Shoulder RPG: two tubes on a yoke over a pedestal; the Launcher elevates, its tubes recoil together. */
export function rocketLauncherShoulder(sd: 1 | -1 = -1, seed = 2): ModelDef {
  const B = new Build(seed, 1.2, sd), P = B.piece("Body");
  lathe(P, v(0, 0, 0), Y(), [[0, 0], [0, 0.34], [0.06, 0.34], [0.08, 0.3], [0.16, 0.26], [0.2, 0.28], [0.26, 0.28], [0.26, 0]], "secondary", { n: 14, secs: ["secondary", "secondary", "secondary", "mechanical", "mechanical", "mechanical", "mechanical"] });
  boltCircle(P, v(0, 0.06, 0), Y(), 0.29, 10, 0.016);
  const pivotY = 0.55;
  for (const s of [1, -1]) {
    prism(P, v(s * 0.38, 0.2, -0.05), v(s * 0.38, pivotY + 0.08, -0.05), octRing(0.035, 0.16, 0.05), "plating", Z(), octRing(0.035, 0.12, 0.05));
    lathe(P, v(s * 0.36, pivotY, -0.05), v(s, 0, 0), [[0, 0], [0, 0.09], [0.06, 0.09], [0.07, 0.06], [0.07, 0]], "mechanical", { n: 10 });
  }
  plate(P, v(0, 0.24, -0.05), X(), Z().negate(), 0.8, 0.3, 0.05, "plating", { bevel: 0.02 });
  const piv = v(0, pivotY, -0.05);
  const Lc = B.piece("Launcher", piv);
  // Frame between the tubes: a saddle, strap bands, a top plate with markings, the ready lamp and the laser.
  loftZ(Lc, [[-0.5, octRing(0.14, 0.12, 0.04)], [0.4, octRing(0.14, 0.12, 0.04)]], "plating", { y0: pivotY + 0.02 });
  for (const s of [1, -1]) lathe(Lc, v(s * 0.33, pivotY, -0.05), v(-s, 0, 0), [[0, 0], [0, 0.07], [0.06, 0.07], [0.06, 0]], "dark", { n: 8 });
  readyLamp(Lc, v(0, pivotY - 0.1, -0.5), Z().negate(), 0.026);
  B.socket("Launcher/Glow_2", v(0, pivotY - 0.1, -0.53));
  laserEmitter(B, Lc, v(0, pivotY - 0.12, 0.25), 0.045, "Launcher/");
  const T = B.piece("Recoil", piv, "Launcher");
  const r = 0.15, z0 = -0.75, z1 = 0.95;
  for (const s of [1, -1]) launchTube(T, v(s * 0.16, pivotY + 0.02, -0.05), z0, z1, r);
  for (const z of [-0.45, 0.35]) lathe(T, v(0, pivotY + 0.02, z - 0.05), Z(), [[0, 0.18], [0, 0.205], [0.1, 0.205], [0.1, 0.18]], "dark", { n: 6, ring: true });
  plate(T, v(0, pivotY + 0.16, -0.1), Z(), X(), 0.7, 0.14, 0.03, "secondary", { bevel: 0.012 });
  hazard(T, v(0, pivotY + 0.192, 0.12), X().negate(), Z(), 0.12, 0.25, 5, "trim", "dark");
  stencilDigits(T, v(0, pivotY + 0.195, -0.28), X().negate(), Z(), 0.12, "2");
  B.move({ node: "Recoil", kind: "slide", travel: 0.15 });
  lid(B, "Lid", v(0, pivotY + 0.02, -0.05 + z0 - r * 1.75), 0.3, "Recoil");
  for (let i = 0; i < 2; i++) {
    const x = (i === 0 ? 1 : -1) * 0.16, tail = z1 - 0.35;
    const R = B.piece(`Missile_${i}`, v(x, pivotY + 0.02, -0.05 + tail), "Recoil");
    rocket(R, v(x, pivotY + 0.02, -0.05 + tail), r * 0.62, 0.8, { bulb: 1.6 });
    B.move({ node: `Missile_${i}`, kind: "slide", travel: 0.8, axis: [0, 0, 1] });
    B.socket(`Recoil/Muzzle_${i}`, v(x, pivotY + 0.02, -0.05 + z1 + 0.45), Z());
    B.socket(`Recoil/Glow_${i}`, v(x, pivotY + 0.02, -0.05 + z0 - r));
  }
  B.move({ node: "Launcher", kind: "hinge", angleDeg: -25 });
  B.socket("Mount", v());
  return B.def();
}

/** The projectile (rocket.glb stand-in): tail at the origin, nose along +Z; Glow_0 at the motor. */
export function rocketProjectile(): ModelDef {
  const B = new Build(3, 0.8), P = B.piece("Body");
  rocket(P, v(), 0.1, 0.85, { bulb: 1.7, n: 8, fuze: false });
  B.socket("Glow_0", v(0, 0, -0.02), Z().negate());
  return B.def();
}

/** The missile projectile (missile.glb stand-in): slimmer than the rocket, a pointed nose, four fins. */
export function missileProjectile(): ModelDef {
  const B = new Build(4, 0.6), P = B.piece("Body");
  rocket(P, v(), 0.06, 0.7, { bulb: 1.0, n: 6, fuze: false, warhead: "secondary", band: "trim" });
  B.socket("Glow_0", v(0, 0, -0.02), Z().negate());
  return B.def();
}
