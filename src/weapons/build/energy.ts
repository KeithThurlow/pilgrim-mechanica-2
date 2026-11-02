// Code stand-ins for the energy weapons (docs/asset-list.md P3; Keith's list 2026-10-25), both hull guns:
// - plasma-cannon-hull: a glowing containment core (visor glass, a Spin ring cage round it), accelerator rings that
//   light up (lamp sections), a short wide emitter barrel with prongs, ribbed coolant hoses.
// - laser-projector-hull: an optical housing with deep cooling fins, a big lens (visor) in a hooded bezel, focusing
//   rings, a Spin lens turret that turns slowly while it fires.
// - orb-hull: the particle orb: a big glass containment sphere in a ring cage behind the shoulder, a coolant tank,
//   and a short flared launch bell.
// - arc-hull: the arc caster: a stack of capacitor discs on a mast behind the shoulder, a coil, two forked
//   electrodes reaching forward with lit tips.
// Weight behind the shoulder (Keith 2026-11-02): cores, cells and coolant sit behind the joint, the emitters are short.
// Root at the shoulder joint (Mount), the axis about 0.95 m outboard. Glow_n at the core, rings and lens.
import { Build, Piece, v, X, Y, Z, lathe, loftZ, octRing, plate, bolt, boltRow, boltCircle, hazard, stencilDigits, prism, ribbedHose, tube, bezier, louvres, lightStrip, sellRing, type V3 } from "../kit";
import { cowl, readyLamp, trunnion } from "./common";
import type { ModelDef } from "../parts";

/** A coolant tank lying fore and aft: a capsule with bands and an end valve. */
function tank(P: Piece, c: V3, r: number, len: number) {
  lathe(P, c, Z(), [[0, 0], [0, r * 0.5], [r * 0.3, r * 0.92], [r * 0.6, r], [len - r * 0.6, r], [len - r * 0.3, r * 0.92], [len, r * 0.5], [len, 0]], "secondary", { n: 12 });
  for (const t of [0.25, 0.75]) lathe(P, c.clone().add(v(0, 0, len * t - 0.03)), Z(), [[0, r], [0, r * 1.08], [0.06, r * 1.08], [0.06, r]], "dark", { n: 12, ring: true });
  lathe(P, c, Z().negate(), [[0, 0], [0, r * 0.25], [0.08, r * 0.25], [0.08, 0]], "mechanical", { n: 8 });
}

/** Hull plasma cannon (and the nova lance): the containment core behind the shoulder, a short accelerator ahead. */
export function plasmaCannonHull(sd: 1 | -1 = -1, seed = 12): ModelDef {
  const B = new Build(seed, 1.8, sd), P = B.piece("Body"), o = B.out, rd = B.read;
  // The housing round the shoulder, the core's frame behind it, a coolant tank at the back.
  cowl(P, -0.45, 0.35, 0.44, 0.38, 0);
  trunnion(B, P, 0.16, 0.5, v(-sd * 0.42, 0, 0));
  louvres(P, v(sd * 0.445, 0, -0.05), rd.clone().negate(), Y(), 0.5, 0.4, 5);
  stencilDigits(P, v(0, 0.385, -0.05), X().negate(), Z(), 0.16, "9");
  boltRow(P, v(sd * 0.44, 0.29, -0.4), v(sd * 0.44, 0.29, 0.3), 4, o, 0.02);
  readyLamp(P, v(-sd * 0.25, 0.385, 0.1), Y(), 0.03);
  // The containment core: a glass bulb (visor) between two collars behind the shoulder, struts round it.
  const zc = -1.15;
  lathe(P, v(0, 0, zc - 0.14), Z(), [[0, 0], [0, 0.36], [0.14, 0.38], [0.14, 0]], "secondary", { n: 14 });
  lathe(P, v(0, 0, zc), Z(), [[0, 0], [0, 0.24], [0.2, 0.36], [0.5, 0.36], [0.7, 0.24], [0.7, 0]], "visor", { n: 14 });
  lathe(P, v(0, 0, zc + 0.68), Z(), [[0, 0], [0, 0.38], [0.14, 0.38], [0.14, 0]], "secondary", { n: 14 });
  B.socket("Glow_0", v(0, 0, zc + 0.35));
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4, d = v(Math.cos(a), Math.sin(a), 0);
    prism(P, d.clone().multiplyScalar(0.34).setZ(zc), d.clone().multiplyScalar(0.34).setZ(zc + 0.7), octRing(0.035, 0.035, 0.01), "mechanical");
  }
  tank(P, v(sd * 0.05, 0.42, -1.45), 0.16, 0.95);
  plate(P, v(0, 0, zc - 0.2), X(), Y(), 0.7, 0.7, 0.08, "dark", { bevel: 0.02 });
  hazard(P, v(sd * 0.39, -0.22, zc + 0.35), rd, Y(), 0.4, 0.08, 6);
  // A cage that spins round the core while charging.
  const S = B.piece("Spin", v(0, 0, zc + 0.35));
  for (const z of [0.05, 0.35, 0.62]) lathe(S, v(0, 0, zc + z - 0.02), Z(), [[0, 0.39], [0, 0.42], [0.04, 0.42], [0.04, 0.39]], "mechanical", { n: 14, ring: true });
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3, d = v(Math.cos(a), Math.sin(a), 0);
    prism(S, d.clone().multiplyScalar(0.405).setZ(zc + 0.03), d.clone().multiplyScalar(0.405).setZ(zc + 0.64), octRing(0.015, 0.015, 0.005), "dark");
  }
  B.move({ node: "Spin", kind: "spin", rpm: 90 });
  // Accelerator: rings that glow, then a short wide emitter with four prongs (Recoil).
  const T = B.piece("Recoil", v());
  T.heatAt = (p) => (p.z > 1.15 ? 0.8 : 0);
  lathe(T, v(0, 0, 0.3), Z(), [[0, 0], [0, 0.2], [0.85, 0.2], [0.85, 0.26], [1.0, 0.3], [1.0, 0.22], [0.9, 0.2], [0.9, 0]], "mechanical", { n: 12, secs: ["mechanical", "mechanical", "dark", "dark", "dark", "dark", "dark"] });
  T.heatAt = () => 0;
  for (let i = 0; i < 4; i++) {
    const z = 0.38 + i * 0.19;
    lathe(T, v(0, 0, z), Z(), [[0, 0.21], [0, 0.29], [0.07, 0.29], [0.07, 0.21]], "secondary", { n: 12, ring: true });
    lathe(T, v(0, 0, z + 0.075), Z(), [[0, 0.21], [0, 0.26], [0.04, 0.26], [0.04, 0.21]], "lighting", { n: 12, ring: true });
    B.socket(`Recoil/Glow_${i + 1}`, v(0, 0.27, z + 0.09));
  }
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2, d = v(Math.cos(a), Math.sin(a), 0);
    prism(T, d.clone().multiplyScalar(0.25).setZ(1.2), d.clone().multiplyScalar(0.2).setZ(1.6), octRing(0.05, 0.03, 0.015), "plating", Z(), octRing(0.03, 0.02, 0.01));
  }
  for (const s of [1, -1]) ribbedHose(P, bezier(v(s * 0.32, -0.25, -0.9), v(s * 0.46, -0.38, -0.5), v(s * 0.4, -0.35, 0.1), v(s * 0.26, -0.2, 0.35), 10), 0.04, 0.08, "dark", "mechanical", 8);
  lightStrip(P, v(sd * 0.2, 0.385, -0.25), Z(), X(), 0.3, 0.03);
  B.move({ node: "Recoil", kind: "slide", travel: 0.12 });
  B.socket("Recoil/Muzzle_0", v(0, 0, 1.55), Z());
  B.socket("Mount", v(-sd * 0.95, 0, 0));
  return B.def();
}

/** Hull laser beam projector (the pulse laser, beam laser): the power pack and optics behind, the lens just ahead. */
export function laserProjectorHull(sd: 1 | -1 = -1, seed = 13): ModelDef {
  const B = new Build(seed, 1.8, sd), P = B.piece("Body"), o = B.out, rd = B.read;
  // Optical housing: a long rounded box from the power pack to just ahead of the shoulder, deep fins on top and side.
  loftZ(P, [[-1.5, sellRing(0.34, 0.32, 16, 4)], [-1.35, sellRing(0.4, 0.38, 16, 4)], [0.35, sellRing(0.4, 0.38, 16, 4)], [0.5, sellRing(0.36, 0.34, 16, 4)]], "plating");
  P.heatAt = () => 1;
  for (let i = 0; i < 10; i++) {
    const z = -1.2 + i * 0.15;
    plate(P, v(0, 0.39, z), X(), Z().negate(), 0.62, 0.05, 0.12, "mechanical", { bevel: 0, ch: 0.01 });
    if (i < 8) plate(P, v(-sd * 0.39, 0.05, z), Z(), Y(), 0.05, 0.5, 0.1, "mechanical", { bevel: 0, ch: 0.01 });
  }
  P.heatAt = () => 0;
  for (let i = 0; i < 4; i++) B.socket(`Glow_${i + 1}`, v(0, 0.5, -1.1 + i * 0.45));
  trunnion(B, P, 0.16, 0.45, v(-sd * 0.42, 0, 0));
  // The power pack hung under the back half, a cell bank on the outboard flank.
  loftZ(P, [[-1.45, octRing(0.3, 0.16, 0.05)], [-0.45, octRing(0.3, 0.16, 0.05)]], "secondary", { y0: -0.5 });
  for (let i = 0; i < 4; i++) lathe(P, v(sd * 0.42, -0.12, -1.3 + i * 0.22), o, [[0, 0], [0, 0.08], [0.06, 0.08], [0.07, 0.05], [0.07, 0]], "mechanical", { n: 8 });
  plate(P, v(sd * 0.4, -0.02, -0.5), rd.clone().negate(), Y(), 1.2, 0.36, 0.04, "secondary");
  stencilDigits(P, v(sd * 0.445, 0.0, -0.5), rd, Y(), 0.2, "01");
  hazard(P, v(sd * 0.445, -0.2, -0.05), rd, Y(), 0.4, 0.08, 6);
  boltRow(P, v(sd * 0.44, 0.17, -1.3), v(sd * 0.44, 0.17, 0.2), 6, o, 0.02);
  readyLamp(P, v(sd * 0.2, 0.39, -1.4), Y(), 0.03);
  ribbedHose(P, bezier(v(0, -0.36, -1.0), v(0, -0.55, -0.6), v(sd * 0.1, -0.5, 0.0), v(0, -0.36, 0.3), 10), 0.05, 0.09, "dark", "mechanical", 8);
  // The lens turret (Spin): focusing rings and the big lens in a hood.
  const S = B.piece("Spin", v(0, 0, 0.5));
  lathe(S, v(0, 0, 0.5), Z(), [[0, 0], [0, 0.3], [0.1, 0.3], [0.1, 0.27], [0.18, 0.27], [0.18, 0.31], [0.28, 0.31], [0.28, 0]], "dark", { n: 16, secs: ["dark", "mechanical", "mechanical", "dark", "mechanical", "mechanical", "mechanical"] });
  boltCircle(S, v(0, 0, 0.78), Z(), 0.27, 8, 0.015);
  B.move({ node: "Spin", kind: "spin", rpm: 30 });
  lathe(P, v(0, 0, 0.78), Z(), [[0, 0.3], [0, 0.4], [0.3, 0.4], [0.32, 0.36], [0.3, 0.33], [0.02, 0.33]], "plating", { n: 16, ring: true });
  lathe(P, v(0, 0, 0.81), Z(), [[0, 0], [0, 0.28], [0.06, 0.24], [0.08, 0]], "visor", { n: 16 });
  B.socket("Glow_0", v(0, 0, 0.9));
  B.socket("Muzzle_0", v(0, 0, 1.13), Z());
  B.socket("Mount", v(-sd * 0.9, 0, 0));
  return B.def();
}

/** Hull particle orb: a big glass sphere in a cage behind the shoulder, a short flared launch bell ahead. */
export function orbHull(sd: 1 | -1 = -1, seed = 14): ModelDef {
  const B = new Build(seed, 1.8, sd), P = B.piece("Body"), o = B.out, rd = B.read;
  cowl(P, -0.35, 0.4, 0.4, 0.36, 0);
  trunnion(B, P, 0.16, 0.5, v(-sd * 0.4, 0, 0));
  boltRow(P, v(sd * 0.4, 0.27, -0.25), v(sd * 0.4, 0.27, 0.3), 4, o, 0.02);
  // The sphere: glass (visor) between two heavy clamp rings, a cradle under it, the cage's hoops round it.
  const c = v(0, 0.1, -0.95), R = 0.55;
  const prof: [number, number][] = [];
  for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 10; prof.push([R + Math.sin(a) * R, Math.max(0.001, Math.cos(a) * R)]); }
  prof[0][1] = 0; prof[prof.length - 1][1] = 0;
  lathe(P, c.clone().add(v(0, 0, -R)), Z(), prof, "visor", { n: 16 });
  B.socket("Glow_0", c.clone());
  for (const dz of [-0.36, 0.36]) lathe(P, c.clone().add(v(0, 0, dz - 0.06)), Z(), [[0, 0.38], [0, 0.48], [0.12, 0.48], [0.12, 0.38]], "secondary", { n: 16, ring: true });
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI) / 3;
    lathe(P, c, v(Math.cos(a), 0, Math.sin(a)), [[-0.03, R + 0.04], [-0.03, R + 0.1], [0.03, R + 0.1], [0.03, R + 0.04]], "mechanical", { n: 20, ring: true });
  }
  loftZ(P, [[-1.4, octRing(0.36, 0.12, 0.04)], [-0.4, octRing(0.36, 0.12, 0.04)]], "plating", { y0: -0.52 });
  for (const z of [-1.25, -0.65]) prism(P, v(0, -0.42, z), v(0, -0.3, z), octRing(0.26, 0.05, 0.02), "dark");
  // A counterweight block and a coolant tank behind the sphere; feed lines from them to the bell.
  loftZ(P, [[-1.85, octRing(0.3, 0.32, 0.08)], [-1.5, octRing(0.32, 0.34, 0.09)]], "secondary", { y0: 0 });
  for (const x of [-0.15, 0.15]) bolt(P, v(x, 0.1, -1.855), Z().negate(), 0.03);
  tank(P, v(sd * 0.48, -0.25, -1.55), 0.13, 0.9);
  hazard(P, v(sd * 0.405, -0.2, 0.1), rd, Y(), 0.4, 0.08, 6);
  stencilDigits(P, v(sd * 0.405, 0.08, 0.1), rd, Y(), 0.16, "0");
  for (const s of [1, -1]) tube(P, bezier(v(s * 0.3, 0.45, -0.95), v(s * 0.35, 0.55, -0.4), v(s * 0.3, 0.42, 0.2), v(s * 0.2, 0.25, 0.55), 8), 0.035, "dark", { n: 6 });
  readyLamp(P, v(-sd * 0.22, 0.37, 0.15), Y(), 0.03);
  B.socket("Glow_1", v(-sd * 0.22, 0.4, 0.15));
  // The launch bell (Recoil): a short neck widening to a flared mouth, glowing rings inside it.
  const T = B.piece("Recoil", v());
  T.heatAt = (p) => (p.z > 0.9 ? 0.7 : 0);
  lathe(T, v(0, 0, 0.35), Z(), [[0, 0], [0, 0.2], [0.35, 0.18], [0.7, 0.24], [0.95, 0.38], [1.05, 0.42], [1.05, 0.34], [0.8, 0.22], [0.8, 0]], "mechanical", { n: 14, secs: ["mechanical", "mechanical", "plating", "plating", "dark", "dark", "dark", "dark"] });
  T.heatAt = () => 0;
  for (let i = 0; i < 2; i++) {
    const z = 0.95 + i * 0.1;
    lathe(T, v(0, 0, z), Z(), [[0, 0.24 + i * 0.05], [0, 0.28 + i * 0.05], [0.03, 0.28 + i * 0.05], [0.03, 0.24 + i * 0.05]], "lighting", { n: 14, ring: true });
    B.socket(`Recoil/Glow_${i + 2}`, v(0, 0.27 + i * 0.05, z));
  }
  B.move({ node: "Recoil", kind: "slide", travel: 0.15 });
  B.socket("Recoil/Muzzle_0", v(0, 0, 1.45), Z());
  B.socket("Mount", v(-sd * 0.95, 0, 0));
  return B.def();
}

/** Hull arc caster: capacitor discs stacked on a mast behind the shoulder, a coil, two forked electrodes ahead. */
export function arcHull(sd: 1 | -1 = -1, seed = 15): ModelDef {
  const B = new Build(seed, 1.8, sd), P = B.piece("Body"), o = B.out, rd = B.read;
  cowl(P, -0.5, 0.35, 0.38, 0.36, 0);
  trunnion(B, P, 0.16, 0.5, v(-sd * 0.38, 0, 0));
  boltRow(P, v(sd * 0.38, 0.27, -0.4), v(sd * 0.38, 0.27, 0.25), 4, o, 0.02);
  hazard(P, v(sd * 0.385, -0.22, -0.05), rd, Y(), 0.4, 0.08, 6);
  // The mast behind the shoulder and the capacitor discs on it: wide plates, lit rims.
  lathe(P, v(0, 0, -1.75), Z(), [[0, 0], [0, 0.12], [1.3, 0.12], [1.3, 0]], "mechanical", { n: 10 });
  for (let i = 0; i < 6; i++) {
    const z = -1.65 + i * 0.2;
    lathe(P, v(0, 0, z), Z(), [[0, 0.1], [0, 0.4], [0.03, 0.43], [0.09, 0.43], [0.12, 0.4], [0.12, 0.1]], "secondary", { n: 16, ring: true, secs: ["secondary", "dark", "dark", "dark", "secondary"] });
    lathe(P, v(0, 0, z + 0.04), Z(), [[0, 0.43], [0, 0.45], [0.04, 0.45], [0.04, 0.43]], "lighting", { n: 16, ring: true });
    if (i % 2 === 0) B.socket(`Glow_${i / 2 + 1}`, v(0, 0.45, z + 0.06));
  }
  // Tie rods along the stack, an end cap, a cable loom down to the coil.
  for (let i = 0; i < 3; i++) {
    const a = (i * 2 * Math.PI) / 3 + Math.PI / 2, d = v(Math.cos(a), Math.sin(a), 0);
    prism(P, d.clone().multiplyScalar(0.47).setZ(-1.72), d.clone().multiplyScalar(0.47).setZ(-0.45), octRing(0.025, 0.025, 0.008), "dark");
  }
  plate(P, v(0, 0, -1.77), X(), Y(), 0.6, 0.6, 0.08, "dark", { bevel: 0.02 });
  for (const x of [-0.18, 0.18]) bolt(P, v(x, 0, -1.855), Z().negate(), 0.03);
  stencilDigits(P, v(sd * 0.385, 0.08, -0.15), rd, Y(), 0.16, "7");
  readyLamp(P, v(-sd * 0.2, 0.37, 0.1), Y(), 0.03);
  // The coil ahead of the shoulder: copper-ish windings (trim) round a core.
  lathe(P, v(0, 0, 0.35), Z(), [[0, 0], [0, 0.18], [0.45, 0.18], [0.45, 0]], "dark", { n: 12 });
  for (let i = 0; i < 6; i++) lathe(P, v(0, 0, 0.38 + i * 0.065), Z(), [[0, 0.18], [0, 0.23], [0.045, 0.23], [0.045, 0.18]], "trim", { n: 12, ring: true });
  // The electrodes (Recoil): two forked prongs above and below, lit tips; the arc leaves between them.
  const T = B.piece("Recoil", v());
  T.heatAt = (p) => (p.z > 1.1 ? 1 : 0);
  for (const s of [1, -1]) {
    prism(T, v(0, s * 0.12, 0.75), v(0, s * 0.2, 1.4), octRing(0.05, 0.04, 0.015), "mechanical", Y(), octRing(0.035, 0.03, 0.01));
    prism(T, v(0, s * 0.2, 1.4), v(0, s * 0.1, 1.6), octRing(0.035, 0.03, 0.01), "dark", Y(), octRing(0.02, 0.02, 0.006));
    lathe(T, v(0, s * 0.1, 1.6), Z(), [[0, 0], [0, 0.045], [0.06, 0], ], "lighting", { n: 8 });
  }
  T.heatAt = () => 0;
  B.socket("Recoil/Glow_0", v(0, 0, 1.6));
  B.move({ node: "Recoil", kind: "slide", travel: 0.08 });
  B.socket("Recoil/Muzzle_0", v(0, 0, 1.6), Z());
  B.socket("Mount", v(-sd * 0.9, 0, 0));
  return B.def();
}
