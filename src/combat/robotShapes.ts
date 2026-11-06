// Stand-in geometry for the robots, built in code (Keith 2026-11-01, restyled from the yellow construction look:
// "sci-fi modern tech ... white is the key plate feature, typically cylindrical in shape, mechanical aspects still
// squarish, pipes and things dangling"). White plates over dark grey mechanical bits; red eyes for seeking, blue for
// the weapons (lamps and beams are drawn apart, lit). Each body is one merged geometry (× its size, origin at the
// body centre, facing +Z, +X left) drawn instanced; the drawer tints each robot a little. Dangling cables are drawn
// by robotsDraw.ts (procedural sway, no physics).
import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { HUB_R, HUB_H, MID_SPEC, BIG_SPEC, MID_SAW_Z, MID_SAW_X, MID_SAW_Y, MID_BODY_H, BIG_BODY_H, QUAD_TURRET_Y, QUAD_GUN_X } from "./robotLegs";
import { BIG_CORE_Y, BIG_CORE_R } from "./robotWeakPoints";

/**
 * The robots' shared palette (also for the humanoid and strider robots in their own files): plate white, a dimmer
 * plate for panel bands, dark grey joints and mechanics, darker still for vents and lenses, red seeker eyes, the blue
 * weapon glow and its white-blue core.
 */
export const ROBOT_PALETTE = {
  plate: 0xe8e6e0, plateDim: 0xc8c6c0, joint: 0x3a3d42, dark: 0x22252a, seek: 0xff2a1a, beam: 0x3aa8ff, beamCore: 0xd8f4ff,
} as const;
export const WHITE = ROBOT_PALETTE.plate, WHITE_DIM = ROBOT_PALETTE.plateDim, JOINT = ROBOT_PALETTE.joint, DARK = ROBOT_PALETTE.dark;
export const GLASS = 0x141a20, CHROME = 0xcfd3d6, STEEL = 0x8d9296;
/** Ragdoll colours per kind (small, medium, big): body, legs. */
export const ROBOT_RAG: [number, number][] = [[WHITE, JOINT], [WHITE, JOINT], [WHITE, JOINT]];

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
      this.add(g, k % 2 ? DARK : WHITE, x + lx * c, y, z - lx * s, 0, ry, 0, 0.05);
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
    const cols = [STEEL, JOINT, WHITE_DIM, DARK];
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

/** A capsule-ish pod along Z: radius r, length len (cap to cap), sides around; centre at the origin. */
function pod(r: number, len: number, sides = 10, nose = 0.55, tail = 0.45): THREE.BufferGeometry {
  const h = len / 2;
  const pts = [[0, -h], [r * 0.55, -h + r * tail * 0.4], [r * 0.92, -h + r * tail], [r, -h + r * tail * 1.6], [r, h - r * nose * 1.6], [r * 0.9, h - r * nose], [r * 0.5, h - r * nose * 0.35], [0, h]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, sides);
  g.rotateX(Math.PI / 2);
  return g;
}

/**
 * Small scuttler (× size): a mite. A white cylindrical abdomen behind, a narrower thorax over the dark hip block the
 * legs grip, a small squarish head in front with mandibles (the red eye is drawn apart), a dark spine plate down the
 * back and two short antennae.
 */
export function smallBodyGeometry(): THREE.BufferGeometry {
  const R = HUB_R, H = HUB_H, k = new Kit();
  k.add(pod(R * 0.62, R * 1.45, 8), WHITE, 0, H * 0.12, -R * 0.42, -0.12, 0, 0, 0.05);
  k.cyl(R * 0.64, R * 0.1, JOINT, 0, H * 0.12, -R * 0.42, Math.PI / 2, 0, 0, 8);
  k.box(R * 0.32, R * 0.12, R * 1.0, DARK, 0, H * 0.12 + R * 0.6, -R * 0.45, -0.12, 0, 0);
  k.add(pod(R * 0.42, R * 0.7, 8, 0.4, 0.4), WHITE_DIM, 0, H * 0.1, R * 0.35, 0, 0, 0, 0.05);
  k.box(R * 1.0, H * 0.45, R * 0.6, JOINT, 0, -H * 0.15, R * 0.05);
  k.box(R * 0.5, R * 0.36, R * 0.38, WHITE, 0, H * 0.18, R * 0.8);
  k.box(R * 0.52, R * 0.08, R * 0.3, DARK, 0, H * 0.22, R * 0.84);
  k.box(R * 0.1, R * 0.08, R * 0.32, JOINT, R * 0.14, -H * 0.05, R * 1.05, 0, -0.35, 0).box(R * 0.1, R * 0.08, R * 0.32, JOINT, -R * 0.14, -H * 0.05, R * 1.05, 0, 0.35, 0);
  k.box(R * 0.04, R * 0.04, R * 0.5, DARK, R * 0.12, H * 0.45, R * 1.05, -0.6, -0.3, 0).box(R * 0.04, R * 0.04, R * 0.5, DARK, -R * 0.12, H * 0.45, R * 1.05, -0.6, 0.3, 0);
  return k.build(-H * 0.6, H * 0.4, 0.12);
}

/**
 * Small quad (× size; Keith's "small quad" ref): a rounded white hull high on its four legs, a dark visor band across
 * the front (red eyes drawn apart), a dark mechanical core and hip housings underneath, a slug gun on the left, the
 * cutter arm on the right (its blue disc drawn apart so it can spin), an antenna mast at the back.
 */
export function midBodyGeometry(): THREE.BufferGeometry {
  const k = new Kit(), H = MID_BODY_H;
  const shell = [[0, -H * 0.42], [0.25, -H * 0.42], [0.31, -H * 0.2], [0.32, H * 0.1], [0.28, H * 0.4], [0.18, H * 0.62], [0, H * 0.68]].map(([x, y]) => new THREE.Vector2(x, y));
  k.add(new THREE.LatheGeometry(shell, 12).scale(1, 1, 1.18), WHITE, 0, H * 0.25, -0.02, 0, 0, 0, 0.04);
  k.add(new THREE.CylinderGeometry(0.325, 0.325, H * 0.22, 12, 1, true, -1.1, 2.2).scale(1, 1, 1.18), GLASS, 0, H * 0.32, -0.02);
  k.box(0.44, 0.1, 0.44, JOINT, 0, -MID_SPEC.hipDrop, 0);
  for (const a of MID_SPEC.angles) k.box(0.12, 0.12, 0.12, DARK, Math.sin(a) * MID_SPEC.hipR, -MID_SPEC.hipDrop, Math.cos(a) * MID_SPEC.hipR);
  k.box(0.18, 0.08, 0.16, JOINT, 0, -H * 0.1, -0.3);
  // Slug gun under the visor, left.
  k.cyl(0.028, 0.26, DARK, 0.15, -0.0, 0.42, Math.PI / 2, 0, 0, 6).box(0.08, 0.08, 0.12, JOINT, 0.15, 0, 0.3);
  // Cutter arm, right: a square arm to the disc's hub and a motor block.
  k.box(0.07, 0.07, MID_SAW_Z - 0.28, JOINT, MID_SAW_X, MID_SAW_Y, 0.28 + (MID_SAW_Z - 0.28) / 2);
  k.box(0.1, 0.1, 0.1, DARK, MID_SAW_X + 0.06, MID_SAW_Y, MID_SAW_Z);
  // Antenna mast, back left, a box at its foot.
  k.box(0.07, 0.06, 0.07, DARK, 0.17, H * 0.7, -0.16).cyl(0.008, 0.34, DARK, 0.17, H * 0.7 + 0.17, -0.16, 0, 0, 0, 5);
  return k.build(-H * 0.6, H * 0.3, 0.12);
}

/**
 * Weapon quad body (× size; Keith's "medium quad bots with weapons" ref, Keith 2026-11-01: "a thorax, a turret with the
 * weapons mounted on the side on top, and a small abdomen behind"). A low white thorax on the dark hip block the legs
 * grip, a jointed neck, a white turret drum on top with a squarish sensor block at its front (red eyes drawn apart) and
 * trunnions out to where the weapons hang on its sides (quadWeaponGeometry), and a small white abdomen tipped up behind.
 */
export function quadBodyGeometry(): THREE.BufferGeometry {
  const k = new Kit(), H = MID_BODY_H, T = QUAD_TURRET_Y;
  // Thorax: a squat rounded shell over the hips, a dark band round its waist.
  const shell = [[0, -H * 0.3], [0.26, -H * 0.3], [0.31, -H * 0.1], [0.3, H * 0.2], [0.22, H * 0.42], [0, H * 0.48]].map(([x, y]) => new THREE.Vector2(x, y));
  k.add(new THREE.LatheGeometry(shell, 14).scale(1, 1, 1.12), WHITE, 0, 0, 0.02, 0, 0, 0, 0.04);
  k.cyl(0.315, H * 0.1, JOINT, 0, -H * 0.12, 0.02, 0, 0, 0, 14);
  k.box(0.44, 0.1, 0.44, JOINT, 0, -MID_SPEC.hipDrop, 0);
  for (const a of MID_SPEC.angles) k.box(0.13, 0.13, 0.13, DARK, Math.sin(a) * MID_SPEC.hipR, -MID_SPEC.hipDrop, Math.cos(a) * MID_SPEC.hipR);
  // Neck: a dark ring the turret turns on.
  k.cyl(0.15, T - H * 0.5, JOINT, 0, (T + H * 0.4) / 2, 0, 0, 0, 0, 12).cyl(0.2, 0.025, DARK, 0, H * 0.5, 0, 0, 0, 0, 14);
  // Abdomen: a small white pod behind, tipped up, a dark band and a stub joining it to the thorax.
  k.box(0.1, 0.08, 0.14, JOINT, 0, H * 0.05, -0.3, -0.3, 0, 0);
  k.add(pod(0.15, 0.4, 10), WHITE, 0, H * 0.3, -0.5, -0.35, 0, 0, 0.05);
  k.cyl(0.155, 0.04, JOINT, 0, H * 0.25, -0.44, Math.PI / 2 - 0.35, 0, 0, 10);
  k.box(0.06, 0.03, 0.22, DARK, 0, H * 0.3 + 0.15, -0.52, -0.35, 0, 0);
  return k.build(-H * 0.6, T + 0.12, 0.12);
}

/**
 * A weapon quad's turret (× size), drawn apart so it swivels on its own (Keith 2026-11-01): a white drum about the body's
 * axis, a capped top with a dark hatch, a sensor block at the front with its glass slit (red eyes drawn apart),
 * trunnions out to the weapons either side (quadWeaponGeometry turns with it).
 */
export function quadTurretGeometry(): THREE.BufferGeometry {
  const k = new Kit(), H = MID_BODY_H, T = QUAD_TURRET_Y;
  k.cyl(0.2, 0.16, WHITE, 0, T, 0, 0, 0, 0, 16).cyl(0.205, 0.03, JOINT, 0, T - 0.06, 0, 0, 0, 0, 16);
  k.cyl(0.16, 0.03, WHITE_DIM, 0, T + 0.095, 0, 0, 0, 0, 16).box(0.1, 0.02, 0.12, DARK, 0, T + 0.115, -0.04);
  k.box(0.18, 0.12, 0.14, WHITE, 0, T + 0.01, 0.2).box(0.185, 0.04, 0.08, GLASS, 0, T + 0.03, 0.24);
  for (const x of [QUAD_GUN_X - 0.1, -(QUAD_GUN_X - 0.1)]) k.box(0.12, 0.07, 0.09, JOINT, x, T, 0.02);
  return k.build(-H * 0.6, T + 0.12, 0.12);
}

/** A weapon quad's pair of weapons (× size), by Q_* index, on the turret's sides: minigun pods, rocket pods, a laser, a rail gun. */
export function quadWeaponGeometry(w: number): THREE.BufferGeometry {
  const k = new Kit(), y = QUAD_TURRET_Y, X = QUAD_GUN_X;
  const pod = (x: number) => {
    if (w === 0) {
      // Minigun: a white housing and a cluster of six barrels.
      k.box(0.13, 0.13, 0.2, WHITE, x, y, 0.12).box(0.135, 0.04, 0.12, JOINT, x, y + 0.045, 0.12);
      for (let b = 0; b < 6; b++) { const a = (b / 6) * Math.PI * 2; k.cyl(0.012, 0.3, DARK, x + Math.cos(a) * 0.032, y + Math.sin(a) * 0.032, 0.36, Math.PI / 2, 0, 0, 5); }
      k.cyl(0.05, 0.03, JOINT, x, y, 0.44, Math.PI / 2, 0, 0, 8);
    } else if (w === 1) {
      // Rockets: a box pod, four dark tubes in its face.
      k.box(0.17, 0.17, 0.26, WHITE, x, y + 0.02, 0.14).box(0.175, 0.03, 0.27, JOINT, x, y - 0.05, 0.14);
      for (let b = 0; b < 4; b++) k.cyl(0.028, 0.02, DARK, x + (b & 1 ? 0.04 : -0.04), y + 0.02 + (b & 2 ? 0.04 : -0.04), 0.275, Math.PI / 2, 0, 0, 8);
    }
  };
  if (w <= 1) { pod(X); pod(-X); }
  else {
    // The main gun on the right (the beam leaves at x -X, z 0.62), a sensor box on the left.
    k.box(0.14, 0.14, 0.22, WHITE, -X, y, 0.1);
    if (w === 2) {
      // Laser: a long white barrel with dark rings, the lens at its tip (glows, drawn apart).
      k.cyl(0.035, 0.42, WHITE_DIM, -X, y, 0.4, Math.PI / 2, 0, 0, 8);
      for (const z of [0.3, 0.42, 0.54]) k.cyl(0.045, 0.025, JOINT, -X, y, z, Math.PI / 2, 0, 0, 8);
    } else {
      // Rail: two flat dark rails either side of a slot, a white yoke at their root.
      k.box(0.03, 0.09, 0.46, DARK, -X + 0.04, y, 0.42).box(0.03, 0.09, 0.46, DARK, -X - 0.04, y, 0.42).box(0.12, 0.03, 0.08, WHITE, -X, y + 0.06, 0.25);
    }
    k.box(0.1, 0.1, 0.12, JOINT, X - 0.02, y + 0.02, 0.08).cyl(0.03, 0.02, GLASS, X - 0.02, y + 0.02, 0.145, Math.PI / 2, 0, 0, 8);
  }
  return k.build(-1, 1, 0.1);
}

/** The medium walker's cutter (× size): a toothed disc of radius 1, upright (spins about X), drawn lit in blue. */
export function sawGeometry(): THREE.BufferGeometry {
  const sh = new THREE.Shape(), teeth = 14;
  for (let t = 0; t < teeth; t++) {
    const a0 = (t / teeth) * Math.PI * 2, a1 = ((t + 0.6) / teeth) * Math.PI * 2;
    const p = (r: number, a: number) => [Math.cos(a) * r, Math.sin(a) * r] as const;
    const [x0, y0] = p(0.82, a0), [x1, y1] = p(1, a1);
    if (t === 0) sh.moveTo(x0, y0); else sh.lineTo(x0, y0);
    sh.lineTo(x1, y1);
  }
  sh.closePath();
  // A hole in the middle so it reads as a ring of energy.
  const hole = new THREE.Path();
  for (let t = 0; t <= 12; t++) { const a = -(t / 12) * Math.PI * 2; if (t === 0) hole.moveTo(Math.cos(a) * 0.45, Math.sin(a) * 0.45); else hole.lineTo(Math.cos(a) * 0.45, Math.sin(a) * 0.45); }
  sh.holes.push(hole);
  const disc = new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: false, curveSegments: 1 });
  disc.translate(0, 0, -0.02);
  disc.rotateY(Math.PI / 2);
  disc.deleteAttribute("uv");
  return disc;
}

/**
 * Big walker body (× size; Keith's tall beam-walker reference): a wide white thorax disc up top (domed, a dark band
 * round its rim, a cap and a mast), a sensor head jutting from its front, a dark mechanical core underneath with the
 * four hip housings, the blue emitter lens under the front (glow drawn apart), and a big white abdomen slung behind and
 * below, ringed in dark bands, so it reads clearly as thorax and abdomen.
 */
export function bigBodyGeometry(): THREE.BufferGeometry {
  const k = new Kit(), H = BIG_BODY_H;
  const R = 0.58;
  const disc = [[0, -H * 0.38], [R * 0.7, -H * 0.38], [R * 0.95, -H * 0.24], [R, -H * 0.08], [R * 0.97, H * 0.08], [R * 0.8, H * 0.22], [R * 0.45, H * 0.32], [0, H * 0.34]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  k.add(new THREE.LatheGeometry(disc, 20), WHITE, 0, 0, 0, 0, 0, 0, 0.04);
  k.cyl(R * 1.01, H * 0.09, JOINT, 0, -H * 0.02, 0, 0, 0, 0, 20);
  k.cyl(R * 0.36, H * 0.14, WHITE_DIM, 0, H * 0.38, -0.04, 0, 0, 0, 12);
  k.cyl(R * 0.38, H * 0.03, JOINT, 0, H * 0.33, -0.04, 0, 0, 0, 12);
  k.cyl(0.012, 0.28, DARK, -0.1, H * 0.5 + 0.12, -0.1, 0, 0, 0, 5);
  // The reactor's mast and cradle (Keith 2026-11-06: a target on top; the glowing orb is drawn apart, robotWeakPoints.ts).
  k.cyl(0.035, BIG_CORE_Y - H * 0.4, DARK, 0, (BIG_CORE_Y + H * 0.4) / 2, 0, 0, 0, 0, 8);
  k.cyl(BIG_CORE_R * 1.15, 0.03, JOINT, 0, BIG_CORE_Y - BIG_CORE_R * 0.75, 0, 0, 0, 0, 12);
  for (let j = 0; j < 3; j++) {
    const a = (j / 3) * Math.PI * 2;
    k.box(0.025, BIG_CORE_R * 1.3, 0.025, DARK, Math.sin(a) * BIG_CORE_R * 1.05, BIG_CORE_Y - BIG_CORE_R * 0.15, Math.cos(a) * BIG_CORE_R * 1.05, 0, a, 0);
  }
  // Sensor head: a squarish block out the front of the disc, dark visor band.
  k.box(0.24, 0.13, 0.2, WHITE, 0, H * 0.02, R + 0.04).box(0.245, 0.045, 0.12, GLASS, 0, H * 0.04, R + 0.09);
  k.box(0.16, 0.06, 0.14, JOINT, 0, -H * 0.18, R - 0.02);
  // Core underneath: a dark block with the hip housings on its corners, struts to the disc.
  k.box(0.5, H * 0.3, 0.5, JOINT, 0, -H * 0.5, 0);
  for (const a of BIG_SPEC.angles) {
    const x = Math.sin(a) * BIG_SPEC.hipR, z = Math.cos(a) * BIG_SPEC.hipR;
    k.box(0.15, 0.15, 0.15, DARK, x, -BIG_SPEC.hipDrop, z, 0, a, 0).cyl(0.035, 0.22, STEEL, x, -BIG_SPEC.hipDrop, z, 0, a, Math.PI / 2, 6);
  }
  // Emitter housing under the front (the lens glows, drawn apart).
  k.cyl(0.11, 0.08, DARK, 0, -H * 0.62, 0.2, 0, 0, 0, 12);
  // Abdomen: slung behind and below, tipped down at the tail.
  k.add(pod(0.27, 0.9, 14, 0.5, 0.7), WHITE, 0, -H * 0.85, -0.48, -0.55, 0, 0, 0.04);
  for (const [t, r] of [[0.0, 0.272], [0.2, 0.26]] as const) {
    const zc = -0.48 + Math.cos(0.55) * (-0.1 - t * 0.6), yc = -H * 0.85 + Math.sin(0.55) * (0.1 + t * 0.6);
    k.cyl(r, 0.04, JOINT, 0, yc, zc, Math.PI / 2 - 0.55, 0, 0, 14);
  }
  k.box(0.1, 0.07, 0.4, DARK, 0, -H * 0.85 + 0.24, -0.5, -0.55, 0, 0);
  k.box(0.18, 0.12, 0.24, JOINT, 0, -H * 0.6, -0.25, -0.4, 0, 0);
  return k.build(-H * 2.2, H * 0.3, 0.1);
}

/**
 * A big walker's foot (× the foot's height): pivot at the top (the shin's end) at the origin, a dark tapered pad down to
 * the sand at y -1 with three claws.
 */
export function bucketGeometry(): THREE.BufferGeometry {
  const k = new Kit();
  k.add(new THREE.CylinderGeometry(0.28, 0.5, 0.7, 8), JOINT, 0, -0.45, 0);
  k.cyl(0.32, 0.12, DARK, 0, -0.1, 0, 0, 0, 0, 8);
  for (let t = 0; t < 3; t++) {
    const a = (t / 3) * Math.PI * 2;
    k.box(0.16, 0.22, 0.42, DARK, Math.sin(a) * 0.5, -0.9, Math.cos(a) * 0.5, 0.4, a, 0);
  }
  return k.build(-1, 0, 0.1);
}
