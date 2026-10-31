// Headless duel check (Keith 2026-10-29: a lab to fight a rival mech that rolls random weapons; src/combat/rivalAi.ts).
// - The AI only issues commands: rivalAi.ts imports no sim, reads no input, uses no Math.random, and decide() works on
//   a deep-frozen view (any write to it would throw) and returns only the command fields.
// - Rolled rival loadouts are repeatable by seed, differ across seeds, break no fit rule and always carry a weapon;
//   ?rivalfit= fits over them.
// - Duels between two AIs on fixed seeds (the headless duel, src/combat/duelSim.ts) are repeatable, both sides take
//   damage in most, nothing goes NaN and no mech stands neither moving nor firing for long.
// - Dodge drills: a scripted shooter fires mortars, line mortars, missile swarms and held rail charges at a rival told
//   to stand its ground; it gets out of a good share, and a rival that never notices gets out of none.
// Run: npm test (or npx tsx tools/duel-check.ts).
import { RivalAi, RIVAL_AI_DEFAULTS, RIVAL_LEVELS, RIVAL_LEVEL_IDS, type DuelView, type MechCommand, type Threat } from "../src/combat/rivalAi";
import { rollRivalLoadout, applyFitSpec, kitOf, describeLoadout, loadoutDps, loadoutLevel } from "../src/combat/rivalKit";
import { runDuel as runDuelRaw, type DuelOptions } from "../src/combat/duelSim";
import { LOOT_DEFAULTS } from "../src/items/generate";
import { levelPower } from "../src/items/level";
import { problems, resolve } from "../src/items/loadout";
import { loadoutFor } from "../src/items/weaponPick";
import { WEAPON_DEFAULTS } from "../src/weapons/tuning";

const fails: string[] = [];
const must = (ok: boolean, why: string) => { if (!ok) fails.push(why); };
// The rules checks below run Veteran against Veteran; the level checks at the end
// use the levels themselves.
const { rivalHull: _h, ...VET } = RIVAL_LEVELS.veteran;
const runDuel = (o: DuelOptions) => runDuelRaw({ ...o, ai: { ...VET, ...o.ai } });

// ---- The AI only issues commands ----
{
  // (node:fs through the process, so the typecheck needs no node types)
  const fs = (globalThis as unknown as { process: { getBuiltinModule(m: string): { readFileSync(p: URL, e: string): string } } }).process.getBuiltinModule("node:fs");
  const src = fs.readFileSync(new URL("../src/combat/rivalAi.ts", import.meta.url), "utf8");
  const code = src.split("\n").filter((l: string) => !l.trim().startsWith("//")).join("\n");
  for (const bad of ["Math.random", "WalkerSim", "MechUnit", "addEventListener", "document.", "window.", ".sim.", "import * as THREE"]) must(!code.includes(bad), `rivalAi.ts uses ${bad}`);
  const imports = [...code.matchAll(/^import\s+(type\s+)?.*from\s+"([^"]+)"/gm)].filter((m) => !m[1]).map((m) => m[2]);
  for (const i of imports) must(["../items/generate", "./rivalKit"].includes(i), `rivalAi.ts imports ${i} (only seeded rng and the kit's pure helpers)`);

  const freeze = <T>(o: T): T => { if (o && typeof o === "object") { Object.freeze(o); for (const k of Object.keys(o)) freeze((o as Record<string, unknown>)[k]); } return o; };
  const lo = rollRivalLoadout(3, LOOT_DEFAULTS), kit = kitOf(resolve(lo), WEAPON_DEFAULTS);
  const ai = new RivalAi({ ...RIVAL_AI_DEFAULTS }, 5);
  const keys = ["move", "aim", "shotAt", "cursor", "lock", "trigger", "keys", "dash", "dashHold"].sort().join();
  let threw = "", odd = "";
  for (let n = 0; n < 600; n++) {
    const t = n / 60;
    const view: DuelView = freeze({
      t, cover: [{ x: 10, z: 0, yaw: 0, hl: 6, hw: 2.5 }], sees: () => n % 90 < 60, arena: { x: 0, z: 0, r: 80 },
      self: { x: Math.sin(t) * 5, z: -30, vx: 1, vz: 0, heading: 0, health: 1 - n / 800, dashCharges: 2, canDash: true, dashing: false, walkSpeed: 6, kit, weapons: kit.map((_, i) => ({ i, ready: n % 120 > 30, charge: (n % 60) / 60 })) },
      foe: { x: 0, y: 3, z: 10, vx: 3, vz: -1, health: 0.8, dashCharges: n % 200 < 20 ? 0 : 2, alive: true, gunsOff: false, airborne: false, staggered: false, r: 1.7 },
      threats: n % 50 < 25 ? [{ id: 1 + Math.floor(n / 50), kind: "ring", x: 0, z: -30, r: 7, t: 1.5 - (n % 50) / 60 }] : [{ id: 900, kind: "line", ax: 0, az: 10, x: 0, z: -80, r: 0.6, t: Infinity, rail: true, charge: (n % 50) / 50 }],
    });
    let c: MechCommand;
    try { c = ai.decide(view, 1 / 60); } catch (e) { threw = String(e); break; }
    if (Object.keys(c).sort().join() !== keys) odd = Object.keys(c).join();
    if (!Number.isFinite(c.move.x + c.move.z) || Math.hypot(c.move.x, c.move.z) > 1.001) odd = `move ${c.move.x},${c.move.z}`;
  }
  must(!threw, `decide() wrote to its view or threw: ${threw}`);
  must(!odd, `decide() returned something other than a command: ${odd}`);
}

// ---- Seeded rival loadouts ----
{
  const seen = new Set<string>();
  for (let s = 1; s <= 30; s++) {
    const a = JSON.stringify(rollRivalLoadout(s, LOOT_DEFAULTS)), b = JSON.stringify(rollRivalLoadout(s, LOOT_DEFAULTS));
    must(a === b, `rival seed ${s} rolled two different loadouts`);
    seen.add(a);
    const lo = rollRivalLoadout(s, LOOT_DEFAULTS);
    const p = problems(lo);
    must(!p.length, `rival seed ${s} breaks the fit rules: ${p.join("; ")}`);
    must(kitOf(resolve(lo), WEAPON_DEFAULTS).length > 0, `rival seed ${s} carries no weapon: ${describeLoadout(lo).join(" | ")}`);
  }
  must(seen.size === 30, `30 seeds rolled only ${seen.size} different rivals`);
  const lo = rollRivalLoadout(4, LOOT_DEFAULTS);
  const notes = applyFitSpec(lo, "mountL:rail-medium:epic,pack:sh-mortar,legs:nope", LOOT_DEFAULTS, 4);
  must(lo.mountL?.base === "rail-medium" && lo.mountL.rarity === "epic" && lo.pack?.base === "sh-mortar", "?rivalfit= didn't fit its items");
  must(notes.length === 1, `?rivalfit= with a bad base should leave one note (${notes.length})`);
}

// ---- Duels between two AIs ----
const pairs: [number, number][] = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16]];
let both = 0, worstStuck = 0, kills = 0, ttk = 0;
const thr = [0, 0];
for (const [a, b] of pairs) {
  const r = runDuel({ seedA: a, seedB: b, maxTime: 90 });
  const rd = r.score.rounds[0];
  const dealt = Object.values(rd.dealt).reduce((x, y) => x + y, 0), taken = Object.values(rd.taken).reduce((x, y) => x + y, 0);
  if (dealt > 0 && taken > 0) both++;
  if (r.winner >= 0) { kills++; ttk += r.time; }
  worstStuck = Math.max(worstStuck, r.stuckWorst);
  must(!r.nan, `duel ${a}-${b} went NaN`);
  thr[0] += r.threatened[0] + r.threatened[1]; thr[1] += r.dodged[0] + r.dodged[1];
}
must(both >= pairs.length * 0.75, `both sides took damage in only ${both} of ${pairs.length} duels`);
must(worstStuck < 12, `a mech went ${worstStuck.toFixed(1)} s without moving 3 m or firing`);
{
  const a = runDuel({ seedA: 5, seedB: 6, maxTime: 60 }), b = runDuel({ seedA: 5, seedB: 6, maxTime: 60 });
  must(a.time === b.time && JSON.stringify(a.score.rounds) === JSON.stringify(b.score.rounds), "the same seeds fought two different duels");
}
// A long duel nobody can win (huge hulls): no stuck states over a minute and a half.
{
  const r = runDuel({ seedA: 21, seedB: 22, maxTime: 90, hull: 1e6 });
  must(r.stuckWorst < 12, `long duel: a mech went ${r.stuckWorst.toFixed(1)} s without moving 3 m or firing`);
  must(Object.values(r.states[0]).filter((x) => x > 0).length >= 2, "long duel: the AI never changed state");
  worstStuck = Math.max(worstStuck, r.stuckWorst);
}

// ---- Dodge drills: a scripted shooter 40 m off, the rival told to stand (no strafing, any range, no cover) ----
const STAND = { aiStrafe: 0, aiRangeBand: 90, aiCover: 0, aiRetreatAt: 0, aiAggression: 0 };
/** The shooter: stands, aims at the rival where it is (no lead), holds key 3 for 0.7 s whenever it's ready, or charges
 *  its left rail and holds the full charge a varying while before letting go. */
function shooter(kind: "shoulder" | "rail") {
  let since = -1, shots = 0;
  return (i: number, v: DuelView, t: number): MechCommand | null => {
    if (i !== 0) return null;
    const f = v.foe, at = { x: f.x, y: f.y, z: f.z };
    const c: MechCommand = { move: { x: 0, z: 0, sprint: false }, aim: at, shotAt: at, cursor: { x: f.x, y: f.y - 1.5, z: f.z }, lock: { x: f.x, y: f.y, z: f.z, r: f.r, key: "foe" }, trigger: [false, false], keys: [false, false, false, false], dash: null, dashHold: false };
    const w = v.self.weapons[v.self.kit.findIndex((k) => (kind === "rail" ? k.kind === "rail" : "key" in k.ctl))];
    if (!w) return c;
    if (kind === "rail") {
      // Holds the full charge a varying while (0.2-1.4 s), as a player lining up would.
      if (w.charge >= 1 && since < 0) { since = t; shots++; }
      const hold = since < 0 || t - since < 0.2 + ((shots * 0.618) % 1) * 1.2;
      c.trigger[0] = (w.ready || w.charge > 0) && hold;
      if (!c.trigger[0]) since = -1;
    } else {
      if (w.ready && since < 0 && t > 1) since = t;
      c.keys[2] = since >= 0 && t - since < 0.7;
      if (since >= 0 && t - since >= 0.7) since = -1;
    }
    return c;
  };
}
const drill = (pick: Parameters<typeof loadoutFor>[0], kind: "shoulder" | "rail", ai: Partial<typeof RIVAL_AI_DEFAULTS>, time = 60) => {
  const o: DuelOptions = {
    seedA: 1, seedB: 2, maxTime: time, hull: 1e6, ai, script: shooter(kind), cover: 0,
    loadouts: [loadoutFor(pick), loadoutFor({ left: "minigun", right: "minigun", k1: "none", k2: "none", k3: "pack" })],
    starts: [{ x: 0, z: -20, heading: 0 }, { x: 0, z: 20, heading: Math.PI }],
  };
  const r = runDuel(o);
  return { thr: r.threatened[1], dodged: r.dodged[1], dashes: r.dashes[1], taken: Object.values(r.score.rounds[0].dealt).reduce((a, b) => a + b, 0) };
};
type Drill = ReturnType<typeof drill>;
const drills: Record<string, Drill> = {};
const blind: Record<string, Drill> = {};
const KITS = { mortar: { left: "minigun", right: "minigun", k1: "none", k2: "none", k3: "mortar" }, linemortar: { left: "minigun", right: "minigun", k1: "none", k2: "none", k3: "linemortar" }, missiles: { left: "minigun", right: "minigun", k1: "none", k2: "none", k3: "missiles" }, rail: { left: "rail", right: "minigun", k1: "none", k2: "none", k3: "pack" } } as const;
for (const [name, pick] of Object.entries(KITS)) {
  const kind = name === "rail" ? "rail" : "shoulder";
  drills[name] = drill(pick, kind, STAND);
  blind[name] = drill(pick, kind, { ...STAND, aiReaction: 99 });
}
let dThr = 0, dOk = 0, bThr = 0, bOk = 0;
const missileTaken = [drills.missiles.taken, blind.missiles.taken], railTaken = [drills.rail.taken, blind.rail.taken];
// A rail is instant and the shooter's lock follows: no getting out of its line, but a dash after a random beat is often
// mid-shove at the release (half damage).
must(railTaken[0] < railTaken[1] * 0.95, `rail drill: dashing didn't cut the damage (${Math.round(railTaken[0])} vs ${Math.round(railTaken[1])} blind)`);
delete drills.rail; delete blind.rail;
// Missiles follow it down: no getting out, but dashing as they land takes the shove's damage cut.
{
  const d = drills.missiles, b = blind.missiles;
  must(d.taken < b.taken * 0.85, `missiles drill: bracing with a dash didn't cut the damage (${Math.round(d.taken)} vs ${Math.round(b.taken)} blind)`);
  delete drills.missiles; delete blind.missiles;
}
for (const k of Object.keys(drills)) {
  const d = drills[k], b = blind[k];
  dThr += d.thr; dOk += d.dodged; bThr += b.thr; bOk += b.dodged;
  must(d.thr >= 3, `${k} drill: only ${d.thr} shots threatened the rival`);
  must(d.dodged >= d.thr * 0.4, `${k} drill: the rival got out of only ${d.dodged} of ${d.thr}`);
}
must(bOk <= bThr * 0.1, `a rival that never notices still got out of ${bOk} of ${bThr} (the drill's shots should hit a standing mech)`);

// ---- Aim lag and cover (Keith 2026-10-31: "way too hard and insanely accurate") ----
{
  const kit = kitOf(resolve(loadoutFor({ left: "rail", right: "minigun", k1: "none", k2: "none", k3: "pack" })), WEAPON_DEFAULTS);
  const mk = (n: number, fx: number, fz: number, vx: number, sees: boolean, charge: number): DuelView => ({
    t: n / 60, cover: [], sees: () => sees, arena: { x: 0, z: 0, r: 200 },
    self: { x: 0, z: 0, vx: 0, vz: 0, heading: 0, health: 1, dashCharges: 0, canDash: false, dashing: false, walkSpeed: 6, kit, weapons: kit.map((_, i) => ({ i, ready: true, charge })) },
    foe: { x: fx, y: 3, z: fz, vx, vz: 0, health: 1, dashCharges: 0, alive: true, gunsOff: false, airborne: false, staggered: false, r: 1.7 },
    threats: [],
  });
  const { rivalHull: _r, ...REC } = RIVAL_LEVELS.recruit;
  // A rail aimed at a standing foe, which then steps sideways at 6 m/s: the line is still near the old spot half a second on.
  const ai = new RivalAi({ ...RIVAL_AI_DEFAULTS, ...REC, aiAimError: 0 }, 3);
  let lock: { x: number } | null = null;
  for (let n = 0; n < 240; n++) lock = ai.decide(mk(n, 0, 30, 0, true, 0.5), 1 / 60).lock;
  const settled = lock!.x;
  for (let n = 240; n < 288; n++) lock = ai.decide(mk(n, (n - 240) / 60 * 6, 30, 6, true, 0.5), 1 / 60).lock;
  const foeNow = 48 / 60 * 6;
  must(Math.abs(settled) < 1, `rail line didn't settle on a standing foe (${settled.toFixed(1)} m off)`);
  must(foeNow - lock!.x > 2.5, `0.8 s into a sidestep the rail line is only ${(foeNow - lock!.x).toFixed(1)} m behind the foe (hit radius 1.7)`);
  // Cover: the foe out of sight, the aim holds the last spot and nothing but a charged rail's hold fires; after it
  // shows again it needs aiReacquire before the guns open.
  const ai2 = new RivalAi({ ...RIVAL_AI_DEFAULTS, ...REC, aiAimError: 0 }, 4);
  for (let n = 0; n < 240; n++) ai2.decide(mk(n, 0, 30, 0, true, 0), 1 / 60);
  let c = ai2.decide(mk(240, 0, 30, 0, true, 0), 1 / 60);
  let fired = false, drift = 0;
  for (let n = 241; n < 480; n++) { c = ai2.decide(mk(n, 20, 30, 0, false, 0), 1 / 60); fired ||= c.trigger[0] || c.trigger[1]; drift = Math.max(drift, Math.abs(c.shotAt!.x)); }
  must(!fired, "the rival fired at a foe it couldn't see");
  must(drift < 2, `the rival's aim followed a foe behind cover (${drift.toFixed(1)} m)`);
  let early = false;
  for (let n = 480; n < 480 + Math.floor(REC.aiReacquire! * 60) - 3; n++) { c = ai2.decide(mk(n, 20, 30, 0, true, 0), 1 / 60); early ||= c.trigger[0] || c.trigger[1]; }
  must(!early, "the rival fired before re-acquiring a foe stepping out of cover");
  let late = false;
  for (let n = 700; n < 760; n++) { c = ai2.decide(mk(n, 20, 30, 0, true, 0), 1 / 60); late ||= c.trigger[0] || c.trigger[1]; }
  must(late, "the rival never fired once it had re-acquired the foe");

  // Rails and the dash (Keith 2026-10-31): a dash drops the dasher's own rail charge and none builds through it; the
  // rival won't throw its own charge away on a gamble (dashing across a foe's rail), but still does with nothing charging.
  {
    const railLine: Threat = { id: 7, kind: "line", ax: 0, az: 30, x: 0, z: -30, r: 1, t: Infinity, rail: true, charge: 1 };
    const mk2 = (n: number, charge: number): DuelView => ({
      t: n / 60, cover: [], sees: () => true, arena: { x: 0, z: 0, r: 200 },
      self: { x: 0, z: 0, vx: 0, vz: 0, heading: 0, health: 1, dashCharges: 4, canDash: true, dashing: false, walkSpeed: 6, kit, weapons: kit.map((_, i) => ({ i, ready: true, charge })) },
      foe: { x: 0, y: 3, z: 30, vx: 0, vz: 0, health: 1, dashCharges: 0, alive: true, gunsOff: false, airborne: false, staggered: false, r: 1.7 },
      threats: [railLine],
    });
    const dashes = (charge: number) => { const a = new RivalAi({ ...RIVAL_AI_DEFAULTS, aiDashUse: 1, aiAggression: 0 }, 5); let n = 0; for (let k = 0; k < 180; k++) if (a.decide(mk2(k, charge), 1 / 60).dash) n++; return n; };
    const free = dashes(0), keeping = dashes(0.6);
    must(free > 0, "rail: with nothing charging the rival never dashed across a charged rail's line");
    must(keeping === 0, `rail: the rival dashed ${keeping} times with its own rail charging (it would lose the charge)`);
    // Headless duel: the shooter holds its rail and dashes 0.8 s in; through the dash its charge is 0 and stays 0.
    let before = 0, during = 0, after = 0, dashedAt = -1;
    const script = (i: number, vw: DuelView, t: number): MechCommand | null => {
      if (i !== 0) return null;
      const c: MechCommand = { move: { x: 0, z: 0, sprint: false }, aim: null, shotAt: null, cursor: null, lock: { x: 0, y: 3, z: 30, r: 1.7, key: "foe" }, trigger: [false, false], keys: [false, false, false, false], dash: null, dashHold: false };
      c.trigger[0] = true;
      const w = vw.self.weapons[vw.self.kit.findIndex((k) => k.kind === "rail")];
      if (t < 0.8) before = Math.max(before, w.charge);
      else if (dashedAt < 0) { c.dash = { x: 1, z: 0 }; dashedAt = t; }
      else if (vw.self.dashing && t < dashedAt + 0.5) during = Math.max(during, w.charge);
      else if (t > dashedAt + 2) after = Math.max(after, w.charge);
      return c;
    };
    runDuelRaw({ seedA: 1, seedB: 2, maxTime: 4, hull: 1e6, cover: 0, loadouts: [loadoutFor({ left: "rail", right: "minigun", k1: "none", k2: "none", k3: "pack" }), null], script });
    must(before > 0.3, `rail: the scripted rail never charged (${before.toFixed(2)})`);
    must(during === 0, `rail: a charge of ${during.toFixed(2)} survived or built during a dash`);
    must(after > 0, "rail: the trigger still held, the rail never charged again after the dash");
    console.log(`rail vs dash: the rival dashed across a foe's rail ${free}× with nothing charging, ${keeping}× with its own charging · a dash dropped a ${before.toFixed(2)} charge (${during.toFixed(2)} through it, ${after.toFixed(2)} after)`);
  }

  // Duels against a scripted player who stands or strafes (cover 0): Recruit misses a strafing player most of the time,
  // still punishes one who stands; Ace hits more; Recruit's time to kill with the default pick is 8-25 s.
  const idle = (): MechCommand => ({ move: { x: 0, z: 0, sprint: false }, aim: null, shotAt: null, cursor: null, lock: null, trigger: [false, false], keys: [false, false, false, false], dash: null, dashHold: false });
  const mode = (strafe: boolean) => (i: number, _v: DuelView, t: number): MechCommand | null => { if (i !== 0) return null; const m = idle(); if (strafe) m.move.x = Math.sin(t * 0.5) >= 0 ? 1 : -1; return m; };
  const taken = (lvl: keyof typeof RIVAL_LEVELS, strafe: boolean) => {
    let sum = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const r = runDuelRaw({ seedA: 1, seedB: 100 + seed, maxTime: 30, hull: 1e6, cover: 0, aiSeed: seed, loadouts: [loadoutFor({ left: "minigun", right: "minigun", k1: "none", k2: "none", k3: "pack" }), null], aiEach: [undefined, RIVAL_LEVELS[lvl]], script: mode(strafe) });
      // (the missile swarm homes and is only cut by a dash: left out of the strafing question)
      sum += Object.entries(r.score.rounds[0].taken).reduce((a, [k, x]) => a + (k === "missiles" ? 0 : x), 0) / 8;
    }
    return sum;
  };
  const stand = RIVAL_LEVEL_IDS.map((l) => taken(l, false)), strafe = RIVAL_LEVEL_IDS.map((l) => taken(l, true));
  must(stand[0] > 1500, `a Recruit barely hurt a player who stands still (${Math.round(stand[0])} in 30 s)`);
  must(strafe[0] < stand[0] * 0.4, `a Recruit still hit a strafing player for ${Math.round(strafe[0])} vs ${Math.round(stand[0])} standing`);
  must(stand[0] < stand[2] && strafe[0] < strafe[2], `levels not ordered (stand ${stand.map(Math.round)} strafe ${strafe.map(Math.round)})`);
  let wins = 0, tt = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const r = runDuelRaw({ seedA: 1, seedB: 100 + seed, maxTime: 90, cover: 0, aiSeed: seed, loadouts: [loadoutFor({ left: "minigun", right: "rpg", k1: "missiles", k2: "none", k3: "mortar" }), null], aiEach: [RIVAL_LEVELS.veteran, RIVAL_LEVELS.recruit], hullMul: [1, RIVAL_LEVELS.recruit.rivalHull] });
    if (r.winner === 0) { wins++; tt += r.time; }
  }
  must(wins >= 6, `a Veteran-proxy player beat the Recruit in only ${wins} of 8`);
  must(wins > 0 && tt / wins > 8 && tt / wins < 25, `Recruit time to kill ${(tt / Math.max(1, wins)).toFixed(1)} s (want 8-25)`);
  console.log(`levels (${RIVAL_LEVEL_IDS.join("/")}): damage to a standing player ${stand.map(Math.round)} vs strafing ${strafe.map(Math.round)} per 30 s; Recruit dies in ${(tt / Math.max(1, wins)).toFixed(1)} s (${wins}/8)`);
}


// ---- Rival item level (Keith 2026-10-31: ?rivalup=N rolls its items N levels above the player's, on the shared curve) ----
{
  const up = 5, g = LOOT_DEFAULTS.levelGrowth ?? 0.075, k = levelPower(1 + up, g) / levelPower(1, g);
  must(Math.abs(k - 1.375) < 1e-9, `the shared curve isn't 1 + 0.075 x (level - 1) (${k})`);
  for (const seed of [1, 3, 7]) {
    const a = rollRivalLoadout(seed, LOOT_DEFAULTS), b = rollRivalLoadout(seed, LOOT_DEFAULTS, { level: 1 + up });
    must(loadoutLevel(a) === 1 && loadoutLevel(b) === 1 + up, `seed ${seed}: loadout levels ${loadoutLevel(a)} / ${loadoutLevel(b)}`);
    const ha = resolve(a).values.hull, hb = resolve(b).values.hull;
    must(Math.abs(hb / ha - k) < 0.02, `seed ${seed}: hull x${(hb / ha).toFixed(3)} at +${up} levels, want x${k.toFixed(3)}`);
    const da = loadoutDps(a), db = loadoutDps(b);
    must(da > 0 && db / da > k - 0.03 && db / da < k * 1.1, `seed ${seed}: DPS x${(db / da).toFixed(3)} at +${up} levels, want x${k.toFixed(3)} (a bit more where a magazine grows too)`);
    must(a.legs?.base === b.legs?.base && a.hull?.rarity === b.hull?.rarity, `seed ${seed}: the level changed which parts rolled`);
  }
  const a = rollRivalLoadout(3, LOOT_DEFAULTS), b = rollRivalLoadout(3, LOOT_DEFAULTS, { level: 6 });
  console.log(`rivalup +5 (seed 3): hull ${Math.round(resolve(a).values.hull)} -> ${Math.round(resolve(b).values.hull)}, DPS ${Math.round(loadoutDps(a))} -> ${Math.round(loadoutDps(b))} (x${k.toFixed(3)})`);
  must(RIVAL_LEVELS.recruit.rivalHull === 1, "Recruit's hull isn't on par with the player's (x1)");
  must(RIVAL_LEVELS.recruit.rivalHull < RIVAL_LEVELS.veteran.rivalHull && RIVAL_LEVELS.veteran.rivalHull < RIVAL_LEVELS.ace.rivalHull, "rival hull shares aren't ordered by level");
}

const pct = (a: number, b: number) => `${b ? Math.round((100 * a) / b) : 0}%`;
console.log(`duels ${pairs.length}: both damaged in ${both}, ${kills} kills (mean ${(ttk / Math.max(1, kills)).toFixed(1)} s), telegraphed shots dodged ${thr[1]}/${thr[0]} (${pct(thr[1], thr[0])}), worst idle ${worstStuck.toFixed(1)} s`);
console.log(`rail drill: damage ${Math.round(railTaken[0])} dashing vs ${Math.round(railTaken[1])} blind`);
console.log(`missiles drill: damage ${Math.round(missileTaken[0])} bracing vs ${Math.round(missileTaken[1])} blind`);
console.log("drills (dodged/threatened, dashes; blind):", Object.entries(drills).map(([k, d]) => `${k} ${d.dodged}/${d.thr} ${d.dashes}d (${blind[k].dodged}/${blind[k].thr})`).join(" · "), `· total ${pct(dOk, dThr)} vs blind ${pct(bOk, bThr)}`);
if (fails.length) { console.log("FAIL\n  " + fails.join("\n  ")); throw new Error("duel check failed"); }
console.log("duel check passed");
