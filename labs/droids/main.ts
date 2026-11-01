// Humanoid robots lab (Keith 2026-11-01): the robots' middle tier on the human rig, between the scuttlers and the big
// walkers. Squads of 3.2 m white machines stride in over the dunes, hold a firing band and fire bursts of blue pulses,
// each burst told by a red seeking laser that lies on you first. They never break; rounds stop on them (metal).
// Flags: ?squad=N (squad size), ?max=N (on the field), ?still (one squad frozen 13 m ahead, for looking), plus the
// combat-lab flags (?manual, ?zoom=, ?dt=, ?flat, ?onfoot ...).
import "../../src/core/lab.css";
import type { Param } from "../../src/core/tweaks";
import { combatLab } from "../../src/game/combatLab";
import { DROID_DEFAULTS, DROID_PARAMS, DROID_GROUPS } from "../../src/combat/droids";
import { loadBanditVat } from "../../src/combat/banditVat";
import { DroidFight } from "../../src/game/droidFight";

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : d);
const WAVE_DEFAULTS = { droidField: num("max", 18), droidSquad: num("squad", 6), droidEvery: 10, droidFrom: 80 };
const WAVE_PARAMS: Param[] = [
  { key: "droidField", label: "Robots on the field", min: 0, max: 200, step: 1, group: "Humanoid waves", tip: "Squads keep coming until this many are up" },
  { key: "droidSquad", label: "Squad size", min: 1, max: 40, step: 1, group: "Humanoid waves" },
  { key: "droidEvery", label: "A squad every (s)", min: 1, max: 60, step: 0.5, group: "Humanoid waves" },
  { key: "droidFrom", label: "They come from (m)", min: 20, max: 200, step: 5, group: "Humanoid waves" },
];

let fight: DroidFight | null = null;
const lab = await combatLab({
  id: "droids-lab",
  title: "Humanoid robots",
  defaults: { ...DROID_DEFAULTS, ...WAVE_DEFAULTS },
  params: [...WAVE_PARAMS, ...DROID_PARAMS],
  topics: [{ id: "droids", label: "Humanoid robots", groups: ["Humanoid waves", ...DROID_GROUPS] }],
  selectables: [{ topic: "droids", label: "Humanoid robots", objects: () => (fight ? [fight.draw.mesh] : []) }],
  actions: [{ label: "Squad now", onClick: () => squad() }],
  report: () => ({ droids: fight?.count ?? 0, pulses: fight?.pulses ?? 0 }),
});
const { V, bf, player, field } = lab;
const vat = await loadBanditVat().catch((e) => { console.warn("bandit bake not loaded, boxes instead:", e); return null; });
fight = new DroidFight(bf, lab.app.scene, V, field, vat, lab.deaths);
const f = fight;
// A dash rams them flat (they get back up).
player.onDash = (x, z, dx, dz) => { if (f.sw.shove(x, z, V.dashShoveRadius * 1.2, dx, dz, V.dashShove * 0.5, V.dashShoveDamage)) bf.sfx.play("metalHit", player.sim.pelvis, 0.8, 0.7, false); };

function squad(at?: { x: number; z: number }) {
  const p = player.sim.pos, a = Math.random() * Math.PI * 2;
  const x = at?.x ?? p.x + Math.sin(a) * V.droidFrom, z = at?.z ?? p.z + Math.cos(a) * V.droidFrom;
  return f.spawn(Math.round(V.droidSquad), x, z);
}

const still = q.has("still");
if (still) {
  const p = player.sim.pos;
  for (const i of squad({ x: p.x + 4, z: p.z + 13 })) f.sw.frozen[i] = 1;
}
let clock = Infinity;
lab.onFrame((dt) => {
  clock += dt;
  if (!still && f.count < V.droidField && clock >= V.droidEvery) { clock = 0; squad(); }
  const prey = lab.prey(player.sim.pos.x, player.sim.pos.z);
  f.update(dt, prey);
  lab.hud("droids", `humanoid robots ${f.count} up · killed ${f.target.kills} · pulses at you ${f.pulses}`);
});
