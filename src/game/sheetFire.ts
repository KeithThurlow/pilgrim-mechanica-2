// Sheet fire against the battlefield's targets (src/game/sheet.ts has the rules): build a direct-fire sheet from a
// muzzle, gather every body in it (targets with a sheet of their own push theirs; the rest by a fan of rays through
// the band), and resolve it with a penetration budget, applying the damage. Pure of drawing, so the checks run it
// headless; Battlefield.fire and the rail call it. Host-owned (it decides damage).
import * as THREE from "three/webgpu";
import type { Hittable } from "./battlefield";
import type { HitSurface } from "../fx/minigun";
import { groundRises, penetrate, type GroundRise, type PenMaterial, type PenResult, type PenValues, type Sheet, type SheetHit } from "./sheet";
import { FLAG, MEASURE, RayHits, type Filter, type Register } from "./register";

interface Ground { height(x: number, z: number): number }
/** Steel that isn't a target (wreck stand-ins): costs budget and stops rounds. */
export interface Steel { hit(from: THREE.Vector3, dir: THREE.Vector3, maxDist: number, at: THREE.Vector3, normal: THREE.Vector3): boolean }

/** A direct-fire sheet: half-width and height (m), penetration budget (m of steel equivalent), and where it's aimed. */
export interface SheetFire {
  half: number;
  height: number;
  pen: number;
  /** The aim point (cursor or lock): the sheet's floor runs from the ground under the muzzle to the ground here. */
  aim?: { x: number; y: number; z: number } | null;
  /** The shot's own height over the floor (m): ground above it costs penetration. Else the sheet's top. Rounds (not
   *  flat) fly the muzzle-to-aim ray where that's higher (near the gun), and never lower than this over the floor. */
  line?: number;
  /** Fly flat to range (the rail) rather than come down on the sand past the aim (rounds). */
  flat?: boolean;
  /** Throw light bodies along the line at this speed (m/s; the rail). */
  knock?: number;
  /** Armour pierce 0..1 of each hit (src/game/armour.ts; none: armour-ignoring). */
  pierce?: number;
}

/** What a sheet shot did: the bodies (in order), where it ended and on what. */
export interface SheetShot {
  result: PenResult<Hittable>;
  /** Where it ended: in the body or ground it stopped in, or where it came down (on the sand). */
  end: THREE.Vector3;
  surface: HitSurface;
  /** Damage dealt, summed. */
  dealt: number;
  /** Exit points of the bodies it went through (for sparks). */
  exits: THREE.Vector3[];
}

/**
 * A sheet from a muzzle along d (its flat part), out to range (m along d): its floor runs from the ground under the
 * muzzle to the ground under the aim (else along d's slope), its top `height` over that. Rounds (not flat) end where
 * their ray comes down on the sand at or past the aim (a lip in between is the sheet's business, not the ray's); the
 * rail flies flat to range.
 */
export function makeSheet(field: Ground, muzzle: THREE.Vector3, d: THREE.Vector3, range: number, f: SheetFire, v: PenValues): Sheet {
  const fl = Math.hypot(d.x, d.z) || 1e-6, dx = d.x / fl, dz = d.z / fl, rise = d.y / fl;
  const g0 = field.height(muzzle.x, muzzle.z);
  const aim = f.aim;
  const aimFlat = aim ? Math.hypot(aim.x - muzzle.x, aim.z - muzzle.z) : 0;
  const slope = aim && aimFlat > 1 ? (field.height(aim.x, aim.z) - g0) / aimFlat : f.flat ? 0 : rise;
  const flatRange = f.flat ? range : range * fl;
  let land = flatRange;
  if (!f.flat) {
    for (let t = Math.max(0, aimFlat * 0.98); t <= flatRange; t += v.sheetStep) {
      if (muzzle.y + rise * t <= field.height(muzzle.x + dx * t, muzzle.z + dz * t)) { land = t; break; }
    }
  }
  return {
    ox: muzzle.x, oz: muzzle.z, dx, dz, from: 0, len: land, half: f.half, under: v.sheetUnder,
    top: (t) => g0 + slope * t + f.height,
    line: f.line === undefined ? undefined : f.flat ? (t) => g0 + slope * t + f.line! : (t) => Math.max(g0 + slope * t + f.line!, muzzle.y + rise * t),
    ground: (x, z) => field.height(x, z),
  };
}

const fanO = new THREE.Vector3(), fanD = new THREE.Vector3(), fanF = new THREE.Vector3(), fanB = new THREE.Vector3(), fanN = new THREE.Vector3();
const steelAt = new THREE.Vector3(), steelN = new THREE.Vector3();

const crossHits = new RayHits(), crossed = new Set<unknown>();
const crossFilter: Filter = { all: FLAG.Hittable };

/**
 * Every body of another team in the sheet, in no order: targets with a sheet of their own push theirs (the swarms
 * cull theirs with the register); the rest are found by a fan of rays through the band (3 across × 5 up), each kept
 * going past what it meets. Steel too. With the register, an object it holds (a raider, a mech, a dummy) gets its fan
 * only when the sheet's line comes within its hit reach (+ the register's slack): one flat query instead of 15 rays
 * per object.
 */
export function sheetHits(targets: readonly Hittable[], team: number, s: Sheet, steel: Steel | null, out: SheetHit<Hittable>[] = [], reg: Register | null = null): SheetHit<Hittable>[] {
  out.length = 0;
  const cull = !!reg && reg.stamp > 0;
  if (cull) {
    crossed.clear();
    crossFilter.notTeam = team;
    reg!.ray(s.ox + s.dx * s.from, s.oz + s.dz * s.from, s.dx, s.dz, Math.max(0, s.len - s.from), s.half + reg!.slack, crossFilter, crossHits, MEASURE.Reach);
    for (let k = 0; k < crossHits.n; k++) { const ref = reg!.ref[crossHits.e[k]]; if (ref) crossed.add(ref); }
  }
  for (const t of targets) {
    if (!t.alive || t.team === team) continue;
    if (t.sheet) { t.sheet(s, out); continue; }
    if (cull && !crossed.has(t) && reg!.published(t)) continue;
    rayFan(s, t, null, out);
  }
  if (steel) rayFan(s, null, steel, out);
  return out;
}

/** Rays parallel to the sheet's floor through its band: a target's first hit along each, then on past it. */
function rayFan(s: Sheet, t: Hittable | null, steel: Steel | null, out: SheetHit<Hittable>[]) {
  const L = s.len - s.from;
  if (L <= 0.01) return;
  const x0 = s.ox + s.dx * s.from, z0 = s.oz + s.dz * s.from, x1 = s.ox + s.dx * s.len, z1 = s.oz + s.dz * s.len;
  const b0 = s.ground(x0, z0) - s.under * 0.5 + 0.3, b1 = s.ground(x1, z1) - s.under * 0.5 + 0.3;
  const t0 = s.top(s.from), t1 = s.top(s.len);
  const n0 = out.length;
  const ray = (o: THREE.Vector3, d: THREE.Vector3, max: number) => {
    if (t) return t.hitRay(o, d, max);
    return steel!.hit(o, d, max, steelAt, steelN) ? o.distanceTo(steelAt) : -1;
  };
  const material: PenMaterial = !t ? "steel" : t.material ?? (t.surface === "flesh" ? "flesh" : "vehicle");
  for (let i = 0; i < 3; i++) {
    const off = (i - 1) * s.half;
    for (let j = 0; j < 5; j++) {
      const k = j / 4, y0 = b0 + (t0 - b0) * k, y1 = b1 + (t1 - b1) * k;
      const o = fanO.set(x0 + s.dz * off, y0, z0 - s.dx * off);
      const d = fanD.set(x1 + s.dz * off - o.x, y1 - y0, z1 - s.dx * off - o.z);
      const len = d.length();
      d.divideScalar(len);
      let base = 0;
      for (let n = 0; n < 6 && base < len; n++) {
        const from = fanF.copy(o).addScaledVector(d, base);
        const dist = ray(from, d, len - base);
        if (dist < 0) break;
        const enter = base + dist;
        // The far side: a ray back from up to 12 m on.
        const far = Math.min(len, enter + 12), back = fanB.copy(o).addScaledVector(d, far), nd = fanN.copy(d).negate();
        const exitD = ray(back, nd, far - enter);
        const exit = exitD >= 0 ? far - exitD : enter + 0.5;
        const along = s.from + enter * (L / len), chord = Math.max(0.1, (exit - enter) * (L / len));
        const px = o.x + d.x * enter, py = o.y + d.y * enter, pz = o.z + d.z * enter;
        const r = t ? { ox: from.x, oy: from.y, oz: from.z, dx: d.x, dy: d.y, dz: d.z, dist } : undefined;
        // One hit per body: rays that meet the same stretch of a target are merged (nearest face, widest chord).
        let h: SheetHit<Hittable> | undefined;
        for (let q = n0; q < out.length; q++) if (out[q].target === t && Math.abs(out[q].along - along) < Math.max(0.6, out[q].chord)) { h = out[q]; break; }
        if (!h) out.push({ target: t as Hittable, key: -1, along, chord, material, x: px, y: py, z: pz, ray: r });
        else {
          if (along < h.along) { h.along = along; h.x = px; h.y = py; h.z = pz; h.ray = r; }
          h.chord = Math.max(h.chord, chord);
        }
        base = exit + 0.05;
      }
    }
  }
}

const rises: GroundRise[] = [];
const buf: SheetHit<Hittable>[] = [];

/**
 * Resolve a sheet: gather the bodies and the ground above its top, walk them with the budget, apply the damage (each
 * body × its share) and throw light ones if asked. `apply` false only predicts (the rail's aim line); `skip` leaves
 * out bodies already passed (a shell's earlier steps).
 */
export function resolveSheet(field: Ground, targets: readonly Hittable[], steel: Steel | null, team: number, s: Sheet, damage: number, f: SheetFire, dir: THREE.Vector3, v: PenValues, apply = true, skip?: (h: SheetHit<Hittable>) => boolean, reg: Register | null = null): SheetShot {
  const hits = sheetHits(targets, team, s, steel, buf, reg);
  groundRises(s, s.len, v.sheetStep, rises);
  const result = penetrate(skip ? hits.filter((h) => !skip(h)) : hits.slice(), rises, f.pen, s.len, v);
  let dealt = 0;
  const exits: THREE.Vector3[] = [];
  const at = new THREE.Vector3();
  for (const st of result.steps) {
    const h = st.hit;
    at.set(h.x, h.y, h.z);
    if (h.target && apply) {
      if (h.ray) { fanO.set(h.ray.ox, h.ray.oy, h.ray.oz); fanD.set(h.ray.dx, h.ray.dy, h.ray.dz); h.target.hitRay(fanO, fanD, h.ray.dist + 1e-3); }
      else h.target.pick?.(h.key);
      const dmg = damage * st.share;
      h.target.damage(dmg, at, dir, f.pierce);
      if (f.knock) h.target.knock?.(at, dir, f.knock);
      dealt += dmg;
    }
    if (!st.stopped) exits.push(new THREE.Vector3(s.ox + s.dx * (h.along + h.chord), h.y, s.oz + s.dz * (h.along + h.chord)));
  }
  const last = result.steps[result.steps.length - 1];
  const stopped = !!last?.stopped;
  const end = new THREE.Vector3(s.ox + s.dx * result.end, 0, s.oz + s.dz * result.end);
  end.y = stopped ? last.hit.y : field.height(end.x, end.z);
  const surface: HitSurface = stopped ? (last.hit.target ? last.hit.target.surface : "metal") : "sand";
  return { result, end, surface, dealt, exits };
}
