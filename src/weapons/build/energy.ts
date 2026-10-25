// Code stand-ins for the energy weapons (docs/asset-list.md P3; Keith's list 2026-10-25), both hull guns:
// - plasma-cannon-hull: a glowing containment core (visor glass, a Spin ring cage round it), accelerator rings that
//   light up (lamp sections), a short wide emitter barrel with prongs, ribbed coolant hoses.
// - laser-projector-hull: an optical housing with deep cooling fins, a big lens (visor) in a hooded bezel, focusing
//   rings, a Spin lens turret that turns slowly while it fires.
// Root at the trunnion. Glow_n at the core, rings and lens.
import { Build, v, X, Y, Z, lathe, loftZ, octRing, plate, boltRow, boltCircle, hazard, stencilDigits, prism, ribbedHose, bezier, louvres, lightStrip, sellRing } from "../kit";
import { cowl, readyLamp, trunnion } from "./common";
import type { ModelDef } from "../parts";

/** Hull plasma cannon. */
export function plasmaCannonHull(sd: 1 | -1 = -1, seed = 12): ModelDef {
  const B = new Build(seed, 1.8, sd), P = B.piece("Body"), o = B.out, rd = B.read;
  cowl(P, -0.95, -0.2, 0.44, 0.38, 0);
  trunnion(B, P, 0.16, 0.5, v(-sd * 0.42, 0, -0.55));
  louvres(P, v(sd * 0.445, 0, -0.6), rd.clone().negate(), Y(), 0.5, 0.4, 5);
  stencilDigits(P, v(0, 0.385, -0.6), X().negate(), Z(), 0.16, "9");
  boltRow(P, v(sd * 0.44, 0.29, -0.9), v(sd * 0.44, 0.29, -0.25), 4, o, 0.02);
  readyLamp(P, v(-sd * 0.25, 0.385, -0.8), Y(), 0.03);
  // The containment core: a glass bulb (visor) between two collars, struts round it.
  lathe(P, v(0, 0, -0.2), Z(), [[0, 0], [0, 0.32], [0.12, 0.34], [0.12, 0]], "secondary", { n: 14 });
  lathe(P, v(0, 0, -0.08), Z(), [[0, 0], [0, 0.2], [0.18, 0.3], [0.42, 0.3], [0.6, 0.2], [0.6, 0]], "visor", { n: 14 });
  lathe(P, v(0, 0, 0.52), Z(), [[0, 0], [0, 0.34], [0.14, 0.34], [0.14, 0]], "secondary", { n: 14 });
  B.socket("Glow_0", v(0, 0, 0.22));
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4, d = v(Math.cos(a), Math.sin(a), 0);
    prism(P, d.clone().multiplyScalar(0.3).setZ(-0.08), d.clone().multiplyScalar(0.3).setZ(0.52), octRing(0.03, 0.03, 0.01), "mechanical");
  }
  // A cage that spins round the core while charging.
  const S = B.piece("Spin", v(0, 0, 0.22));
  for (const z of [-0.02, 0.22, 0.46]) lathe(S, v(0, 0, z - 0.02), Z(), [[0, 0.34], [0, 0.37], [0.04, 0.37], [0.04, 0.34]], "mechanical", { n: 14, ring: true });
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3, d = v(Math.cos(a), Math.sin(a), 0);
    prism(S, d.clone().multiplyScalar(0.355).setZ(-0.02), d.clone().multiplyScalar(0.355).setZ(0.48), octRing(0.015, 0.015, 0.005), "dark");
  }
  B.move({ node: "Spin", kind: "spin", rpm: 90 });
  // Accelerator: rings that glow, then a short wide emitter with four prongs.
  const T = B.piece("Recoil", v());
  T.heatAt = (p) => (p.z > 1.3 ? 0.8 : 0);
  lathe(T, v(0, 0, 0.66), Z(), [[0, 0], [0, 0.2], [0.9, 0.2], [0.9, 0.26], [1.05, 0.3], [1.05, 0.22], [0.95, 0.2], [0.95, 0]], "mechanical", { n: 12, secs: ["mechanical", "mechanical", "dark", "dark", "dark", "dark", "dark"] });
  T.heatAt = () => 0;
  for (let i = 0; i < 4; i++) {
    const z = 0.75 + i * 0.2;
    lathe(T, v(0, 0, z), Z(), [[0, 0.21], [0, 0.29], [0.07, 0.29], [0.07, 0.21]], "secondary", { n: 12, ring: true });
    lathe(T, v(0, 0, z + 0.075), Z(), [[0, 0.21], [0, 0.26], [0.04, 0.26], [0.04, 0.21]], "lighting", { n: 12, ring: true });
    B.socket(`Recoil/Glow_${i + 1}`, v(0, 0.27, z + 0.09));
  }
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2, d = v(Math.cos(a), Math.sin(a), 0);
    prism(T, d.clone().multiplyScalar(0.25).setZ(1.55), d.clone().multiplyScalar(0.2).setZ(2.05), octRing(0.05, 0.03, 0.015), "plating", Z(), octRing(0.03, 0.02, 0.01));
  }
  hazard(T, v(sd * 0.2, 0, 1.68), v(0, 0, -sd), Y(), 0.18, 0.18, 5);
  for (const s of [1, -1]) ribbedHose(P, bezier(v(s * 0.3, -0.25, -0.55), v(s * 0.45, -0.38, -0.1), v(s * 0.38, -0.35, 0.5), v(s * 0.24, -0.2, 0.75), 12), 0.04, 0.08, "dark", "mechanical", 8);
  lightStrip(P, v(sd * 0.2, 0.385, -0.45), Z(), X(), 0.3, 0.03);
  B.move({ node: "Recoil", kind: "slide", travel: 0.12 });
  B.socket("Recoil/Muzzle_0", v(0, 0, 2.0), Z());
  B.socket("Mount", v(-sd * 0.92, 0, -0.55));
  return B.def();
}

/** Hull laser beam projector. */
export function laserProjectorHull(sd: 1 | -1 = -1, seed = 13): ModelDef {
  const B = new Build(seed, 1.8, sd), P = B.piece("Body"), o = B.out, rd = B.read;
  // Optical housing: a long rounded box with deep cooling fins along the top and sides.
  loftZ(P, [[-0.9, sellRing(0.34, 0.32, 16, 4)], [-0.75, sellRing(0.4, 0.38, 16, 4)], [0.9, sellRing(0.4, 0.38, 16, 4)], [1.05, sellRing(0.36, 0.34, 16, 4)]], "plating");
  P.heatAt = () => 1;
  for (let i = 0; i < 9; i++) {
    const z = -0.55 + i * 0.16;
    plate(P, v(0, 0.39, z), X(), Z().negate(), 0.62, 0.05, 0.12, "mechanical", { bevel: 0, ch: 0.01 });
    plate(P, v(-sd * 0.39, 0.05, z), Z(), Y(), 0.05, 0.5, 0.1, "mechanical", { bevel: 0, ch: 0.01 });
  }
  P.heatAt = () => 0;
  for (let i = 0; i < 4; i++) B.socket(`Glow_${i + 1}`, v(0, 0.5, -0.4 + i * 0.4));
  trunnion(B, P, 0.16, 0.45, v(-sd * 0.42, 0, -0.3));
  plate(P, v(sd * 0.4, -0.02, 0.1), rd.clone().negate(), Y(), 1.2, 0.36, 0.04, "secondary");
  stencilDigits(P, v(sd * 0.445, 0.0, 0.1), rd, Y(), 0.2, "01");
  hazard(P, v(sd * 0.445, -0.2, 0.55), rd, Y(), 0.4, 0.08, 6);
  boltRow(P, v(sd * 0.44, 0.17, -0.6), v(sd * 0.44, 0.17, 0.7), 6, o, 0.02);
  readyLamp(P, v(sd * 0.2, 0.39, -0.75), Y(), 0.03);
  ribbedHose(P, bezier(v(0, -0.36, -0.7), v(0, -0.55, -0.3), v(sd * 0.1, -0.5, 0.4), v(0, -0.36, 0.8), 12), 0.05, 0.09, "dark", "mechanical", 8);
  // The lens turret (Spin): focusing rings and the big lens in a hood.
  const S = B.piece("Spin", v(0, 0, 1.05));
  lathe(S, v(0, 0, 1.05), Z(), [[0, 0], [0, 0.3], [0.1, 0.3], [0.1, 0.27], [0.18, 0.27], [0.18, 0.31], [0.28, 0.31], [0.28, 0]], "dark", { n: 16, secs: ["dark", "mechanical", "mechanical", "dark", "mechanical", "mechanical", "mechanical"] });
  boltCircle(S, v(0, 0, 1.33), Z(), 0.27, 8, 0.015);
  B.move({ node: "Spin", kind: "spin", rpm: 30 });
  lathe(P, v(0, 0, 1.33), Z(), [[0, 0.3], [0, 0.4], [0.3, 0.4], [0.32, 0.36], [0.3, 0.33], [0.02, 0.33]], "plating", { n: 16, ring: true });
  lathe(P, v(0, 0, 1.36), Z(), [[0, 0], [0, 0.28], [0.06, 0.24], [0.08, 0]], "visor", { n: 16 });
  B.socket("Glow_0", v(0, 0, 1.45));
  B.socket("Muzzle_0", v(0, 0, 1.68), Z());
  B.socket("Mount", v(-sd * 0.87, 0, -0.3));
  return B.def();
}

