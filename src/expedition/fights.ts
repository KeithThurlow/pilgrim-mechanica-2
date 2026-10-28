// Fights between groups off the field, and what they leave behind (Keith 2026-10-28, docs/proposal-factions.md; the
// rules are in src/game/factions.ts, this is the bookkeeping over the groups the systems hand it).
// - Skirmishes: every half second, the groups that are not on the field (camps and packs of robots, bandit camps, war
//   band columns: the AbstractGroup sources) are checked for hostile pairs within clashRange. A pair fights by the
//   numbers (stepClash) until one side breaks; the winner keeps its survivors, damaged; the loser is gone. A group that
//   comes onto the field mid-clash (the mech got near) leaves it with its strength so far, and the director takes over.
//   The radar shows each ongoing clash as a flicker (`fighting()`).
// - Aftermath: a resolved clash is a plain-data event; `aftermathSite` turns it into a salvage site of wrecks and scrap
//   spots at the spot (stripped like any POI), and the glue rolls item drops from the loot-feel drops (drops.ts).
// Host state (seeded: nothing here is random except the hash of the clash's id for the wreck layout).
import { hash4, type PoiPlacement } from "../world/pois";
import { SiteBuilder, type PoiSite } from "../pois/site";
import type { CarKind } from "../vehicles/car";
import type { ThreatField } from "./threats";
import { FACTION, robotPower, newClash, sideOf, stepClash, survivors, type AbstractGroup, type Clash, type FactionValues, type Relations, type Side } from "../game/factions";

export interface ClashEvent {
  type: "clash";
  id: string;
  x: number; z: number;
  winner: Side; loser: Side;
  /** Heads the winner kept and how hurt they are (0-1). */
  kept: number; hurt: number;
  /** Heads lost on both sides together, by faction (robots / raiders). */
  lostRobots: number; lostRaiders: number;
  /** Seconds it took. */
  seconds: number;
  /** A raider vehicle column was in it. */
  vehicles: boolean;
}

/** Fills `out` with the groups off the field within r of (x, z). */
export type GroupSource = (x: number, z: number, r: number, out: AbstractGroup[]) => void;

const TICK = 0.5, REACH = 2500;

export class Skirmishes {
  readonly clashes: Clash[] = [];
  /** Resolved this step (the glue drains them). */
  readonly events: ClashEvent[] = [];
  private byId = new Map<string, AbstractGroup>();
  private list: AbstractGroup[] = [];
  private acc = 0;
  /** Clashes started and resolved so far (checks and HUDs). */
  started = 0; resolved = 0;

  constructor(public v: FactionValues, public rel: Relations, private sources: GroupSource[]) {}

  /** Where the fights are now, for the radar's flicker. */
  fighting(): { id: string; x: number; z: number; power: number }[] {
    return this.clashes.map((c) => ({ id: c.id, x: c.x, z: c.z, power: c.a.power + c.b.power }));
  }

  reset() {
    for (const c of this.clashes) { this.byId.get(c.a.id)?.hold(false); this.byId.get(c.b.id)?.hold(false); }
    this.clashes.length = 0; this.events.length = 0; this.acc = 0;
  }

  /** One frame; px, pz: the player (sources keep to what is within reach of him). */
  update(dt: number, px: number, pz: number) {
    this.acc += dt;
    if (this.acc < TICK) return;
    const step = this.acc;
    this.acc = 0;
    const list = this.list, v = this.v;
    list.length = 0;
    for (const s of this.sources) s(px, pz, REACH, list);
    this.byId.clear();
    for (const g of list) this.byId.set(g.id, g);
    // Ongoing clashes.
    for (let k = this.clashes.length - 1; k >= 0; k--) {
      const c = this.clashes[k], ga = this.byId.get(c.a.id), gb = this.byId.get(c.b.id);
      if (!ga || !gb) {
        // One of them came onto the field (or vanished): the other keeps what strength it has left.
        for (const [g, s] of [[ga, c.a], [gb, c.b]] as const) if (g) { const r = survivors(s, false); g.apply(r.count, r.hurt); g.hold(false); }
        this.clashes.splice(k, 1);
        continue;
      }
      stepClash(c, step, v);
      if (!c.done) continue;
      this.clashes.splice(k, 1);
      this.finish(c, ga, gb);
    }
    // New ones: hostile groups close enough, neither already fighting.
    const busy = new Set<string>();
    for (const c of this.clashes) { busy.add(c.a.id); busy.add(c.b.id); }
    for (let a = 0; a < list.length; a++) {
      const ga = list[a];
      if (busy.has(ga.id) || ga.count <= 0) continue;
      for (let b = a + 1; b < list.length; b++) {
        const gb = list[b];
        if (busy.has(gb.id) || gb.count <= 0 || !this.rel.hostile(ga.faction, gb.faction)) continue;
        if (Math.hypot(ga.x - gb.x, ga.z - gb.z) > v.clashRange) continue;
        const c = newClash(sideOf(ga.id, ga.faction, ga.count, ga.power), sideOf(gb.id, gb.faction, gb.count, gb.power), (ga.x + gb.x) / 2, (ga.z + gb.z) / 2);
        ga.hold(true); gb.hold(true);
        busy.add(ga.id); busy.add(gb.id);
        this.clashes.push(c);
        this.started++;
        break;
      }
    }
  }

  private finish(c: Clash, ga: AbstractGroup, gb: AbstractGroup) {
    const aWins = c.winner === "a";
    const win = aWins ? c.a : c.b, lose = aWins ? c.b : c.a, gw = aWins ? ga : gb, gl = aWins ? gb : ga;
    const keep = survivors(win, false);
    gw.apply(keep.count, keep.hurt);
    gl.apply(0, 1);
    gw.hold(false); gl.hold(false);
    const lostW = win.count - keep.count, lostL = lose.count;
    const robots = (s: Side, n: number) => (s.faction === 0 ? n : 0), raiders = (s: Side, n: number) => (s.faction === 1 ? n : 0);
    this.resolved++;
    this.events.push({
      type: "clash", id: c.id, x: c.x, z: c.z, winner: win, loser: lose, kept: keep.count, hurt: keep.hurt,
      lostRobots: robots(win, lostW) + robots(lose, lostL), lostRaiders: raiders(win, lostW) + raiders(lose, lostL),
      seconds: c.t, vehicles: ga.vehicles || gb.vehicles,
    });
  }
}

/**
 * The wrecks a clash leaves, as a salvage site at its spot: scrap spots (their value from the fighters lost) among
 * burnt vehicles when a column fought, robot husks and fallen bandits as debris. Deterministic from the clash id.
 */
export function aftermathSite(ev: ClashEvent, v: FactionValues, n: number): PoiSite {
  const seed = hash4(0xc1a5, Math.round(ev.x), Math.round(ev.z), n);
  const place: PoiPlacement = { id: `clash:${ev.id}:${n}`, kind: "deadConvoy", tier: 2, x: ev.x, z: ev.z, yaw: (seed % 628) / 100, seed, pad: null, level: -1, reach: 18 };
  const b = new SiteBuilder(place);
  const lost = ev.lostRobots + ev.lostRaiders;
  const spots = Math.max(1, Math.min(6, Math.round(lost / 3)));
  const sec = b.section("Wreckage");
  const per = (lost * v.clashScrap) / spots;
  const kinds: CarKind[] = ["technical", "gunTruck", "technical", "sixWheeler"];
  if (ev.vehicles) for (let k = 0; k < Math.min(4, Math.max(1, ev.lostRaiders)); k++) b.vehicle(kinds[k % kinds.length], b.jit(7), b.jit(7), b.r() * 6.28, sec, b.jit(0.25), b.jit(0.5));
  b.debris(6 + Math.min(14, lost), 2, 12);
  const label = ev.lostRobots >= ev.lostRaiders ? "Robot husks" : ev.vehicles ? "Burnt raider vehicles" : "Fallen bandits";
  for (let k = 0; k < spots; k++) b.spot(sec, b.jit(8), b.jit(8), 0.6, per * (0.7 + 0.6 * b.r()), 2.5, label);
  return b.done();
}

/** Item drops a clash leaves: one per ten fighters lost × clashLoot (at least one if any were lost and the slider is up). */
export function clashDrops(ev: ClashEvent, v: FactionValues): number {
  const lost = ev.lostRobots + ev.lostRaiders;
  if (lost <= 0 || v.clashLoot <= 0) return 0;
  return Math.max(1, Math.round((lost / 10) * v.clashLoot));
}

/** Roaming packs and raids of robots that are not on the field, as groups for the clashes. */
export function packSource(threats: ThreatField, f: FactionValues, shares: { robotMidShare: number; robotBigShare: number }): GroupSource {
  const cache = new Map<string, AbstractGroup>();
  return (x, z, r, out) => {
    for (const p of threats.packs) {
      if (p.state === "live" || p.n <= 0 || Math.hypot(p.x - x, p.z - z) > r) continue;
      let g = cache.get(p.id);
      if (!g) {
        g = {
          id: p.id, faction: FACTION.robots, x: p.x, z: p.z, count: p.n, power: 0, vehicles: false,
          apply: (count, hurt) => { p.n = count; p.hurt = Math.min(0.9, 1 - (1 - (p.hurt ?? 0)) * (1 - hurt)); },
          hold: (on) => { p.busy = on; },
        };
        cache.set(p.id, g);
      }
      g.x = p.x; g.z = p.z; g.count = p.n;
      g.power = robotPower(f, p.n, shares.robotMidShare + p.mid, shares.robotBigShare + p.big) * (1 - (p.hurt ?? 0));
      out.push(g);
    }
  };
}
