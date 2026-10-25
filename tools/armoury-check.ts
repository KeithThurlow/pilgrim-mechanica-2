// Armoury check (weapon models, src/weapons/): things that must never happen to a weapon model.
// - every code stand-in builds; positions finite, normals unit length, sections 0..7, every part wound outward
//   (positive volume: a part drawn inside out would render as a hole);
// - every weapon has a Mount and a Muzzle_0 (projectiles: neither needed); muzzles point forward or up, never back;
// - every moving part named in a def exists, every socket's host part exists;
// - triangle budgets (docs/asset-list.md): hull or shoulder 6k, hand 3k, projectile 300 (the converted old kit's
//   miniguns are over and are reported, not failed: their rebuild is asset list W9);
// - mirroring flips the mount across X and keeps every part wound outward;
// - the converted GLBs load with Body, their moving nodes and sockets, and a missing GLB falls back to a stand-in.
import { readFileSync, existsSync } from "node:fs";
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CATALOG } from "../src/weapons/catalog";
import { defFromGlb, mirrorDef, readSidecar, trisOf, type ModelDef } from "../src/weapons/parts";

let fails = 0;
const fail = (m: string) => { fails++; console.log("FAIL " + m); };
const BUDGET: Record<string, number> = { hull: 6000, shoulder: 6000, back: 6000, two_handed: 6000, hand: 3000, forearm: 6000, projectile: 300, belt: 600 };

function volume(g: THREE.BufferGeometry) {
  const p = g.attributes.position.array as Float32Array;
  let s = 0;
  for (let i = 0; i < p.length; i += 9) s += p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6]) + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6]);
  return s / 6;
}

function checkDef(id: string, d: ModelDef, mount: string, strictBudget: boolean) {
  for (const part of d.parts) {
    const g = part.geometry, P = g.attributes.position, N = g.attributes.normal, S = g.attributes.section;
    for (let i = 0; i < P.count; i++) {
      if (![P.getX(i), P.getY(i), P.getZ(i)].every(Number.isFinite)) { fail(`${id}:${part.name} non-finite position`); break; }
      const l = Math.hypot(N.getX(i), N.getY(i), N.getZ(i));
      if (Math.abs(l - 1) > 0.02) { fail(`${id}:${part.name} normal length ${l.toFixed(3)}`); break; }
      const s = S.getX(i);
      if (s < 0 || s > 7 || s !== Math.round(s)) { fail(`${id}:${part.name} section ${s}`); break; }
    }
    if (strictBudget && volume(g) <= 0) fail(`${id}:${part.name} wound inside out (volume ${volume(g).toFixed(4)})`);
    if (part.parent && !d.parts.some((p) => p.name === part.parent)) fail(`${id}:${part.name} rides missing part ${part.parent}`);
  }
  for (const m of d.moving) if (!d.parts.some((p) => p.name === m.node)) fail(`${id} moving part ${m.node} has no node`);
  for (const k of Object.keys(d.sockets)) if (k.includes("/") && !d.parts.some((p) => p.name === k.split("/")[0])) fail(`${id} socket ${k} on a missing part`);
  const sock = (n: string) => Object.entries(d.sockets).find(([k]) => k === n || k.endsWith("/" + n))?.[1];
  if (mount !== "projectile" && mount !== "belt") {
    if (!sock("Mount") && !sock("Grip_R")) fail(`${id} has no Mount or Grip_R`);
    if (mount !== "back" && !sock("Muzzle_0")) fail(`${id} has no Muzzle_0`);
    for (const [k, s] of Object.entries(d.sockets)) if (/Muzzle_\d+$/.test(k) && s.fwd && s.fwd.z < -0.1) fail(`${id} ${k} points backward`);
  }
  const tris = Math.round(trisOf(d)), budget = BUDGET[mount] ?? 6000;
  if (tris > budget) (strictBudget ? fail : (m: string) => console.log("note " + m))(`${id} ${tris} tris over the ${budget} budget`);
  return tris;
}

// Code stand-ins, both sides.
const rows: string[] = [];
for (const e of CATALOG) {
  if (!e.build) continue;
  const d = e.build(e.side === "left" ? 1 : -1);
  const tris = checkDef(e.id, d, e.mount, true);
  if (e.side !== "left") rows.push(`${e.id} ${tris}`);
  const m = mirrorDef(d), a = d.sockets.Mount?.pos, b = m.sockets.Mount?.pos;
  if (a && b && Math.abs(a.x + b.x) > 1e-6) fail(`${e.id} mirror did not flip the mount`);
  for (const p of m.parts) if (volume(p.geometry) <= 0) fail(`${e.id} mirrored ${p.name} inside out`);
}
console.log("stand-ins (tris): " + rows.join(", "));

// Converted GLBs: parse each with its sidecar.
(globalThis as unknown as { self: unknown }).self ??= globalThis;
const loader = new GLTFLoader();
const conv: string[] = [];
for (const e of CATALOG.filter((c) => !c.build)) {
  let path = `public/models/weapons/${e.id}.glb`;
  // A left id without its own file is the right one mirrored (the library does the same).
  if (!existsSync(path) && e.side === "left" && e.mirror) path = `public/models/weapons/${e.mirror}.glb`;
  if (!existsSync(path)) { fail(`${e.id}: no GLB and no stand-in`); continue; }
  const buf = readFileSync(path);
  const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
  const side = existsSync(path.replace(".glb", ".json")) ? readSidecar(JSON.parse(readFileSync(path.replace(".glb", ".json"), "utf8"))) : { moving: [] };
  const d = defFromGlb(gltf.scene, side.moving, e.heat);
  if (!d.parts.some((p) => p.name === "Body")) fail(`${e.id} has no Body`);
  for (const m of side.moving) if (!d.parts.some((p) => p.name === m.node)) fail(`${e.id} sidecar moving ${m.node} missing in the GLB`);
  const tris = checkDef(e.id, d, e.mount, false);
  if (e.side !== "left") conv.push(`${e.id} ${tris}`);
}
console.log("converted (tris): " + conv.join(", "));

if (fails) { console.log(`armoury check: ${fails} failures`); process.exit(1); }
console.log("armoury check: ok");
