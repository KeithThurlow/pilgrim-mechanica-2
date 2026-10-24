// Stand-in geometry for the robots (Keith 2026-10-24: autonomous terraforming machines that look functional): built
// in code from boxes and cylinders, vertex-coloured in industrial yellow and grey with wear (grime low down, chipped
// faces), hazard stripes, hoppers and bins of scrap. Each body is one merged geometry (× its size, origin at the body
// centre, facing +Z, +X left) drawn instanced; the drawer tints each robot a little. Lamps are drawn apart (lit).
import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { HUB_R, HUB_H, MID_SPEC, BIG_SPEC, MID_SAW_Z, MID_SAW_X, MID_SAW_Y, MID_SAW_R, MID_BODY_H, BIG_BODY_H } from "./robotLegs";

export const YELLOW = 0xd9a11e, YELLOW_DIRTY = 0xb48a2a, GREY = 0x5f6266, DARK = 0x2e3033, STEEL = 0xa4a8ab, BLACK = 0x1d1d1e;
export const RUST = 0x7b4a2a, GLASS = 0x18232c, CHROME = 0xcfd3d6;

/** Builds one merged, vertex-coloured geometry from parts. */
class Kit {
  private parts: THREE.BufferGeometry[] = [];
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler();
  private seed = 1;

  private rand() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }

  /** Add a geometry in colour hex at (x, y, z), turned by Euler angles (radians). */
  add(g: THREE.BufferGeometry, hex: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, chip = 0.12) {
    const geo = (g.index ? g.toNonIndexed() : g).clone();
    geo.deleteAttribute("uv");
    this.m.compose(new THREE.Vector3(x, y, z), this.q.setFromEuler(this.e.set(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(this.m);
    const pos = geo.getAttribute("position"), n = pos.count, col = new Float32Array(n * 3), c = new THREE.Color(hex);
    // Wear: each face a little lighter or darker (chips, patches).
    for (let f = 0; f < n; f += 3) {
      const k = 1 + (this.rand() * 2 - 1) * chip;
      for (let v = f; v < Math.min(n, f + 3); v++) { col[v * 3] = c.r * k; col[v * 3 + 1] = c.g * k; col[v * 3 + 2] = c.b * k; }
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.parts.push(geo);
    return this;
  }

  box(w: number, h: number, d: number, hex: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    return this.add(new THREE.BoxGeometry(w, h, d), hex, x, y, z, rx, ry, rz);
  }

  /** A cylinder along Y (sides segments), or along another axis when turned. */
  cyl(r: number, h: number, hex: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sides = 8) {
    return this.add(new THREE.CylinderGeometry(r, r, h, sides), hex, x, y, z, rx, ry, rz);
  }

  /** Hazard stripes: a band w wide, h high, of n alternating yellow and black slanted blocks, on a face facing +Z (turned by ry). */
  stripes(w: number, h: number, n: number, x: number, y: number, z: number, ry = 0, t = 0.012) {
    const step = w / n, c = Math.cos(ry), s = Math.sin(ry);
    for (let k = 0; k < n; k++) {
      const lx = -w / 2 + step * (k + 0.5);
      // A parallelogram block: slanted sides, the band's own height.
      const g = new THREE.BoxGeometry(step * 1.01, h, t), p = g.getAttribute("position");
      for (let v = 0; v < p.count; v++) p.setX(v, p.getX(v) + (p.getY(v) / h) * step * 0.8);
      this.add(g, k % 2 ? BLACK : YELLOW, x + lx * c, y, z - lx * s, 0, ry, 0, 0.05);
    }
    return this;
  }

  /** An open-topped bin (walls and floor) with its rim at the top. */
  bin(w: number, h: number, d: number, hex: number, x: number, y: number, z: number, wall = 0.02) {
    this.box(w, wall, d, hex, x, y - h / 2 + wall / 2, z);
    this.box(wall, h, d, hex, x - w / 2 + wall / 2, y, z).box(wall, h, d, hex, x + w / 2 - wall / 2, y, z);
    this.box(w, h, wall, hex, x, y, z - d / 2 + wall / 2).box(w, h, wall, hex, x, y, z + d / 2 - wall / 2);
    return this;
  }

  /** Scrap heaped in a bin: tilted plates and bars sticking out of the top. */
  scrap(w: number, d: number, n: number, size: number, x: number, y: number, z: number) {
    const cols = [RUST, STEEL, GREY, YELLOW_DIRTY, RUST, DARK];
    for (let k = 0; k < n; k++) {
      const a = this.rand(), b = this.rand();
      this.box(size * (0.4 + this.rand()), size * (0.15 + this.rand() * 0.3), size * (0.3 + this.rand() * 0.9), cols[k % cols.length],
        x + (a - 0.5) * w * 0.8, y + this.rand() * size * 0.4, z + (b - 0.5) * d * 0.8, this.rand() * 1.2 - 0.6, this.rand() * 3, this.rand() * 1.2 - 0.6);
    }
    return this;
  }

  /** Merge; grime darkens everything below `grimeTop` toward `grimeBottom` (a dusty, oily underside). */
  build(grimeBottom = -0.5, grimeTop = 0.2, grime = 0.35): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false)!;
    const pos = g.getAttribute("position"), col = g.getAttribute("color");
    for (let v = 0; v < pos.count; v++) {
      const t = Math.min(1, Math.max(0, (pos.getY(v) - grimeBottom) / Math.max(1e-3, grimeTop - grimeBottom)));
      const k = 1 - grime * (1 - t);
      col.setXYZ(v, col.getX(v) * k, col.getY(v) * k * 0.97, col.getZ(v) * k * 0.92);
    }
    g.computeVertexNormals();
    return g;
  }
}

/** A plain white-coloured geometry (tinted entirely by the instance colour). */
function white(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute("uv");
  const n = geo.getAttribute("position").count;
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return geo;
}

/** A box beam from y 0 to 1, unit cross-section (x across, z deep), a little narrower at the far end. */
export function beamGeometry(taper = 0.85): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  g.translate(0, 0.5, 0);
  const p = g.getAttribute("position");
  for (let v = 0; v < p.count; v++) if (p.getY(v) > 0.5) { p.setX(v, p.getX(v) * taper); p.setZ(v, p.getZ(v) * taper); }
  return white(g);
}

/** A round pipe from y 0 to 1, unit diameter (rams, rods, hoses, small legs). */
export function pipeGeometry(sides = 6): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, sides, 1);
  g.translate(0, 0.5, 0);
  return white(g);
}

/** A unit box (knuckles, pins). */
export function knuckleGeometry(): THREE.BufferGeometry { return white(new THREE.BoxGeometry(1, 1, 1)); }

/**
 * Small scrapper (× size): the low grey hub with a yellow top plate, a cutting disc and grinder jaws at the front, a
 * little scrap hopper on the back.
 */
export function smallBodyGeometry(): THREE.BufferGeometry {
  const R = HUB_R, H = HUB_H, k = new Kit();
  const pts = [[0, -0.5], [0.72, -0.5], [1, -0.12], [0.96, 0.18], [0.66, 0.44], [0.28, 0.58], [0, 0.6]].map(([r, y]) => new THREE.Vector2(r * R, y * H));
  k.add(new THREE.LatheGeometry(pts, 8), GREY);
  k.cyl(R * 0.62, 0.02, YELLOW, 0, H * 0.58, 0.01, 0, 0, 0, 8);
  // Hopper behind, a scrap or two in it.
  k.bin(0.13, 0.07, 0.1, DARK, 0, H * 0.62 + 0.02, -0.1, 0.012).scrap(0.1, 0.08, 2, 0.05, 0, H * 0.62 + 0.03, -0.1);
  // Cutting disc out front (blade upright, along the facing), on a short arm; jaws under it.
  k.box(0.03, 0.03, 0.08, DARK, 0, 0, R * 0.95);
  k.cyl(0.09, 0.012, STEEL, 0, 0.01, R * 0.95 + 0.07, 0, 0, Math.PI / 2, 10);
  k.box(0.04, 0.025, 0.07, DARK, 0.04, -H * 0.4, R * 0.95 + 0.02, 0, 0.4, 0).box(0.04, 0.025, 0.07, DARK, -0.04, -H * 0.4, R * 0.95 + 0.02, 0, -0.4, 0);
  return k.build(-H * 0.5, H * 0.6, 0.3);
}

/**
 * Medium cutter (× size): a yellow chassis, dark hip housings, a bin of scrap on its back, a small sensor cab, a slug
 * gun on the left, the saw arm on the right with a guard over the blade (the blade is drawn apart so it can spin),
 * hazard stripes along the front bumper.
 */
export function midBodyGeometry(): THREE.BufferGeometry {
  const k = new Kit(), H = MID_BODY_H;
  k.box(0.56, H * 0.8, 0.72, YELLOW, 0, 0, 0);
  k.box(0.5, 0.04, 0.66, DARK, 0, -H * 0.45, 0);
  for (const a of MID_SPEC.angles) k.box(0.13, 0.12, 0.13, DARK, Math.sin(a) * MID_SPEC.hipR, -MID_SPEC.hipDrop, Math.cos(a) * MID_SPEC.hipR);
  // Front bumper with hazard stripes.
  k.box(0.6, 0.07, 0.05, DARK, 0, -H * 0.2, 0.37).stripes(0.58, 0.05, 8, 0, -H * 0.2, 0.397);
  // Scrap bin on the back.
  k.bin(0.5, 0.22, 0.4, GREY, 0, H * 0.4 + 0.11, -0.13, 0.022).scrap(0.46, 0.36, 7, 0.14, 0, H * 0.4 + 0.2, -0.13);
  // Sensor cab front left, glass band.
  k.box(0.18, 0.12, 0.14, YELLOW_DIRTY, 0.16, H * 0.4 + 0.06, 0.24).box(0.185, 0.04, 0.145, GLASS, 0.16, H * 0.4 + 0.08, 0.242);
  // Slug gun under the cab.
  k.cyl(0.035, 0.32, DARK, 0.17, -0.01, 0.46, Math.PI / 2, 0, 0).cyl(0.05, 0.06, BLACK, 0.17, -0.01, 0.3, Math.PI / 2, 0, 0);
  // Saw arm: a beam to the blade's hub, a motor on it, a guard over the top of the blade.
  k.box(0.08, 0.08, MID_SAW_Z - 0.3, DARK, MID_SAW_X, MID_SAW_Y, 0.3 + (MID_SAW_Z - 0.3) / 2);
  k.cyl(0.07, 0.09, GREY, MID_SAW_X + 0.07, MID_SAW_Y, MID_SAW_Z, 0, 0, Math.PI / 2);
  k.box(0.05, 0.03, MID_SAW_R * 1.5, YELLOW, MID_SAW_X - 0.04, MID_SAW_Y + MID_SAW_R + 0.025, MID_SAW_Z - MID_SAW_R * 0.15);
  k.box(0.05, MID_SAW_R * 0.7, 0.03, YELLOW, MID_SAW_X - 0.04, MID_SAW_Y + MID_SAW_R * 0.7, MID_SAW_Z - MID_SAW_R * 0.85);
  // Exhaust stub and a mast for the beacon.
  k.cyl(0.02, 0.12, BLACK, -0.2, H * 0.4 + 0.06, 0.2).cyl(0.012, 0.1, DARK, 0.16, H * 0.4 + 0.17, 0.2);
  return k.build(-H * 0.5, H * 0.4, 0.3);
}

/** The medium cutter's blade (× size): a toothed steel disc of radius 1, upright (spins about X), with a dark hub. */
export function sawGeometry(): THREE.BufferGeometry {
  const sh = new THREE.Shape(), teeth = 20;
  for (let t = 0; t < teeth; t++) {
    const a0 = (t / teeth) * Math.PI * 2, a1 = ((t + 0.6) / teeth) * Math.PI * 2;
    const p = (r: number, a: number) => [Math.cos(a) * r, Math.sin(a) * r] as const;
    const [x0, y0] = p(0.9, a0), [x1, y1] = p(1, a1);
    if (t === 0) sh.moveTo(x0, y0); else sh.lineTo(x0, y0);
    sh.lineTo(x1, y1);
  }
  sh.closePath();
  const disc = new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: false, curveSegments: 1 });
  disc.translate(0, 0, -0.025);
  const k = new Kit();
  k.add(disc, STEEL, 0, 0, 0, 0, Math.PI / 2, 0, 0.08);
  k.cyl(0.25, 0.09, DARK, 0, 0, 0, 0, 0, Math.PI / 2, 8);
  // Two painted marks so the spin reads.
  k.box(0.07, 0.5, 0.25, YELLOW, 0, 0.55, 0).box(0.07, 0.5, 0.25, YELLOW, 0, -0.55, 0);
  return k.build(-1, 1, 0);
}

/**
 * Big excavator chassis (× size): a yellow upper frame on a dark slewing ring, hip housings at the four corners for the
 * booms, a cab with glass front left, the engine house behind it, a counterweight striped at the back, an exhaust
 * stack, a beacon mast, and the heavy gun under the front.
 */
export function bigBodyGeometry(): THREE.BufferGeometry {
  const k = new Kit(), H = BIG_BODY_H;
  k.box(0.7, H * 0.6, 0.86, YELLOW, 0, 0, 0);
  k.cyl(0.34, H * 0.35, DARK, 0, -H * 0.45, 0, 0, 0, 0, 12);
  k.box(0.5, H * 0.12, 0.5, GREY, 0, -H * 0.66, 0);
  for (const a of BIG_SPEC.angles) {
    const x = Math.sin(a) * BIG_SPEC.hipR, z = Math.cos(a) * BIG_SPEC.hipR;
    k.box(0.16, 0.14, 0.16, DARK, x, -BIG_SPEC.hipDrop * 0.5, z, 0, a, 0).cyl(0.03, 0.2, STEEL, x, -BIG_SPEC.hipDrop * 0.5, z, 0, a, Math.PI / 2);
  }
  // Cab front left: yellow shell, a glass band round it, a roof plate.
  k.box(0.26, 0.2, 0.26, YELLOW, 0.2, H * 0.3 + 0.1, 0.24).box(0.265, 0.075, 0.265, GLASS, 0.2, H * 0.3 + 0.13, 0.242).box(0.28, 0.02, 0.28, DARK, 0.2, H * 0.3 + 0.21, 0.24);
  // Engine house behind, vents on top.
  k.box(0.38, 0.17, 0.34, YELLOW_DIRTY, -0.13, H * 0.3 + 0.085, -0.13);
  for (let v = 0; v < 4; v++) k.box(0.3, 0.012, 0.03, BLACK, -0.13, H * 0.3 + 0.175, -0.24 + v * 0.07);
  // Counterweight with hazard stripes on its back face.
  k.box(0.68, 0.16, 0.13, GREY, 0, 0, -0.49).stripes(0.66, 0.08, 10, 0, 0, -0.557, Math.PI);
  // Front edge stripes and a hand rail on the right.
  k.stripes(0.66, 0.05, 10, 0, H * 0.18, 0.432);
  k.box(0.012, 0.012, 0.6, STEEL, -0.33, H * 0.3 + 0.08, 0.05).box(0.012, 0.08, 0.012, STEEL, -0.33, H * 0.3 + 0.04, 0.33).box(0.012, 0.08, 0.012, STEEL, -0.33, H * 0.3 + 0.04, -0.23);
  // Exhaust stack, beacon mast.
  k.cyl(0.025, 0.22, BLACK, -0.26, H * 0.3 + 0.26, -0.05).cyl(0.012, 0.1, DARK, 0.2, H * 0.3 + 0.26, 0.24);
  // The gun: a heavy barrel slung under the front, its breech in a box.
  k.box(0.16, 0.12, 0.2, DARK, 0, -H * 0.3, 0.4).cyl(0.05, 0.42, DARK, 0, -H * 0.3, 0.6, Math.PI / 2, 0, 0, 8).cyl(0.065, 0.06, BLACK, 0, -H * 0.3, 0.8, Math.PI / 2, 0, 0, 8);
  return k.build(-H * 0.8, H * 0.5, 0.35);
}

/**
 * An excavator bucket, the big one's foot (× the bucket's height): pivot at the top (the stick's end) at the origin,
 * hanging down to its teeth at y -1, opening toward -Z (in toward the body, as it digs), its curved back outward
 * (+Z), with side plates, a linkage and teeth.
 */
export function bucketGeometry(): THREE.BufferGeometry {
  const k = new Kit(), W = 1.1;
  // Curved back: three plates down the outside.
  k.box(W, 0.36, 0.08, YELLOW_DIRTY, 0, -0.18, 0.22, -0.35, 0, 0);
  k.box(W, 0.36, 0.08, YELLOW_DIRTY, 0, -0.5, 0.3, 0.05, 0, 0);
  k.box(W, 0.32, 0.08, YELLOW_DIRTY, 0, -0.8, 0.18, 0.55, 0, 0);
  // Side plates.
  k.box(0.05, 0.85, 0.5, YELLOW, W / 2, -0.5, 0.05).box(0.05, 0.85, 0.5, YELLOW, -W / 2, -0.5, 0.05);
  // Linkage ears at the top.
  k.box(0.3, 0.2, 0.2, DARK, 0, -0.02, 0.1).cyl(0.06, 0.4, STEEL, 0, 0, 0.05, 0, 0, Math.PI / 2);
  // Cutting edge and teeth.
  k.box(W, 0.05, 0.16, DARK, 0, -0.95, -0.02);
  for (let t = 0; t < 5; t++) k.box(0.08, 0.16, 0.09, STEEL, -W / 2 + 0.12 + t * ((W - 0.24) / 4), -1.0, -0.08, 0.5, 0, 0);
  return k.build(-1, 0, 0.45);
}
