// Swapping weapons leaves nothing behind (Keith 2026-11-06: the held light minigun acted differently after the
// Inferno and Cryo projectors than when picked first). For every pick on the mouse buttons, the mech fitted with it
// fresh must match the mech that had each other pick fitted (and fired) first: the numbers each gun fires with, the
// gun records (stats, magazine, feed boosts), the arsenal's state per side, the stream guns' and energy weapons' state,
// and the mech's tuning values. Headless, on the real resolve, applyLoadout, UpperSim and Arsenal, with stand-ins for
// what needs the browser (as tools/deathstop-check.ts).
// Run: npm test (or npx tsx tools/weaponswap-check.ts).
import * as THREE from "three";
import { WEAPON_DEFAULTS } from "../src/weapons/tuning";
import { UpperSim, UPPER_DEFAULTS } from "../src/mech/upper";
import { MECH_DEFAULTS } from "../src/game/mechUnit";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { resolve, LOADOUT_DEFAULTS } from "../src/items/loadout";
import { SIDE, loadoutFor, type Pick, type SidePick } from "../src/items/weaponPick";

globalThis.fetch = (async () => ({ ok: false })) as never;
console.warn = () => {};
const { Arsenal } = await import("../src/weapons/arsenal");
const { applyLoadout } = await import("../src/game/loadoutApply");

const problems: string[] = [];
const DT = 1 / 120;
const noop = () => {};

function rig() {
  const bf = {
    field: { height: () => 0 }, targets: [], wrecks: null, nightLights: null, v: {}, sunDir: { y: 1 },
    sfx: { addSound: noop, playSound: noop, play: noop },
    dust: { smoke: noop }, waves: null, blast: noop, register: null,
    flames: new Proxy({}, { get: () => noop }),
    makeSheet: (m: THREE.Vector3, d: THREE.Vector3) => ({ ox: m.x, oz: m.z, dx: d.x, dz: d.z }),
    resolveSheet: () => ({ result: { end: 40 } }),
  };
  const v = { ...WALKER_DEFAULTS, ...UPPER_DEFAULTS, ...MECH_DEFAULTS } as Record<string, number>;
  const upper = new UpperSim(v as never);
  const unit = {
    team: 1, alive: true, player: true, gunsOff: false, cursor: new THREE.Vector3(0, 0, 30) as THREE.Vector3 | null, lock: null, keys: [false, false, false],
    v, upper, health: 1, maxHealth: 1,
    sim: { pelvis: new THREE.Vector3(0, 3, 0), pos: new THREE.Vector3(), inDash: false, dashCancels: false },
    dash: { refillMul: 1, refillNow: noop, charges: 0, fuel: 0 }, reactor: { refillMul: 1, refillNow: noop, fill: noop, energy: 100, spend: () => true, take: () => 1, has: () => true },
    body: { barrel: (_s: number, o: THREE.Vector3) => o.set(0, 0, 1), muzzle: (_s: number, o: THREE.Vector3) => o.set(1, 3.5, 1), showParts: noop },
    weapons: null as unknown,
  };
  const a = new Arsenal(bf as never, unit as never, { ...WEAPON_DEFAULTS, laserDay: 1, laserNight: 1 } as never, {} as never, () => []);
  unit.weapons = a;
  return { a, unit, upper };
}

const fitPick = (u: ReturnType<typeof rig>, left: SidePick, right: SidePick) => {
  const pick: Pick = { left, right, k1: "none", k2: "none", k3: "pack" };
  applyLoadout(u.unit as never, resolve(loadoutFor(pick), LOADOUT_DEFAULTS));
};

/** Fire both sides for a while: anything a weapon keeps between shots builds up. */
const fire = (u: ReturnType<typeof rig>, sec: number) => {
  for (let i = 0; i < Math.round(sec / DT); i++) {
    for (const g of u.upper.guns) { g.spin = 1; g.kick = 0.1; g.clock += DT; }
    try { u.a.step(DT, null, [true, true] as never); } catch { /* a stand-in a weapon's draw-side call needs is missing: the state set so far stays */ }
  }
};

/** Everything a fitted side is defined by, as plain data: what changes between fresh and swapped is a leak. */
const PRIM = (o: unknown, depth = 0): unknown => {
  if (o === null || typeof o !== "object") return typeof o === "number" ? Math.round(o * 1e6) / 1e6 : o;
  if (depth > 2 || o instanceof THREE.Object3D) return "obj";
  if (Array.isArray(o)) return o.map((x) => PRIM(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) if (typeof x !== "function") out[k] = PRIM(x, depth + 1);
  return out;
};

function snapshot(u: ReturnType<typeof rig>) {
  const v = u.unit.v;
  const guns = u.upper.guns.map((g) => {
    const s = g.stats;
    // The numbers MechUnit fires this gun with (its own item values, else the shared sliders).
    const fires = { cls: s?.cls ?? "minigun", damage: s?.damage ?? v.roundDamage, range: s?.range ?? v.range, spread: s?.spread ?? v.spread,
      pierce: s?.pierce ?? v.roundPierce, ap: s?.ap ?? v.roundAp, rate: s?.fireRate ?? v.fireRate, spinUp: s?.spinUp ?? v.spinUp,
      ammo: g.mag.size, pellets: s?.pellets ?? 1, splash: s?.splash ?? 0, burn: s?.burnDps ?? 0, chill: s?.chill ?? 0, proto: s?.proto ?? null };
    return { fires: PRIM(fires), stats: PRIM(s), gun: { enabled: g.enabled, rateMul: g.rateMul, spinCut: g.spinCut, ammoMul: g.ammoMul } };
  });
  const sides = u.a.sides.map((s) => {
    const { model: _m, swish: _w, swordHits: _h, sword: _s, laser: _l, paint: _p, aimLine: _a, aimBeam: _b, rail, ...rest } = s as unknown as Record<string, unknown> & { rail: { charge: number; holding: boolean } };
    return PRIM({ ...rest, rail: { charge: rail.charge, holding: rail.holding } });
  });
  const flames = u.a.fire.sides.map((s) => PRIM({ kind: s.kind, reach: s.reach, pv: s.pv, pc: s.pc }));
  const energy = PRIM(u.a.energy.sides.map((s) => ({ ...s })));
  return { guns, sides, flames, energy, v: PRIM(v) };
}

/** Where two snapshots differ, as "path: fresh → swapped". */
function diff(a: unknown, b: unknown, path: string, out: string[]) {
  if (out.length > 40) return;
  if (a === b) return;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) { out.push(`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`); return; }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out);
}

const PICKS = Object.keys(SIDE) as SidePick[];
const fresh = new Map<SidePick, ReturnType<typeof snapshot>>();
for (const p of PICKS) { const u = rig(); fitPick(u, p, p); fresh.set(p, snapshot(u)); }

let pairs = 0;
for (const to of PICKS) {
  for (const from of PICKS) {
    if (from === to) continue;
    const u = rig();
    fitPick(u, from, from);
    fire(u, 0.5);
    fitPick(u, to, to);
    const out: string[] = [];
    diff(fresh.get(to), snapshot(u), to, out);
    pairs++;
    if (out.length) problems.push(`${from} → ${to}:\n    ${out.join("\n    ")}`);
  }
}
console.log(`weapon swaps: ${pairs} swaps between ${PICKS.length} picks, each compared with the same pick fitted fresh`);

if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("weaponswap-check: ok");
