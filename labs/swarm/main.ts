// Swarm lab (Keith 2026-11-02: "collapse our swarm labs into one, where we can just adjust the kind of swarm based on
// enemy type, and potentially even have it so that all enemies turn up in a swarm"). One combat field; which enemies
// come is ?enemy=robots|bandits|warband|droids|crusher, a list (?enemy=robots,bandits) or ?enemy=mix (all of them), or the
// enemy buttons in the panel (the page reloads with the new list). Robots by default. Each enemy kind is a front
// (src/game/fronts/), with its own flags as its old lab had them; the weapon flags (?left= ?right= ?k1-3= ?barrage
// ?proto=) and every other combat-lab flag work whatever comes; ?summon brings the summoner's units on your side. The old
// labs (robots, bandits, warband, droids, crusher, summoner,
// strider) forward here.
import "../../src/core/lab.css";
import type { Param } from "../../src/core/tweaks";
import { combatLab, type SelectEntry } from "../../src/game/combatLab";
import { BodyContact } from "../../src/game/bodyContact";
import { DroidSquads } from "../../src/game/droidFight";
import { loadBanditVat } from "../../src/combat/banditVat";
import { FRONT_IDS, FRONT_LABELS, type Front, type FrontId, type Running, type Topic } from "../../src/game/fronts/front";
import { robotsFront } from "../../src/game/fronts/robots";
import { banditsFront } from "../../src/game/fronts/bandits";
import { warbandFront } from "../../src/game/fronts/warband";
import { droidsFront } from "../../src/game/fronts/droids";
import { crusherFront } from "../../src/game/fronts/crusher";
import { summonerFront, summonGearInUrl } from "../../src/game/fronts/summoner";
import type { Summons } from "../../src/summon/summons";

const q = new URLSearchParams(location.search);
const ID = "swarm-lab";

function enemies(): FrontId[] {
  const raw = (q.get("enemy") ?? "robots").toLowerCase();
  if (raw === "mix" || raw === "all") return [...FRONT_IDS];
  const alias: Record<string, FrontId> = { crushers: "crusher", robot: "robots", bandit: "bandits", band: "warband", raiders: "warband", humanoids: "droids", droid: "droids" };
  const ids = raw.split(",").map((s) => (alias[s] ?? s) as FrontId).filter((s) => FRONT_IDS.includes(s));
  return ids.length ? [...new Set(ids)] : ["robots"];
}
const on = new Set(enemies());
const make: Record<FrontId, () => Front> = {
  robots: () => robotsFront(q),
  bandits: () => banditsFront(),
  warband: () => warbandFront(),
  droids: () => droidsFront(q),
  crusher: () => crusherFront(q),
};
const fronts = FRONT_IDS.filter((id) => on.has(id)).map((id) => make[id]());
// ?summon: the summoner's units (drones, companions, the scrap swarm) on your side, whatever enemies come. Last, so they
// move after the enemies each frame.
const summonOn = q.has("summon") || summonGearInUrl(q);
let summons: Summons | null = null;
if (summonOn) fronts.push(summonerFront(q, (s) => { summons = s; }));

// The first visit brings over the sliders saved in the old labs, so tuning done there isn't lost.
try {
  if (!localStorage.getItem(`pm2:${ID}`)) {
    const v: Record<string, unknown> = {}, d: Record<string, unknown> = {};
    for (const old of ["crusher-lab", "summoner-lab", "droids-lab", "warband-lab", "bandits-lab", "robots-lab"]) {
      const s = JSON.parse(localStorage.getItem(`pm2:${old}`) || "{}") as { v?: object; d?: object };
      if (s.v && s.d) { Object.assign(v, s.v); Object.assign(d, s.d); }
    }
    if (Object.keys(v).length) localStorage.setItem(`pm2:${ID}`, JSON.stringify({ v, d }));
  }
} catch { /* storage blocked: defaults */ }

// Every front's tuning on one panel: values merged, sliders once each, topics of the same id merged.
const defaults: Record<string, number> = {};
const params: Param[] = [], seen = new Set<string>();
const topics: Topic[] = [];
const selectables: SelectEntry[] = [];
const frontActions: { label: string; onClick: () => void; active?: () => boolean }[] = [];
for (const f of fronts) {
  Object.assign(defaults, f.spec.defaults);
  for (const p of f.spec.params) if (!seen.has(p.key)) { seen.add(p.key); params.push(p); }
  for (const t of f.spec.topics) {
    const had = topics.find((x) => x.id === t.id);
    if (had) had.groups = [...new Set([...had.groups, ...t.groups])];
    else topics.push({ ...t, groups: [...t.groups] });
  }
  selectables.push(...(f.spec.selectables ?? []));
  frontActions.push(...(f.spec.actions ?? []));
}
// The enemy buttons: each turns its kind on or off (the page reloads with the new ?enemy=); All brings every kind.
const reload = (ids: FrontId[]) => {
  const next = new URLSearchParams(location.search);
  next.set("enemy", ids.length === FRONT_IDS.length ? "mix" : ids.join(","));
  location.search = next.toString().replace(/=(&|$)/g, "$1");
};
const enemyActions = [
  ...FRONT_IDS.map((id) => ({
    label: FRONT_LABELS[id],
    active: () => on.has(id),
    onClick: () => { const s = new Set(on); if (s.has(id)) s.delete(id); else s.add(id); if (s.size) reload(FRONT_IDS.filter((x) => s.has(x))); },
  })),
  { label: "All enemies", active: () => on.size === FRONT_IDS.length, onClick: () => reload([...FRONT_IDS]) },
  {
    label: "Your units (summoner)", active: () => summonOn,
    onClick: () => { const next = new URLSearchParams(location.search); if (summonOn) { next.delete("summon"); next.delete("summoner"); } else next.set("summon", ""); location.search = next.toString().replace(/=(&|$)/g, "$1"); },
  },
];

// ?lmb=x,z holds the left button aimed there, ?fireat=N lets go after N frames (shot flags, 2026-10-26).
const xy = (s: string | null) => { if (!s) return null; const [x, z] = s.split(",").map(Number); return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null; };
const lmb = xy(q.get("lmb"));
const fireAt = q.has("fireat") ? Number(q.get("fireat")) : Infinity;
let frame = 0;
let groundAt: (x: number, z: number) => number = () => 0;

const lab = await combatLab({
  id: ID,
  title: `Swarm: ${[...on].map((id) => FRONT_LABELS[id]).join(", ")}${summonOn ? " + your units" : ""}`,
  defaults,
  params,
  topics,
  selectables,
  actions: [...enemyActions, ...frontActions],
  report: () => Object.assign({ enemy: [...on].join(",") }, ...fronts.map((f) => f.spec.report?.() ?? {})),
  onChange: (key) => { for (const f of fronts) f.spec.onChange?.(key); },
  demo: (t, dt) => {
    for (const f of fronts) { const d = f.spec.demo?.(t, dt); if (d) return d; }
    if (!lmb) return null;
    frame++;
    return { cmd: { x: 0, z: 0, sprint: false }, aim: { x: lmb.x, y: groundAt(lmb.x, lmb.z) + 1.2, z: lmb.z }, trigger: [frame < fireAt, false] };
  },
});
const { V, bf, player, field } = lab;
groundAt = (x, z) => field.height(x, z);
// One body for the mech on this field: every front's enemies are trampled by it (src/game/bodyContact.ts).
const contact = new BodyContact(player, bf);
// The humanoid squads, made once for whichever front asks first (the droids front, or the robots' packs).
let squads: DroidSquads | null = null;
let making: Promise<DroidSquads> | null = null;
const droids = () => making ??= loadBanditVat().catch(() => null).then((vat) => (squads = new DroidSquads(bf, lab.app.scene, V as never, field, vat, lab.deaths)));

const running: Running[] = [];
for (const f of fronts) running.push(await f.start({ lab, contact, q, droids, summons: () => summons, fronts: on }));

lab.onFrame((dt) => {
  for (const r of running) r.update(dt);
  if (squads) {
    squads.update(dt, lab.prey(player.sim.pos.x, player.sim.pos.z));
    lab.hud("droids", squads.count || on.has("droids") ? `humanoid robots ${squads.count} up · killed ${squads.kills} · pulses at you ${squads.pulses}` : "");
  }
  contact.step(dt);
  for (const r of running) r.touch?.(dt);
  lab.hud("trample", `trampled ${contact.kills}`);
});
