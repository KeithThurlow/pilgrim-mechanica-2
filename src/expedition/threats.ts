// Things moving out in the desert (pure, seeded; Keith 2026-10-26: "a bit slow... we want more enemies and a bit more
// excitement out in the world"). On top of the sleeping swarm camps:
// - roaming packs: groups of robots wandering the sand (a slow drift that turns now and then) a few hundred metres off,
//   kept topped up round the mech; one that hears the mech (within roamHear, more while it's loud: firing, stripping,
//   sprinting) hunts it, and within roamEngage it comes in as robots (the glue spawns them, awake);
// - the first fight: if nothing has engaged by firstFight seconds after the drop, a scout pack turns up just outside
//   roamEngage and hunts, so there's a fight within about a minute;
// - raids: every raidEvery seconds or so while out (the first at raidFirst), a big wave with more cutters and
//   excavators comes from raidFrom off, homing on where the mech last made noise (refreshed while it's loud or close);
// - distant blasts: every blastEvery seconds or so something goes off blastFrom-blastTo out, for the radar and the edge
//   of the screen (the world is busy without you).
// Packs and raids are points here (where, heading, how many) until they engage; the glue (src/expedition/swarmCamps.ts)
// brings them in as robots, reports back their centre and count, and hands survivors back here when the mech gets far.
// Host state (seeded random only; events are plain data); the plumes, marks and sounds the glue makes are cosmetic.
import type { Param } from "../core/tweaks";
import { DEPTH_GROUP, scaled } from "./depth";

export const THREAT_DEFAULTS = {
  roamPacks: 3,
  roamFrom: 260,
  roamTo: 520,
  roamDrop: 1000,
  roamMin: 8,
  roamMax: 20,
  roamSpeed: 2,
  roamHuntSpeed: 4,
  roamHear: 200,
  roamLoud: 1.8,
  roamEngage: 130,
  firstFight: 25,
  raidEvery: 120,
  raidJitter: 0.35,
  raidFirst: 75,
  raidSize: 26,
  raidFrom: 340,
  raidSpeed: 6,
  raidMidShare: 0.3,
  raidBigShare: 0.08,
  blastEvery: 45,
  blastFrom: 140,
  blastTo: 380,
  plumeRange: 520,
  // Depth (src/expedition/depth.ts): multipliers at danger 1, 1 at the road.
  roamPacksFar: 2,
  roamSizeFar: 2,
  raidFreqFar: 2.5,
  raidSizeFar: 2.5,
  raidMidFar: 0.3,
  raidBigFar: 0.12,
  packMidFar: 0.3,
  packBigFar: 0.1,
  raidDeepAt: 0.5,
  raidDeepFirst: 30,
  // Salvage heat answers (src/pois/salvage.ts): the pack pulled in, the small raid aimed at the stripper.
  heatRaidSize: 10,
  heatRaidFrom: 240,
  heatPullFrom: 180,
};
export type ThreatValues = typeof THREAT_DEFAULTS;

const R = "Roaming packs", RD = "Raids", H = "Horizon";
export const THREAT_PARAMS: Param[] = [
  { key: "roamPacksFar", label: "Roaming packs × at full depth", min: 1, max: 5, step: 0.05, group: DEPTH_GROUP, tip: "Packs kept round the mech" },
  { key: "roamSizeFar", label: "Pack size × at full depth", min: 1, max: 5, step: 0.05, group: DEPTH_GROUP },
  { key: "raidFreqFar", label: "Raid rate × at full depth", min: 1, max: 6, step: 0.05, group: DEPTH_GROUP, tip: "Raids come this many times as often" },
  { key: "raidSizeFar", label: "Raid size × at full depth", min: 1, max: 6, step: 0.05, group: DEPTH_GROUP },
  { key: "raidMidFar", label: "Cutters added to raids at full depth (share)", min: 0, max: 1, step: 0.01, group: DEPTH_GROUP },
  { key: "raidBigFar", label: "Excavators added to raids at full depth (share)", min: 0, max: 0.5, step: 0.005, group: DEPTH_GROUP },
  { key: "packMidFar", label: "Cutters added to packs at full depth (share)", min: 0, max: 1, step: 0.01, group: DEPTH_GROUP },
  { key: "packBigFar", label: "Excavators added to packs at full depth (share)", min: 0, max: 0.5, step: 0.005, group: DEPTH_GROUP },
  { key: "raidDeepAt", label: "Deep raid clock at danger", min: 0, max: 1.5, step: 0.05, group: DEPTH_GROUP, tip: "Going out past this danger shortens the wait for the next raid" },
  { key: "raidDeepFirst", label: "…to at most (s)", min: 0, max: 300, step: 5, group: DEPTH_GROUP },
  { key: "heatRaidSize", label: "Heat raid size (robots)", min: 1, max: 60, step: 1, group: "Salvage heat answers", tip: "The small raid a too-hot strip sends (× the depth raid-size multiplier)" },
  { key: "heatRaidFrom", label: "Heat raid comes from (m)", min: 100, max: 800, step: 10, group: "Salvage heat answers" },
  { key: "heatPullFrom", label: "Heat pack appears at (m)", min: 100, max: 800, step: 10, group: "Salvage heat answers", tip: "If no pack is out there to pull in, one turns up this far off" },
  { key: "roamPacks", label: "Packs round the mech", min: 0, max: 12, step: 1, group: R, tip: "Roaming packs kept within reach while you're out; a new one wanders in when one dies or is left behind" },
  { key: "roamFrom", label: "Turn up from (m)", min: 100, max: 1000, step: 10, group: R },
  { key: "roamTo", label: "Turn up to (m)", min: 150, max: 1500, step: 10, group: R },
  { key: "roamDrop", label: "Forgotten past (m)", min: 400, max: 3000, step: 10, group: R, tip: "Packs this far from the mech are dropped (and replaced nearer)" },
  { key: "roamMin", label: "Smallest pack (robots)", min: 1, max: 60, step: 1, group: R },
  { key: "roamMax", label: "Biggest pack (robots)", min: 1, max: 100, step: 1, group: R },
  { key: "roamSpeed", label: "Wander speed (m/s)", min: 0, max: 10, step: 0.1, group: R },
  { key: "roamHuntSpeed", label: "Hunting speed (m/s)", min: 0, max: 12, step: 0.1, group: R, tip: "How fast a pack that heard the mech closes in before it comes in as robots" },
  { key: "roamHear", label: "Hears the mech within (m)", min: 0, max: 800, step: 5, group: R },
  { key: "roamLoud", label: "Loud: hearing ×", min: 1, max: 4, step: 0.05, group: R, tip: "While the mech fires, strips salvage, sprints or dashes, packs hear it this much further" },
  { key: "roamEngage", label: "Comes in as robots within (m)", min: 40, max: 400, step: 5, group: R },
  { key: "firstFight", label: "First fight by (s after the drop)", min: 0, max: 300, step: 5, group: R, tip: "If nothing has come for the mech by then, a scout pack turns up just outside the engage range and hunts (0: off)" },
  { key: "raidEvery", label: "A raid every (s)", min: 0, max: 600, step: 5, group: RD, tip: "0: no raids" },
  { key: "raidJitter", label: "Raid timing spread ±", min: 0, max: 0.9, step: 0.01, group: RD },
  { key: "raidFirst", label: "First raid after (s out)", min: 0, max: 600, step: 5, group: RD },
  { key: "raidSize", label: "Raid size (robots)", min: 1, max: 150, step: 1, group: RD },
  { key: "raidFrom", label: "Raids come from (m)", min: 140, max: 1200, step: 10, group: RD },
  { key: "raidSpeed", label: "Raid speed (m/s)", min: 1, max: 15, step: 0.1, group: RD },
  { key: "raidMidShare", label: "Cutters in a raid (share)", min: 0, max: 1, step: 0.01, group: RD },
  { key: "raidBigShare", label: "Excavators in a raid (share)", min: 0, max: 0.5, step: 0.005, group: RD },
  { key: "blastEvery", label: "A distant blast every (s)", min: 0, max: 300, step: 5, group: H, tip: "Something going off out there (0: none)" },
  { key: "blastFrom", label: "Blasts from (m)", min: 60, max: 1000, step: 10, group: H },
  { key: "blastTo", label: "Blasts to (m)", min: 80, max: 1500, step: 10, group: H },
  { key: "plumeRange", label: "Dust plumes seen within (m)", min: 0, max: 1500, step: 10, group: H, tip: "Moving packs throw dust up and show at the screen edge within this" },
];
export const THREAT_GROUPS = [R, RD, H, "Salvage heat answers"];

export type PackKind = "pack" | "raid" | "scout";
export interface Pack {
  id: string;
  kind: PackKind;
  x: number; z: number;
  /** Heading (radians, 0 = +Z) and how fast it's going now (m/s). */
  heading: number;
  speed: number;
  /** Robots in it. */
  n: number;
  /** roam: wandering; hunt: closing on the mech; live: robots on the field (the glue moves it). */
  state: "roam" | "hunt" | "live";
  /** Seconds until it next picks a new wander heading. */
  turn: number;
  /** Where a raid is heading (the mech's last noise). */
  tx: number; tz: number;
  /** Cutter and excavator shares added to the robot mix (depth). */
  mid: number; big: number;
  /** Pulled in by salvage heat: keeps hunting however far it is. */
  pulled?: boolean;
}

export interface MechNow {
  x: number; z: number;
  /** Out on the sand on an expedition and alive (else nothing hunts and no raids come). */
  out: boolean;
  /** Firing, stripping, sprinting or dashing. */
  loud: boolean;
  /** Danger where the mech is (src/expedition/depth.ts); 0 or missing: as before depth. */
  danger?: number;
}

export type ThreatEvent =
  | { type: "engage"; pack: Pack }
  | { type: "raid"; pack: Pack; bearing: number }
  | { type: "blast"; x: number; z: number };

export class ThreatField {
  readonly packs: Pack[] = [];
  /** Seconds out on this trip, and whether anything has engaged on it yet. */
  outFor = 0;
  engaged = false;
  /** Countdown to the next raid and blast (s). */
  raidT = 0;
  blastT = 0;
  /** Send a raid as soon as the mech is out (the lab's ?raid). */
  raidNow = false;
  private seq = 0;
  private rs: number;
  private wasOut = false;
  private deepRaided = false;
  /** Danger at the mech now, as of the last update. */
  danger = 0;

  constructor(public v: ThreatValues, seed = 1,
    /** Where nothing should turn up (the road, near the convoy). */
    private avoid: (x: number, z: number) => boolean = () => false) {
    this.rs = (seed >>> 0) || 1;
  }

  rand(): number {
    let t = (this.rs = (this.rs + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  reset() { this.packs.length = 0; this.outFor = 0; this.engaged = false; this.wasOut = false; }

  /** A new trip: the clocks start (called on the drop). */
  launched() {
    const v = this.v;
    this.outFor = 0; this.engaged = false; this.deepRaided = false;
    this.raidT = v.raidFirst;
    this.blastT = v.blastEvery * (0.3 + 0.5 * this.rand());
  }

  /** Somewhere on a ring round (x, z) clear of the avoid test (null if none found). */
  private ring(x: number, z: number, r0: number, r1: number, bearing?: number): { x: number; z: number; a: number } | null {
    for (let k = 0; k < 12; k++) {
      const a = bearing !== undefined && k < 6 ? bearing + (this.rand() - 0.5) * 0.8 : this.rand() * Math.PI * 2;
      const r = r0 + (r1 - r0) * this.rand();
      const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
      if (!this.avoid(px, pz)) return { x: px, z: pz, a };
    }
    return null;
  }

  private add(kind: PackKind, x: number, z: number, n: number, state: Pack["state"], heading: number, speed: number): Pack {
    const p: Pack = { id: `${kind}:${this.seq++}`, kind, x, z, heading, speed, n, state, turn: 5 + 10 * this.rand(), tx: x, tz: z, mid: 0, big: 0 };
    this.packs.push(p);
    return p;
  }

  /** Count left in a pack that's on the field (the glue), or gone when 0. */
  setLive(p: Pack, x: number, z: number, n: number) { p.x = x; p.z = z; p.n = n; }

  /** A live pack handed back (the mech got far): survivors wander on from where they are. */
  setAbstract(p: Pack, n: number) { p.n = n; p.state = "roam"; p.speed = this.v.roamSpeed; }

  /**
   * Salvage heat past its first threshold: the nearest pack (not yet fighting) turns and hunts the mech for good; if
   * none is out there one turns up heatPullFrom off. Null if there is nowhere to put one.
   */
  pull(m: MechNow): Pack | null {
    let best: Pack | null = null, bd = Infinity;
    for (const p of this.packs) {
      if (p.state === "live" || p.kind === "raid" || p.pulled) continue;
      const d = Math.hypot(p.x - m.x, p.z - m.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) {
      const at = this.ring(m.x, m.z, this.v.heatPullFrom, this.v.heatPullFrom * 1.2);
      if (!at) return null;
      best = this.add("scout", at.x, at.z, Math.round((this.v.roamMin + this.v.roamMax) / 2), "hunt", at.a + Math.PI, this.v.roamHuntSpeed);
    }
    best.pulled = true; best.state = "hunt"; best.speed = this.v.roamHuntSpeed; best.tx = m.x; best.tz = m.z;
    return best;
  }

  /** Salvage heat past its second threshold: a small raid aimed at the mech (the raid event, or null). */
  heatRaid(m: MechNow): ThreatEvent | null {
    const v = this.v, dg = m.danger ?? this.danger;
    const at = this.ring(m.x, m.z, v.heatRaidFrom, v.heatRaidFrom * 1.15);
    if (!at) return null;
    const p = this.add("raid", at.x, at.z, Math.max(1, Math.round(v.heatRaidSize * scaled(v.raidSizeFar, dg))), "hunt", at.a + Math.PI, v.raidSpeed);
    p.tx = m.x; p.tz = m.z; p.mid = v.raidMidFar * dg; p.big = v.raidBigFar * dg;
    return { type: "raid", pack: p, bearing: at.a };
  }

  /** One frame. Returns what happened (engagements, a raid setting out, a distant blast). */
  update(dt: number, m: MechNow, out: ThreatEvent[] = []): ThreatEvent[] {
    out.length = 0;
    const v = this.v;
    if (m.out && !this.wasOut) this.launched();
    this.wasOut = m.out;
    if (this.raidNow && m.out) { this.raidT = 0; this.raidNow = false; }
    if (m.out) this.outFor += dt;
    // Gone (dead) or left far behind.
    for (let k = this.packs.length - 1; k >= 0; k--) {
      const p = this.packs[k];
      if (p.n <= 0 || (p.state !== "live" && Math.hypot(p.x - m.x, p.z - m.z) > v.roamDrop)) this.packs.splice(k, 1);
    }
    // Keep the roaming packs topped up.
    let roamers = 0;
    for (const p of this.packs) if (p.kind === "pack") roamers++;
    const dg = m.danger ?? 0;
    this.danger = dg;
    for (; roamers < Math.round(v.roamPacks * scaled(v.roamPacksFar, dg)); roamers++) {
      const at = this.ring(m.x, m.z, v.roamFrom, Math.max(v.roamFrom, v.roamTo));
      if (!at) break;
      const lo = Math.min(v.roamMin, v.roamMax), hi = Math.max(v.roamMin, v.roamMax);
      const pk = this.add("pack", at.x, at.z, Math.round((lo + (hi - lo) * this.rand() * this.rand()) * scaled(v.roamSizeFar, dg)), "roam", this.rand() * Math.PI * 2, v.roamSpeed);
      pk.mid = v.packMidFar * dg; pk.big = v.packBigFar * dg;
    }
    if (m.out) {
      // The first fight: a scout pack just outside the engage range, if nothing has come yet.
      if (v.firstFight > 0 && !this.engaged && this.outFor >= v.firstFight && !this.packs.some((p) => p.kind === "scout")) {
        const at = this.ring(m.x, m.z, v.roamEngage + 15, v.roamEngage + 40);
        if (at) {
          const lo = Math.min(v.roamMin, v.roamMax), hi = Math.max(v.roamMin, v.roamMax);
          this.add("scout", at.x, at.z, Math.round((lo + hi) / 2), "hunt", at.a + Math.PI, v.roamHuntSpeed);
        }
      }
      // Raids.
      if (v.raidEvery > 0) {
        // Deep out, the wait for the next raid is cut once, and the clock runs faster the deeper it is.
        if (!this.deepRaided && dg >= v.raidDeepAt) { this.deepRaided = true; this.raidT = Math.min(this.raidT, v.raidDeepFirst); }
        this.raidT -= dt * scaled(v.raidFreqFar, dg);
        if (this.raidT <= 0) {
          this.raidT = v.raidEvery * (1 + (this.rand() * 2 - 1) * v.raidJitter);
          const at = this.ring(m.x, m.z, v.raidFrom, v.raidFrom * 1.15);
          if (at) {
            const p = this.add("raid", at.x, at.z, Math.round(v.raidSize * scaled(v.raidSizeFar, dg)), "hunt", at.a + Math.PI, v.raidSpeed);
            p.tx = m.x; p.tz = m.z; p.mid = v.raidMidFar * dg; p.big = v.raidBigFar * dg;
            out.push({ type: "raid", pack: p, bearing: at.a });
          }
        }
      }
    }
    // Distant blasts (out or aboard: the world goes on).
    if (v.blastEvery > 0) {
      this.blastT -= dt;
      if (this.blastT <= 0) {
        this.blastT = v.blastEvery * (0.5 + this.rand());
        const at = this.ring(m.x, m.z, v.blastFrom, Math.max(v.blastFrom, v.blastTo));
        if (at) out.push({ type: "blast", x: at.x, z: at.z });
      }
    }
    // Move the ones not on the field.
    for (const p of this.packs) {
      if (p.state === "live") continue;
      const d = Math.hypot(m.x - p.x, m.z - p.z);
      if (!m.out) {
        // Nothing to hunt: everything wanders (a raid too, from now on).
        if (p.state === "hunt") { p.state = "roam"; p.speed = v.roamSpeed; }
      } else if (p.kind === "raid") {
        // Raids home on the mech's last noise (heard while it's loud, or seen close).
        if (m.loud || d < v.roamEngage * 1.5) { p.tx = m.x; p.tz = m.z; }
        if (Math.hypot(p.tx - p.x, p.tz - p.z) < 5) { p.tx = m.x; p.tz = m.z; }
      } else {
        const hear = v.roamHear * (m.loud ? v.roamLoud : 1);
        if (d < hear || p.kind === "scout" || p.pulled) { p.state = "hunt"; p.speed = v.roamHuntSpeed; p.tx = m.x; p.tz = m.z; }
        else if (p.state === "hunt") { p.state = "roam"; p.speed = v.roamSpeed; }
      }
      if (p.state === "hunt") {
        const want = Math.atan2(p.tx - p.x, p.tz - p.z);
        p.heading = want;
        p.speed = p.kind === "raid" ? v.raidSpeed : v.roamHuntSpeed;
      } else {
        // Wander: hold a heading, swing to a new one now and then, drifting away from the mech when very close.
        p.turn -= dt;
        if (p.turn <= 0) { p.turn = 6 + 12 * this.rand(); p.heading += (this.rand() - 0.5) * 2.2; }
      }
      const nx = p.x + Math.sin(p.heading) * p.speed * dt, nz = p.z + Math.cos(p.heading) * p.speed * dt;
      if (p.state !== "hunt" && this.avoid(nx, nz)) { p.heading += Math.PI * (0.6 + 0.4 * this.rand()); continue; }
      p.x = nx; p.z = nz;
      if (m.out && p.state === "hunt" && Math.hypot(m.x - p.x, m.z - p.z) < v.roamEngage) {
        p.state = "live";
        this.engaged = true;
        out.push({ type: "engage", pack: p });
      }
    }
    return out;
  }
}
