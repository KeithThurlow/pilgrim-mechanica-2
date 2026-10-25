// A weapon model's data, whichever way it was made. GLBs (converted from the old kit, or exported by the desktop
// Blender agent per docs/asset-list.md) and the code stand-ins (src/weapons/build/) both come out as a ModelDef:
// named parts, each one geometry with its origin on its pivot and axes along the model's (position, normal, color =
// paint and wear multiplier, section, heat), the part it rides (nested moving nodes), sockets, and how parts move.
//
// GLB contract (docs/asset-list.md): +Z front, +Y up, +X the mech's left, root at the mount. `Body` holds the static
// parts; moving nodes Spin, Slide, Barrel, Hammer, Door_n, Missile_n, Recoil, Tube_n, Lid (any depth: a Recoil inside
// a Barrel rides it); empties are sockets (Muzzle_n, Mount, Grip_R/L, Eject, Laser, Glow_n, FeedIn). Material names
// Paint_<section> give each face its paint section.
import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { SECTION, type Section } from "./palette";

/** spin about axis (default +Z); hinge about axis (default +X) by angleDeg at full; slide by travel along axis
 * (default -Z, the recoil and slide direction; +Z for Missile_n). Axes in the part's parent frame. */
export interface Moving { node: string; kind: "spin" | "hinge" | "slide"; angleDeg?: number; travel?: number; rpm?: number; axis?: [number, number, number] }
export interface Socket { pos: THREE.Vector3; fwd?: THREE.Vector3; up?: THREE.Vector3 }
/** pivot in model space; parent: the part this one rides. */
export interface PartDef { name: string; pivot: THREE.Vector3; geometry: THREE.BufferGeometry; parent?: string }
/** Sockets on a moving part are named "Part/Socket" so they ride it. */
/** rootAt: where the root sits. "joint" (the contract): on the mount point, a hull gun's shoulder joint. "trunnion":
 * the old kit's centred guns, rooted on their own axis, which hang outboard of the joint (mounts.ts offsets them).
 * palette: the model's own paint (sRGB hex by section), for GLBs whose vertex colours carry paint (scheme 0 uses it). */
export interface ModelDef {
  parts: PartDef[]; sockets: Record<string, Socket>; moving: Moving[];
  rootAt?: "joint" | "trunnion"; palette?: Partial<Record<Section, number>>;
}

/** Node names that are moving parts by the contract (plus anything a sidecar lists). */
const SECTIONS_BY_INDEX = ["plating", "secondary", "dark", "mechanical", "trim", "lighting", "detail", "visor"] as Section[];
const MOVING_NAME = /^(Spin|Slide|Barrel|Hammer|Recoil|Lid|Launcher|Door_\d+|Missile_\d+|Tube_\d+)$/;

/** How a part moves when no sidecar says (the contract's defaults). */
export function defaultMoving(node: string): Moving | null {
  if (node === "Spin") return { node, kind: "spin", rpm: 700 };
  if (node === "Slide") return { node, kind: "slide", travel: 0.2 };
  if (node === "Recoil") return { node, kind: "slide", travel: 0.15 };
  if (node.startsWith("Tube_")) return { node, kind: "slide", travel: 0.12 };
  if (node.startsWith("Missile_")) return { node, kind: "slide", travel: 0.6, axis: [0, 0, 1] };
  if (node === "Barrel" || node === "Launcher") return { node, kind: "hinge", angleDeg: -45 };
  if (node === "Hammer") return { node, kind: "hinge", angleDeg: -55 };
  if (node.startsWith("Door_")) return { node, kind: "hinge", angleDeg: -100 };
  if (node === "Lid") return { node, kind: "hinge", angleDeg: 100 };
  return null;
}

/** A part's heat weight: 0 cold, 1 glows first. */
export type HeatRule = (p: THREE.Vector3, sec: number, box: THREE.Box3) => number;

/** Hot barrels: bare-metal faces, more toward the muzzle end of the part. */
export const barrelHeat = (from = 0.25): HeatRule => (p, sec, box) => {
  if (sec !== SECTION.mechanical) return 0;
  const t = (p.z - box.min.z) / Math.max(1e-3, box.max.z - box.min.z);
  return THREE.MathUtils.smoothstep(t, from, 1);
};

/** One node's own meshes (not those of moving parts under it) as one geometry in a frame at `pivot` (model axes). */
function nodeGeometry(node: THREE.Object3D, toModel: THREE.Matrix4, pivot: THREE.Vector3, isPart: (o: THREE.Object3D) => boolean): THREE.BufferGeometry | null {
  const geos: THREE.BufferGeometry[] = [];
  const toPivot = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z).multiply(toModel);
  const visit = (o: THREE.Object3D) => {
    if (o !== node && isPart(o)) return;
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const g0 = m.geometry.clone().applyMatrix4(toPivot.clone().multiply(m.matrixWorld));
      const groups = g0.groups.length ? g0.groups : [{ start: 0, count: g0.index ? g0.index.count : g0.attributes.position.count, materialIndex: 0 }];
      const src = g0.index ? g0 : g0.setIndex([...Array(g0.attributes.position.count).keys()]);
      for (const gr of groups) {
        const name = (mats[gr.materialIndex ?? 0]?.name ?? "").replace("Paint_", "") as Section;
        const sec = SECTION[name] ?? SECTION.plating;
        const idx = src.index!.array.slice(gr.start, gr.start + gr.count);
        const n = idx.length;
        const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
        const P = src.attributes.position, N = src.attributes.normal, C = src.attributes.color as THREE.BufferAttribute | undefined;
        for (let i = 0; i < n; i++) {
          const k = idx[i];
          pos[i * 3] = P.getX(k); pos[i * 3 + 1] = P.getY(k); pos[i * 3 + 2] = P.getZ(k);
          if (N) { nor[i * 3] = N.getX(k); nor[i * 3 + 1] = N.getY(k); nor[i * 3 + 2] = N.getZ(k); }
          if (C) { col[i * 3] = C.getX(k); col[i * 3 + 1] = C.getY(k); col[i * 3 + 2] = C.getZ(k); } else col.fill(1, i * 3, i * 3 + 3);
        }
        const out = new THREE.BufferGeometry();
        out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
        if (!N) out.computeVertexNormals();
        out.setAttribute("color", new THREE.BufferAttribute(col, 3));
        out.setAttribute("section", new THREE.BufferAttribute(new Float32Array(n).fill(sec), 1));
        out.setAttribute("heat", new THREE.BufferAttribute(new Float32Array(n), 1));
        geos.push(out);
      }
    }
    for (const c of o.children) visit(c);
  };
  visit(node);
  if (!geos.length) return null;
  const g = mergeGeometries(geos, false)!;
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Heat weights: by a rule, or near the model's Glow_n sockets on metal and dark faces. */
function applyHeat(def: ModelDef, rules: Record<string, HeatRule>) {
  const glows = Object.entries(def.sockets).filter(([k]) => /(^|\/)Glow_\d+$/.test(k));
  const world = new Map<string, THREE.Vector3>(def.parts.map((p) => [p.name, p.pivot]));
  for (const part of def.parts) {
    const g = part.geometry, rule = rules[part.name] ?? rules[part.name.replace(/_\d+$/, "")];
    if (!rule && !glows.length) continue;
    const p = g.attributes.position, s = g.attributes.section, h = g.attributes.heat as THREE.BufferAttribute, q = new THREE.Vector3();
    const pts = glows.map(([k, sk]) => (k.includes("/") ? sk.pos.clone().add(world.get(k.split("/")[0]) ?? new THREE.Vector3()) : sk.pos).clone().sub(part.pivot));
    const r = 0.45;
    for (let i = 0; i < p.count; i++) {
      q.fromBufferAttribute(p, i);
      let w = rule ? rule(q, s.getX(i), g.boundingBox!) : 0;
      const sec = s.getX(i);
      if (!rule && (sec === SECTION.mechanical || sec === SECTION.dark)) for (const c of pts) w = Math.max(w, 1 - THREE.MathUtils.smoothstep(q.distanceTo(c), r * 0.3, r));
      h.setX(i, w);
    }
  }
}

/** Read a weapon GLB scene: parts (Body and the moving nodes, nested as they are) and sockets (empties). */
export function defFromGlb(scene: THREE.Object3D, moving: Moving[], heatRules: Record<string, HeatRule> = {}): ModelDef {
  scene.updateMatrixWorld(true);
  // The weapon root: the first node with a Body (or meshes) under it, past wrapper nodes.
  let root: THREE.Object3D = scene;
  while (root.children.length === 1 && !(root.children[0] as THREE.Mesh).isMesh && root.children[0].children.length && root.children[0].name !== "Body") root = root.children[0];
  const toModel = root.matrixWorld.clone().invert();
  const listed = new Set(moving.map((m) => m.node));
  const isPart = (o: THREE.Object3D) => o.name === "Body" || MOVING_NAME.test(o.name) || listed.has(o.name);
  const hasMesh = (o: THREE.Object3D) => { let y = false; o.traverse((c) => { if ((c as THREE.Mesh).isMesh) y = true; }); return y; };
  const def: ModelDef = { parts: [], sockets: {}, moving: [] };
  const modelPos = (o: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(toModel.clone().multiply(o.matrixWorld));
  // Loose meshes straight under the root (no Body node) count as the body.
  const loose = root.children.filter((c) => !isPart(c) && hasMesh(c));
  const walk = (o: THREE.Object3D, host: string | undefined) => {
    for (const c of o.children) {
      if (isPart(c) && hasMesh(c)) {
        const pivot = modelPos(c);
        const g = nodeGeometry(c, toModel, pivot, (x) => isPart(x));
        if (g) def.parts.push({ name: c.name, pivot, geometry: g, parent: c.name === "Body" ? undefined : host });
        walk(c, c.name === "Body" ? host : c.name);
      } else if (!hasMesh(c)) {
        const s: Socket = { pos: modelPos(c) };
        if (host) s.pos.sub(def.parts.find((p) => p.name === host)!.pivot);
        def.sockets[host ? `${host}/${c.name}` : c.name] = s;
        walk(c, host);
      }
    }
  };
  walk(root, undefined);
  if (loose.length && !def.parts.some((p) => p.name === "Body")) {
    const holder = new THREE.Group();
    holder.name = "Body";
    const geos = loose.map((l) => nodeGeometry(l, toModel, new THREE.Vector3(), isPart)).filter((g): g is THREE.BufferGeometry => !!g);
    if (geos.length) def.parts.unshift({ name: "Body", pivot: new THREE.Vector3(), geometry: mergeGeometries(geos, false)! });
  }
  // Socket positions relative to their host part were taken against the host's pivot; parts sorted parents first.
  for (const p of def.parts) {
    const m = moving.find((x) => x.node === p.name) ?? defaultMoving(p.name);
    if (m) def.moving.push(m);
  }
  applyHeat(def, heatRules);
  return def;
}

/** Mirror a model across X (a left-side version of a right-side model): geometry, pivots, sockets, slide axes. */
export function mirrorDef(d: ModelDef): ModelDef {
  const parts = d.parts.map((p) => {
    const g = p.geometry.clone();
    for (const a of ["position", "normal"]) {
      const at = g.attributes[a] as THREE.BufferAttribute;
      for (let i = 0; i < at.count; i++) at.setX(i, -at.getX(i));
    }
    // Swap the 2nd and 3rd vertex of each triangle so faces stay outward.
    for (const name of Object.keys(g.attributes)) {
      const at = g.attributes[name] as THREE.BufferAttribute, n = at.itemSize, arr = at.array as Float32Array;
      for (let t = 0; t < at.count; t += 3) for (let k = 0; k < n; k++) { const i1 = (t + 1) * n + k, i2 = (t + 2) * n + k, x = arr[i1]; arr[i1] = arr[i2]; arr[i2] = x; }
    }
    g.computeBoundingBox();
    return { ...p, pivot: new THREE.Vector3(-p.pivot.x, p.pivot.y, p.pivot.z), geometry: g };
  });
  const sockets: Record<string, Socket> = {};
  for (const [k, s] of Object.entries(d.sockets)) sockets[k] = { pos: new THREE.Vector3(-s.pos.x, s.pos.y, s.pos.z), fwd: s.fwd && new THREE.Vector3(-s.fwd.x, s.fwd.y, s.fwd.z), up: s.up && new THREE.Vector3(-s.up.x, s.up.y, s.up.z) };
  const moving = d.moving.map((m) => (m.kind === "slide" && m.axis ? { ...m, axis: [-m.axis[0], m.axis[1], m.axis[2]] as [number, number, number] } : m));
  return { parts, sockets, moving };
}

/** Sidecar json (docs/asset-list.md; same fields as the old kit's) -> moving parts and socket frames. */
export interface Sidecar {
  moving: Moving[]; frames: Record<string, { forward?: number[]; up?: number[] }>;
  rootAt?: "joint" | "trunnion"; palette?: Partial<Record<Section, number>>;
}
export function readSidecar(j: Record<string, unknown>): Sidecar {
  const moving = ((j.moving ?? []) as Record<string, unknown>[]).map((m) => ({
    node: String(m.node), kind: m.kind as Moving["kind"], angleDeg: m.angleDeg as number | undefined, travel: m.travel as number | undefined,
    rpm: (m.rpm ?? m.suggestedRpm) as number | undefined, axis: Array.isArray(m.axis) ? (m.axis as [number, number, number]) : undefined,
  }));
  const pal = j.palette as Record<string, string> | undefined;
  const palette = pal ? Object.fromEntries(Object.entries(pal).filter(([k]) => k in SECTION).map(([k, hex]) => [k, parseInt(String(hex).replace("#", ""), 16)])) as Partial<Record<Section, number>> : undefined;
  return { moving, frames: (j.socketFrames ?? {}) as Record<string, { forward?: number[]; up?: number[] }>, rootAt: j.rootAt === "trunnion" ? "trunnion" : undefined, palette };
}

/** A GLB whose vertex colours are paint x wear (the desktop contract): divide the paint out by section, leaving the
 * wear multiplier the look expects, so paint schemes still swap. Works out whether the colours are sRGB or linear. */
export function depaint(def: ModelDef, palette: Partial<Record<Section, number>>) {
  const lin = (hex: number) => new THREE.Color().setHex(hex).convertSRGBToLinear();
  const srgb = (hex: number) => new THREE.Color().setHex(hex);
  // Which space: the plating's ratio should sit a little under 1 (wear and AO darken, never brighten much).
  const ratios = { s: [] as number[], l: [] as number[] };
  for (const p of def.parts) {
    const c = p.geometry.attributes.color, s = p.geometry.attributes.section;
    for (let i = 0; i < c.count; i += 7) {
      const hex = palette[SECTIONS_BY_INDEX[s.getX(i)]];
      if (hex === undefined) continue;
      const a = srgb(hex), b = lin(hex), m = Math.max(a.r, a.g, a.b), mb = Math.max(b.r, b.g, b.b);
      const v = Math.max(c.getX(i), c.getY(i), c.getZ(i));
      if (m > 0.05) ratios.s.push(v / m);
      if (mb > 0.02) ratios.l.push(v / mb);
    }
  }
  const med = (a: number[]) => (a.length ? a.sort((x, y) => x - y)[a.length >> 1] : 1);
  const useLinear = Math.abs(med(ratios.l) - 0.9) < Math.abs(med(ratios.s) - 0.9);
  for (const p of def.parts) {
    const c = p.geometry.attributes.color as THREE.BufferAttribute, s = p.geometry.attributes.section;
    for (let i = 0; i < c.count; i++) {
      const hex = palette[SECTIONS_BY_INDEX[s.getX(i)]];
      if (hex === undefined) continue;
      const k = useLinear ? lin(hex) : srgb(hex);
      const w = Math.min(1.3, (c.getX(i) + c.getY(i) + c.getZ(i)) / Math.max(0.03, k.r + k.g + k.b));
      c.setXYZ(i, w, w, w);
    }
    c.needsUpdate = true;
  }
}

/** Move a def so its Mount socket is the root (the contract's root; the code stand-ins are built round their axis). */
export function rootAtMount(def: ModelDef): ModelDef {
  const m = def.sockets.Mount?.pos;
  if (!m || m.lengthSq() < 1e-10) return def;
  const off = m.clone();
  for (const p of def.parts) p.pivot.sub(off); // pivots are in model space, parts riding parts included
  for (const [k, s] of Object.entries(def.sockets)) if (!k.includes("/")) s.pos.sub(off);
  return def;
}

export function trisOf(def: ModelDef) {
  return def.parts.reduce((s, p) => s + p.geometry.attributes.position.count / 3, 0);
}
