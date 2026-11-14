// Bandit mech lances out in the sand (pure, seeded; Keith 2026-11-14: "robot swarms feel way more common and way more
// overwhelming than bandits... bandits need mechs as well, and we need to encounter more mech enemies in general").
// The raider faction's mechs, on the player's own rig (src/game/fieldRival.ts: the duel's brain on a rolled loadout):
// - lances: groups of 1-2 bandit mechs (more deep out) wandering a few hundred metres off, kept topped up round the
//   mech like the robots' roaming packs; one that hears the mech hunts it, and within lanceEngage it comes onto the
//   field (src/expedition/fieldMechs.ts puts the Ramparts down);
// - mech raids and the first fight: the robot raids and the first scout pack (threats.ts) are a lance instead, a share
//   of the time (lanceRaidShare, lanceFirstShare);
// - camp guards: a bandit camp may keep a mech or two at its post (campMechs, by depth), woken with the camp.
// How hard each one is comes from `mechGrade` (danger in, items vs the player's level, rival level and hull out), the
// one place to swap for a threat level when it lands.
// Lances are points here (where, heading, how many) until they engage; the glue hands survivors back when the mech
// gets far. Host state (seeded random only; events are plain data).
import type { Param } from "../core/tweaks";
import type { RivalLevel } from "../combat/rivalAi";
import { hash4, rng } from "../world/pois";
import { DEPTH_GROUP, scaled } from "./depth";

export const LANCE_DEFAULTS = {
  lancePacks: 1,
  lanceFrom: 320,
  lanceTo: 650,
  lanceDrop: 1200,
  lanceMin: 1,
  lanceMax: 2,
  lanceSpeed: 3,
  lanceHuntSpeed: 5,
  lanceHear: 280,
  lanceLoud: 1.6,
  lanceEngage: 140,
  lanceFirstShare: 0.5,
  lanceRaidShare: 0.5,
  lanceRaidSize: 2,
  lanceArena: 80,
  lanceGiveUp: 320,
  fieldMechMax: 4,
  lanceDrops: 1,
  lanceUp: -1,
  lanceHull: 1,
  campMechChance: 0.3,
  campMechWake: 140,
  campMechArena: 60,
  // Depth (src/expedition/depth.ts): at danger 1, 1 (or 0) at the road.
  lancePacksFar: 2.5,
  lanceSizeFar: 1.6,
  lanceUpFar: 2,
  lanceVetAt: 0.6,
  lanceAceAt: 1.3,
  campMechChanceFar: 2.5,
  campMechTwoAt: 0.8,
};
export type LanceValues = typeof LANCE_DEFAULTS;

export const LANCE_GROUP = "Bandit mechs", LANCE_HARD_GROUP = "Bandit mechs: how hard";
const G = LANCE_GROUP, H = LANCE_HARD_GROUP;
export const LANCE_PARAMS: Param[] = [
  { key: "lancePacks", label: "Lances round the mech", min: 0, max: 6, step: 1, group: G, tip: "Groups of bandit mechs kept wandering within reach while you're out (more deep out)" },
  { key: "lanceMin", label: "Smallest lance (mechs)", min: 1, max: 4, step: 1, group: G },
  { key: "lanceMax", label: "Biggest lance (mechs)", min: 1, max: 4, step: 1, group: G },
  { key: "lanceFrom", label: "Turn up from (m)", min: 100, max: 1500, step: 10, group: G },
  { key: "lanceTo", label: "Turn up to (m)", min: 150, max: 2000, step: 10, group: G },
  { key: "lanceDrop", label: "Forgotten past (m)", min: 400, max: 3000, step: 10, group: G },
  { key: "lanceSpeed", label: "Wander speed (m/s)", min: 0, max: 10, step: 0.1, group: G },
  { key: "lanceHuntSpeed", label: "Hunting speed (m/s)", min: 0, max: 12, step: 0.1, group: G },
  { key: "lanceHear", label: "Hears the mech within (m)", min: 0, max: 1000, step: 5, group: G },
  { key: "lanceLoud", label: "Loud: hearing ×", min: 1, max: 4, step: 0.05, group: G },
  { key: "lanceEngage", label: "Comes onto the field within (m)", min: 40, max: 400, step: 5, group: G },
  { key: "lanceFirstShare", label: "First fight is a lance (share)", min: 0, max: 1, step: 0.05, group: G, tip: "The first fight of a trip (Packs and raids › First fight by) is a bandit lance this share of the time, else the robot scout pack" },
  { key: "lanceRaidShare", label: "Raids that are mech raids (share)", min: 0, max: 1, step: 0.05, group: G, tip: "This share of the timed raids is a bandit lance hunting the mech instead of a robot wave" },
  { key: "lanceRaidSize", label: "Mech raid size (mechs)", min: 1, max: 4, step: 1, group: G, tip: "× the lance size depth multiplier" },
  { key: "lanceArena", label: "Fights within (m of the mech)", min: 20, max: 200, step: 5, group: G, tip: "A lance on the field keeps inside this circle round you" },
  { key: "lanceGiveUp", label: "Gives up past (m)", min: 100, max: 1000, step: 10, group: G, tip: "Leave a lance this far behind and it goes back to wandering" },
  { key: "fieldMechMax", label: "Bandit mechs on the field at most", min: 1, max: 8, step: 1, group: G, tip: "Lances and camp guards together (fortress mechs and HVTs not counted)" },
  { key: "lanceDrops", label: "Items a bandit mech drops", min: 0, max: 6, step: 1, group: G },
  { key: "campMechChance", label: "Camps with a guard mech (share)", min: 0, max: 1, step: 0.01, group: G, tip: "At the road; × the depth multiplier (capped at 90%)", onRelease: true },
  { key: "campMechWake", label: "Guard mech fights within (m)", min: 20, max: 400, step: 5, group: G, tip: "Once its camp is alert" },
  { key: "campMechArena", label: "Guard mech keeps within (m of camp)", min: 20, max: 200, step: 5, group: G },
  { key: "lanceUp", label: "Items vs yours at the road", min: -10, max: 20, step: 1, group: H, tip: "Their items roll this many levels above (or below) the mean level of yours, as the duel lab's rival" },
  { key: "lanceUpFar", label: "Items: levels added at full depth", min: 0, max: 10, step: 0.5, group: H },
  { key: "lanceVetAt", label: "Veteran brains from danger", min: 0, max: 2, step: 0.05, group: H, tip: "Below this they are Recruits (slow aim)" },
  { key: "lanceAceAt", label: "Ace brains from danger", min: 0, max: 3, step: 0.05, group: H },
  { key: "lanceHull", label: "Hull ×", min: 0.2, max: 5, step: 0.05, group: H, tip: "On top of their level's hull share" },
  { key: "lancePacksFar", label: "Bandit lances × at full depth", min: 1, max: 5, step: 0.05, group: DEPTH_GROUP },
  { key: "lanceSizeFar", label: "Bandit lance size × at full depth", min: 1, max: 4, step: 0.05, group: DEPTH_GROUP },
  { key: "campMechChanceFar", label: "Camp guard mechs × at full depth (chance)", min: 1, max: 5, step: 0.05, group: DEPTH_GROUP, onRelease: true },
  { key: "campMechTwoAt", label: "Two guard mechs from danger", min: 0, max: 2, step: 0.05, group: DEPTH_GROUP, onRelease: true },
];
export const LANCE_GROUPS = [G, H];

/** How hard a bandit mech is at a danger (src/expedition/depth.ts). The hook a threat level would replace. */
export interface MechGrade { up: number; ai: RivalLevel; hull: number }
export function mechGrade(v: LanceValues, danger: number): MechGrade {
  const d = Math.max(0, danger);
  return {
    up: Math.round(v.lanceUp + v.lanceUpFar * Math.min(1.5, d)),
    ai: d >= v.lanceAceAt ? "ace" : d >= v.lanceVetAt ? "veteran" : "recruit",
    hull: v.lanceHull,
  };
}

/** Guard mechs a bandit camp keeps (0, 1 or 2), from its seed and danger: the same for everyone. */
export function campMechs(v: LanceValues, seed: number, danger: number): number {
  const r = rng(hash4(seed, 41, 43, 47));
  if (r() >= Math.min(0.9, v.campMechChance * scaled(v.campMechChanceFar, danger))) return 0;
  return danger >= v.campMechTwoAt ? 2 : 1;
}

export type LanceKind = "lance" | "raid" | "scout";
export interface Lance {
  id: string;
  kind: LanceKind;
  x: number; z: number;
  heading: number; speed: number;
  /** Mechs in it. */
  n: number;
  /** roam: wandering; hunt: closing on the mech; live: on the field (the glue moves it). */
  state: "roam" | "hunt" | "live";
  turn: number;
  /** Danger where it turned up (how hard its mechs are). */
  danger: number;
  /** Seeds its mechs' loadouts. */
  seed: number;
}

export interface LanceMe { x: number; z: number; out: boolean; loud: boolean; danger: number }
export type LanceEvent = { type: "engage"; lance: Lance };

export class LanceField {
  readonly lances: Lance[] = [];
  private seq = 0;
  private rs: number;

  constructor(public v: LanceValues, seed = 1, private avoid: (x: number, z: number) => boolean = () => false) {
    this.rs = (seed >>> 0) || 1;
  }

  rand(): number {
    let t = (this.rs = (this.rs + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  reset() { this.lances.length = 0; }

  private ring(x: number, z: number, r0: number, r1: number): { x: number; z: number; a: number } | null {
    for (let k = 0; k < 12; k++) {
      const a = this.rand() * Math.PI * 2, r = r0 + (r1 - r0) * this.rand();
      const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
      if (!this.avoid(px, pz)) return { x: px, z: pz, a };
    }
    return null;
  }

  private add(kind: LanceKind, x: number, z: number, n: number, state: Lance["state"], heading: number, danger: number): Lance {
    const l: Lance = { id: `lance:${this.seq++}`, kind, x, z, heading, speed: state === "hunt" ? this.v.lanceHuntSpeed : this.v.lanceSpeed,
      n: Math.max(1, Math.round(n)), state, turn: 5 + 10 * this.rand(), danger, seed: Math.floor(this.rand() * 1e9) };
    this.lances.push(l);
    return l;
  }

  private size(danger: number) {
    const v = this.v, lo = Math.min(v.lanceMin, v.lanceMax), hi = Math.max(v.lanceMin, v.lanceMax);
    return Math.round((lo + (hi - lo) * this.rand()) * scaled(v.lanceSizeFar, danger));
  }

  /** A lance hunting the mech from r0-r1 off: a mech raid (the raid clock) or the first fight's scout. Null: nowhere to put it. */
  hunt(kind: "raid" | "scout", m: LanceMe, r0: number, r1: number): Lance | null {
    const at = this.ring(m.x, m.z, r0, r1);
    if (!at) return null;
    const n = kind === "raid" ? this.v.lanceRaidSize * scaled(this.v.lanceSizeFar, m.danger) : this.size(m.danger);
    return this.add(kind, at.x, at.z, n, "hunt", at.a + Math.PI, m.danger);
  }

  /** By hand (the lab's ?lance): n mechs at (x, z) hunting the mech. */
  place(x: number, z: number, n: number, m: { x: number; z: number }, danger: number): Lance {
    return this.add("scout", x, z, n, "hunt", Math.atan2(m.x - x, m.z - z), danger);
  }

  /** A live lance handed back (left behind): survivors wander on from (x, z). 0: gone. */
  handBack(l: Lance, n: number, x: number, z: number) { l.n = n; l.x = x; l.z = z; l.state = "roam"; l.speed = this.v.lanceSpeed; }

  /** One frame: keep them topped up, move them, and say which come onto the field. */
  update(dt: number, m: LanceMe, out: LanceEvent[] = []): LanceEvent[] {
    out.length = 0;
    const v = this.v;
    for (let k = this.lances.length - 1; k >= 0; k--) {
      const l = this.lances[k];
      if (l.n <= 0 || (l.state !== "live" && Math.hypot(l.x - m.x, l.z - m.z) > v.lanceDrop)) this.lances.splice(k, 1);
    }
    let roamers = 0;
    for (const l of this.lances) if (l.kind === "lance") roamers++;
    for (; roamers < Math.round(v.lancePacks * scaled(v.lancePacksFar, m.danger)); roamers++) {
      const at = this.ring(m.x, m.z, v.lanceFrom, Math.max(v.lanceFrom, v.lanceTo));
      if (!at) break;
      this.add("lance", at.x, at.z, this.size(m.danger), "roam", this.rand() * Math.PI * 2, m.danger);
    }
    for (const l of this.lances) {
      if (l.state === "live") continue;
      const d = Math.hypot(m.x - l.x, m.z - l.z);
      if (!m.out) { if (l.state === "hunt") { l.state = "roam"; l.speed = v.lanceSpeed; } }
      else if (l.kind !== "lance" || d < v.lanceHear * (m.loud ? v.lanceLoud : 1)) { l.state = "hunt"; l.speed = v.lanceHuntSpeed; }
      else if (l.state === "hunt") { l.state = "roam"; l.speed = v.lanceSpeed; }
      if (l.state === "hunt") l.heading = Math.atan2(m.x - l.x, m.z - l.z);
      else {
        l.turn -= dt;
        if (l.turn <= 0) { l.turn = 6 + 12 * this.rand(); l.heading += (this.rand() - 0.5) * 2.2; }
      }
      const nx = l.x + Math.sin(l.heading) * l.speed * dt, nz = l.z + Math.cos(l.heading) * l.speed * dt;
      if (l.state !== "hunt" && this.avoid(nx, nz)) { l.heading += Math.PI * (0.6 + 0.4 * this.rand()); continue; }
      l.x = nx; l.z = nz;
      if (m.out && l.state === "hunt" && Math.hypot(m.x - l.x, m.z - l.z) < v.lanceEngage) {
        l.state = "live";
        out.push({ type: "engage", lance: l });
      }
    }
    return out;
  }
}
