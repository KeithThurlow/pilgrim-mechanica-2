// The expedition loop wired into the convoy lab (glue; the rules live in expedition.ts, fuel.ts, returnPoint.ts and
// radar.ts): POIs and salvage out in the sand (sites.ts), swarm camps (swarmCamps.ts), the state machine fed from the
// crane's states (dropped on the sand = launched, gripped by the crane = picked up, banked), fuel burnt from what the
// mech does, the return point and the fuel warning, the radar scope and the HUD, the fade and the trip home.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { DuneField } from "../world/terrain";
import type { Battlefield } from "../game/battlefield";
import type { MechUnit } from "../game/mechUnit";
import type { ConvoyRoute } from "../convoy/route";
import type { Convoy } from "../convoy/platform";
import type { CraneCarry } from "../convoy/carry";
import type { MoveCommand } from "../mech/walker";
import type { Aim } from "../mech/upper";
import { ROBOT_DEFAULTS, ROBOT_PARAMS, DOWN } from "../combat/robots";
import { ROBOT_TEAR_DEFAULTS, ROBOT_TEAR_PARAMS } from "../combat/robotTearFx";
import { POI_PARAMS } from "../world/pois";
import { SITE_PARAMS } from "../pois/kinds";
import { SALVAGE_PARAMS } from "../pois/salvage";
import { SALVAGE_FX_PARAMS } from "../pois/salvageDraw";
import { Expedition, EXPEDITION_DEFAULTS, EXPEDITION_PARAMS, ON_SAND as SAND } from "./expedition";
import { Fuel, FUEL_DEFAULTS, FUEL_PARAMS, fuelWarning } from "./fuel";
import { returnPoint, craneTracks, RETURN_DEFAULTS, RETURN_PARAMS, type ReturnPoint, type CraneTrack } from "./returnPoint";
import { RadarZoom, RADAR_DEFAULTS, RADAR_PARAMS, linked, radarPicture, type RadarWorld } from "./radar";
import { Seeker, SEEKER_DEFAULTS, SEEKER_PARAMS, seekNearest } from "./seekers";
import { RadarDraw } from "./radarDraw";
import { RadarSound } from "./radarSound";
import { CampField, CAMP_DEFAULTS, CAMP_PARAMS } from "./camps";
import { SwarmCamps, SWARM_CAMP_DEFAULTS, SWARM_CAMP_PARAMS } from "./swarmCamps";
import { FieldSites, SITES_DEFAULTS, SITES_PARAMS } from "./sites";
import { ExpeditionHud } from "./expeditionHud";
import { ThreatField, THREAT_DEFAULTS, THREAT_PARAMS, THREAT_GROUPS, type ThreatEvent } from "./threats";
import { ThreatMarks, type Mark } from "./threatMarks";
import type { Prey } from "../pilot/quarry";

export const LOOP_DEFAULTS = {
  ...EXPEDITION_DEFAULTS, ...FUEL_DEFAULTS, ...RETURN_DEFAULTS, ...RADAR_DEFAULTS, ...SEEKER_DEFAULTS, ...CAMP_DEFAULTS, ...SWARM_CAMP_DEFAULTS,
  ...SITES_DEFAULTS, ...ROBOT_DEFAULTS, ...ROBOT_TEAR_DEFAULTS, ...THREAT_DEFAULTS,
};
export type LoopValues = typeof LOOP_DEFAULTS;
export const LOOP_PARAMS: Param[] = [
  ...THREAT_PARAMS, ...EXPEDITION_PARAMS, ...FUEL_PARAMS, ...RETURN_PARAMS, ...RADAR_PARAMS, ...SEEKER_PARAMS, ...CAMP_PARAMS, ...SWARM_CAMP_PARAMS,
  ...POI_PARAMS, ...SITES_PARAMS, ...SITE_PARAMS, ...SALVAGE_PARAMS, ...SALVAGE_FX_PARAMS, ...ROBOT_PARAMS, ...ROBOT_TEAR_PARAMS,
];
/** Topics for the lab's panel. */
export const LOOP_TOPICS = [
  { id: "expedition", label: "Expedition", groups: ["Expedition", "Fuel", "Way home", "Radar"] },
  { id: "pois", label: "POIs and salvage", groups: ["POI placement", "Pads", "Salvage", "Salvage: look", ...new Set(SITE_PARAMS.map((p) => p.group))] },
  { id: "threats", label: "Packs and raids", groups: THREAT_GROUPS },
  { id: "swarms", label: "Swarms", groups: ["Swarm camps", "Swarm camps: behaviour", "Unknown areas", "Robots", "Robots: attack", "Robots: tearing", "Robots: medium", "Robots: big ones", "Robots: hit parts"] },
];


/**
 * The pilot (src/pilot/onFoot.ts), when he's out of the mech: where he is, whether he's alive, who the swarm should go
 * for (the prey picked for its middle), how much closer he wakes a camp, and his salvage reach, rate and noise.
 */
export interface LoopPilot {
  onFoot: boolean; alive: boolean; x: number; z: number;
  prey: (x: number, z: number) => Prey; notice: number;
  reach: number; rate: number; noise: number;
}
export interface LoopInput { eHeld: boolean; qHeld: boolean; demo: boolean; mark?: (stage: string) => void; pilot?: LoopPilot; canvas?: HTMLCanvasElement }

export class ExpeditionLoop {
  readonly exp: Expedition;
  readonly fuel: Fuel;
  readonly sites: FieldSites;
  readonly camps: CampField;
  readonly swarms: SwarmCamps;
  readonly zoom: RadarZoom;
  readonly radar: RadarDraw;
  readonly hud: ExpeditionHud;
  /** The sensor's seekers (src/expedition/seekers.ts): the lab sets the modes from the loadout and cycles them. */
  readonly seeker = new Seeker();
  private sound: RadarSound;
  /** Roaming packs, raids and distant blasts (threats.ts), and their marks at the screen's edge. */
  readonly threats: ThreatField;
  private marks = new ThreatMarks();
  private events: ThreatEvent[] = [];
  private blasts: { id: string; x: number; z: number; t: number }[] = [];
  private plumeT = 0;
  private blastSeq = 0;
  readonly home: ReturnPoint = { x: 0, z: 0, walk: 0, eta: 0, crane: 0, reachable: false };
  warn: 0 | 1 | 2 = 0;
  private tracks: CraneTrack[] = [];
  private world: RadarWorld = { mech: { x: 0, z: 0 }, convoy: [], route: [], home: null, pois: [], blobs: [], unknown: [], contacts: [] };
  private slowT = 0;
  private homeT = 0;
  private charges = 0;
  private turretPts: THREE.Vector3[] = [];
  /** Demo: the POI it's heading for and what it's doing. */
  private demoGoal: { x: number; z: number; id: string } | null = null;
  /** Spots stripped (all runs), and the count when the demo picked its POI. */
  private stripped = 0;
  private demoFrom = 0;
  demoHold = false;
  demoAim: Aim | null = null;
  demoTrigger = false;
  /** Called when the mech should be put back aboard (recovered, lost). */
  onHome: (() => void) | null = null;

  constructor(
    readonly v: LoopValues & { walkSpeed: number; sprintSpeed: number; craneRange: number; craneMount: number; convoySpeed: number; camYaw: number; dashShoveRadius: number; dashShoveDamage: number },
    field: DuneField, bf: Battlefield, scene: THREE.Scene, private camera: THREE.Camera,
    private route: ConvoyRoute, private convoy: Convoy, private carry: CraneCarry, private player: MechUnit,
  ) {
    // The road's corridor, cut or still to be cut by the plough (nothing is placed where the road will run).
    const blocked = (x: number, z: number) => route.corridor(x, z) > 0.02;
    this.exp = new Expedition(v);
    this.fuel = new Fuel(v);
    this.sites = new FieldSites(v, field, bf, scene, blocked);
    this.camps = new CampField(v);
    this.swarms = new SwarmCamps(v, field, bf, scene, this.camps, player, blocked);
    this.sites.onLoot = (label, scrap) => { this.stripped++; this.exp.add({ kind: "scrap", amount: scrap, label }); };
    this.sites.onNoise = (x, z, r) => this.swarms.noise(x, z, r);
    player.onDash = (x, z, dx, dz) => this.swarms.dashed(x, z, dx, dz, v.dashShoveRadius, v.dashShoveDamage);
    this.zoom = new RadarZoom(v);
    this.radar = new RadarDraw(v);
    this.hud = new ExpeditionHud(this.radar.canvas);
    this.sound = new RadarSound(bf.sfx.ctx);
    this.charges = player.dash.charges;
    // Nothing turns up on the road or within 150 m of the train.
    this.threats = new ThreatField(v, 17, (x, z) => blocked(x, z) || convoy.platforms.some((q) => Math.hypot(q.x - x, q.z - z) < 150));
    this.field = field;
    this.bf = bf;
  }
  private field: DuneField;
  private bf: Battlefield;

  /** Start over where the lab put the convoy (POIs kept clear of the start; camps too). */
  restart(x: number, z: number) {
    this.camps.start = { x, z };
    this.swarms.reset();
    this.threats.reset();
    this.blasts.length = 0;
    this.sites.keepClear(x, z, 190);
    this.fuel.refill();
    this.exp.state = "aboard";
    this.exp.atRisk.length = 0;
    this.slowT = 0;
  }

  /** Placement sliders changed. */
  rebuild(what: "sites" | "camps") { if (what === "sites") this.sites.rebuild(); else { this.swarms.reset(); this.threats.reset(); } this.slowT = 0; }

  /** Turret targets: awake robots near the train. */
  turretThreats(): THREE.Vector3[] {
    const mid = this.convoy.platforms[Math.floor(this.convoy.platforms.length / 2)];
    return this.swarms.threats(mid.x, mid.z, 250, this.turretPts);
  }

  update(dt: number, inp: LoopInput) {
    const { exp, fuel, carry, player, v } = this, sim = player.sim, p = sim.pelvis;
    // Launched (on the sand), picked up (the crane has it: banked), or destroyed out there.
    const happened = exp.follow(carry.state, carry.attached, player.alive);
    if (happened === "launched") { fuel.refill(); this.demoGoal = null; this.demoFrom = this.stripped; }
    if (happened === "banked") this.sound.banked();
    // A dead mech isn't picked up.
    if (!player.alive && (carry.state === "inRange" || carry.state === "pickup")) carry.state = "walking";
    if (!player.alive) carry.armed = false;

    // The pilot killed on foot out there: the expedition is over, the at-risk list lost (Keith 2026-10-26).
    const pl = inp.pilot, foot = !!pl?.onFoot;
    if (foot && !pl!.alive && exp.state === "out") exp.pilotKilled();
    // Salvage: E while out, on the sand, alive; on foot from where the pilot stands (shorter reach, slower, quieter).
    const onSand = carry.state === "walking" || carry.state === "inRange";
    const holding = (inp.demo ? this.demoHold : inp.eHeld) && exp.state === "out" && player.alive && onSand && (!foot || pl!.alive);
    if (foot) this.sites.update(dt, pl!.x, pl!.z, holding, this.camera, pl!);
    else this.sites.update(dt, p.x, p.z, holding, this.camera);
    inp.mark?.("POIs and salvage");
    // The swarm goes for the mech, or the pilot when he's out and nearer (src/pilot/quarry.ts).
    const sw = this.swarms.sw;
    let mx = p.x, mz = p.z;
    if (foot) {
      let n = 0, sx = 0, sz = 0;
      for (let i = 0; i < sw.hi; i++) if (sw.state[i] < DOWN && !sw.frozen[i]) { sx += sw.px[i]; sz += sw.pz[i]; n++; }
      if (n) { mx = sx / n; mz = sz / n; }
    }
    const hunting = exp.state === "out" && player.alive && SAND.has(carry.state) && (!foot || pl!.alive);
    this.swarms.update(dt, hunting, foot ? pl!.prey(mx, mz) : undefined, foot && pl!.alive ? { x: pl!.x, z: pl!.z, notice: pl!.notice } : null);
    inp.mark?.("swarm camps");
    this.updateThreats(dt, hunting, inp.canvas, foot && pl!.alive ? { x: pl!.x, z: pl!.z } : null);
    inp.mark?.("packs and raids");

    // Fuel: burns only out in the field.
    const dash = player.dash;
    if (dash.charges < this.charges && exp.state === "out") fuel.dash();
    this.charges = dash.charges;
    if (exp.state === "out" && player.alive) {
      const speed = Math.hypot(sim.vel.x, sim.vel.z) + (dash.phase === "glide" ? 0 : Math.hypot(dash.vx, dash.vz));
      fuel.burn(dt, { speed, walkSpeed: v.walkSpeed, sprintSpeed: v.sprintSpeed, boosting: dash.phase === "boost", stripping: !!this.sites.salvage.active });
    } else if (exp.state === "aboard" && !SAND.has(carry.state)) fuel.refill();

    // The state machine: recall held, out of fuel; at the bottom of a fade the lab puts the mech home.
    const ev = exp.update(dt, inp.qHeld && !inp.demo && player.alive, fuel.empty);
    if (ev === "home") { this.onHome?.(); fuel.refill(); this.demoGoal = null; }

    // The way home: the return point and the warning.
    this.homeT -= dt;
    if (this.homeT <= 0) {
      this.homeT = 0.1;
      craneTracks(this.convoy.bays, v.craneMount, this.tracks);
      returnPoint(v, this.route, this.tracks, p.x, p.z, v.walkSpeed, v.convoySpeed, v.craneRange, this.home);
    }
    const eta = this.home.reachable ? this.home.eta : Infinity;
    const warn = exp.state === "out" ? fuelWarning(v, fuel.left, eta) : 0;
    inp.mark?.("way home");
    if (warn === 2 && this.warn < 2) this.sound.warn();
    this.warn = warn;

    // The radar: the slow lists a few times a second, the rest every frame.
    this.slowT -= dt;
    const w = this.world;
    w.mech.x = p.x; w.mech.z = p.z;
    w.convoy = this.convoy.platforms.map((q) => ({ x: q.x, z: q.z, length: q.spec.length, width: q.spec.width, heading: q.heading }));
    w.home = exp.state === "out" ? { x: this.home.x, z: this.home.z } : null;
    if (this.slowT <= 0) {
      this.slowT = 0.25;
      const R = v.convoyRadar * 1.1;
      w.pois = this.sites.poisIn(p.x - R, p.z - R, p.x + R, p.z + R).map((q) => ({ id: q.id, x: q.x, z: q.z, tier: q.tier, kind: q.kind, stripped: this.sites.stripped(q) }));
      this.swarms.blobs(p.x, p.z, R, w.blobs);
      w.unknown = this.camps.unknownNear(p.x, p.z, R);
      w.route = [];
      const head = this.route.s, out = { x: 0, z: 0, heading: 0 };
      for (let s = -100; s <= v.convoyRadar * 1.6; s += 50) { this.route.ahead(head + s, out); w.route.push({ x: out.x, z: out.z }); }
    }
    this.swarms.contacts(p.x, p.z, v.mechRadar * 1.1, w.contacts);
    // Moving danger as heat: packs and raids (hotter hunting), and blasts for a few seconds.
    const heat = (w.heat ??= []);
    heat.length = 0;
    for (const q of this.threats.packs) heat.push({ id: q.id, x: q.x, z: q.z, guess: q.kind === "raid" ? q.n * 1.5 : q.n, awake: q.state !== "roam" });
    for (const b of this.blasts) heat.push({ id: b.id, x: b.x, z: b.z, guess: 20 * Math.max(0, 1 - b.t / 6), awake: true });
    inp.mark?.("radar lists");
    const aboard = !SAND.has(carry.state);
    const zev = this.zoom.update(dt, linked(v, w, aboard));
    if (zev) this.sound.zoom(zev === "out");
    const range = this.zoom.range;
    const mode = range > Math.sqrt(v.mechRadar * v.convoyRadar) ? "convoy" : "mech";
    const pic = radarPicture(v, w, mode);
    const sm = this.seeker.mode, seek = sm ? seekNearest(sm, v, w) : null;
    pic.seek = seek;
    this.radar.draw(dt, pic, range, (v.camYaw * Math.PI) / 180, sim.heading, warn);
    inp.mark?.("radar draw");

    // HUD.
    const s = this.sites.salvage;
    let prompt = "";
    if (exp.state === "out" && onSand) {
      if (s.active) prompt = `Stripping ${s.active.label}… ${Math.round(s.active.progress * 100)}%  (${foot ? "by hand: slower, quieter" : "loud"})`;
      else if (s.inReach) prompt = `Hold E: strip ${s.inReach.label}${foot ? " by hand" : ""} (+${s.pay(s.inReach)} scrap, at risk until the crane has you)`;
    }
    this.hud.update(dt, {
      exp, fuelLeft: fuel.left, fuelShare: fuel.share, eta: exp.state === "out" ? eta : null, warn, prompt,
      canRecall: exp.state === "out" && player.alive, bankShow: v.bankShow, seek: this.seeker.label(seek),
    });
    inp.mark?.("expedition hud");
  }

  /**
   * Packs, raids and blasts (threats.ts): step them against the mech, or the pilot when he's out on foot (loud while
   * firing, stripping, sprinting or dashing; once in, the robots go for the swarm's prey like the camps), bring the ones that engage in as robots, keep the live ones' centre and count, hand them back when left
   * far behind; dust plumes over the moving ones, blasts out there, the raid warning, marks at the screen's edge.
   */
  private updateThreats(dt: number, hunting: boolean, canvas?: HTMLCanvasElement, pilot?: { x: number; z: number } | null) {
    const { player, v, swarms, threats, bf, field } = this, sim = player.sim;
    // Packs and raids home on whoever is out there: the mech, or the pilot on foot (quiet, unless stripping by hand).
    const p = pilot ?? sim.pelvis;
    const loud = !!this.sites.salvage.active || (!pilot && (player.upper.guns.some((g) => g.firing || g.spin > 0.3)
      || sim.speed > v.walkSpeed + 0.5 || player.dash.active));
    if (swarms.anyAwake) threats.engaged = true;
    for (const e of threats.update(dt, { x: p.x, z: p.z, out: hunting, loud }, this.events)) {
      if (e.type === "engage") {
        const q = e.pack;
        swarms.addGroup(q.id, q.n, q.x, q.z, q.kind === "raid" ? { mid: v.raidMidShare, big: v.raidBigShare } : undefined);
      } else if (e.type === "raid") {
        this.hud.note(`Raid coming · ${e.pack.n} robots · ${Math.round(Math.hypot(e.pack.x - p.x, e.pack.z - p.z))} m`, "#ff9a7a", 4);
        this.sound.alarm();
      } else {
        // Something going off out there: a burst of sand and smoke, a far bang, heat on the radar.
        const y = field.height(e.x, e.z);
        bf.dust.stomp(e.x, y, e.z, 6);
        bf.dust.smoke(e.x, y + 2, e.z, 0, 4, 0, 8, 6, 1, 0.8);
        bf.sfx.playSound("blast", new THREE.Vector3(e.x, y, e.z), 0.9, 0.7);
        this.blasts.push({ id: `blast:${this.blastSeq++}`, x: e.x, z: e.z, t: 0 });
      }
    }
    // Live ones: where they are and how many are left; left far behind, back to wandering.
    for (const q of threats.packs) {
      if (q.state !== "live") continue;
      const g = swarms.group(q.id);
      if (!g) { q.n = 0; continue; }
      if (Math.hypot(g.x - p.x, g.z - p.z) > v.campDrop) threats.setAbstract(q, swarms.dropGroup(q.id));
      else threats.setLive(q, g.x, g.z, g.n);
    }
    for (let k = this.blasts.length - 1; k >= 0; k--) if ((this.blasts[k].t += dt) > 6) this.blasts.splice(k, 1);
    // Dust plumes over packs on the move (on screen or near it).
    this.plumeT -= dt;
    if (this.plumeT <= 0) {
      this.plumeT = 0.25;
      for (const q of threats.packs) {
        if (q.state === "live" || q.speed < 0.5) continue;
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d > Math.min(v.plumeRange, 260)) continue;
        const k = Math.min(2.5, 0.6 + Math.sqrt(q.n) * 0.3) * (q.state === "hunt" ? 1.5 : 1);
        bf.dust.stomp(q.x, field.height(q.x, q.z), q.z, k, Math.sin(q.heading) * q.speed, Math.cos(q.heading) * q.speed);
      }
    }
    // Marks at the screen's edge.
    if (!canvas) return;
    const marks: Mark[] = [];
    for (const q of threats.packs) {
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d > v.plumeRange) continue;
      // Live ones keep their mark until they're on screen (the mark hides itself then).
      const raid = q.kind === "raid", coming = q.state !== "roam";
      marks.push({ id: q.id, x: q.x, y: field.height(q.x, q.z) + 3, z: q.z, text: raid ? "RAID" : q.state === "live" ? "CONTACT" : coming ? "DUST · COMING" : "DUST",
        color: raid ? "#ff7a5a" : coming ? "#ffb347" : "#e8d6b0", strength: raid || coming ? 1 : 1 - d / (v.plumeRange * 1.2) });
    }
    for (const b of this.blasts) marks.push({ id: b.id, x: b.x, y: field.height(b.x, b.z) + 3, z: b.z, text: "BLAST", color: "#ffd27a", strength: 1 - b.t / 6 });
    this.marks.update(this.camera, canvas, marks, p);
  }

  /**
   * The demo out in the field: walk to the nearest unstripped POI ahead of the convoy, strip a couple of spots
   * (shooting anything that comes), then head for the return point. Null when done (the lab's demo walks to the crane).
   */
  demoField(): MoveCommand | null {
    const sim = this.player.sim, p = sim.pelvis, v = this.v, s = this.sites.salvage;
    this.demoHold = false;
    this.demoTrigger = false;
    this.demoAim = null;
    // Shoot the nearest awake robot within 40 m.
    const sw = this.swarms.sw;
    let best = 40, bi = -1;
    for (let i = 0; i < sw.hi; i++) if (sw.state[i] < DOWN && !sw.frozen[i]) { const d = Math.hypot(sw.px[i] - p.x, sw.pz[i] - p.z); if (d < best) { best = d; bi = i; } }
    if (bi >= 0) { this.demoAim = { x: sw.px[bi], y: sw.hubY[bi], z: sw.pz[bi] }; this.demoTrigger = true; }
    if (this.exp.state !== "out" || this.stripped - this.demoFrom >= 2) { this.demoGoal = null; return null; }
    if (!this.demoGoal) {
      const lead = this.convoy.bays[0], R = 500;
      let bd = Infinity;
      for (const q of this.sites.poisIn(p.x - R, p.z - R, p.x + R, p.z + R)) {
        const dx = q.x - lead.x, dz = q.z - lead.z, ahead = dx * lead.fwd.x + dz * lead.fwd.z;
        if (ahead < 0 || this.sites.stripped(q)) continue;
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d < bd && d < 420) { bd = d; this.demoGoal = { x: q.x, z: q.z, id: q.id }; }
      }
      if (!this.demoGoal) return null;
      this.demoFrom = this.stripped;
    }
    const g = this.demoGoal;
    // At the POI: strip its nearest spot; when it has none left, done.
    let spot = null, sd = Infinity;
    for (const q of s.spots) if (q.poi === g.id && !q.done) { const d = Math.hypot(q.x - p.x, q.z - p.z); if (d < sd) { sd = d; spot = q; } }
    const near = Math.hypot(g.x - p.x, g.z - p.z) < 45;
    if (near && !spot && s.spots.some((q) => q.poi === g.id)) { this.demoFrom = -99; return null; }
    const tx = spot && near ? spot.x : g.x, tz = spot && near ? spot.z : g.z;
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (spot && near && d < v.salvageReach * 0.6) {
      this.demoHold = true;
      if (!this.demoAim) this.demoAim = { x: spot.x, y: 1, z: spot.z };
      return { x: 0, z: 0, sprint: false };
    }
    return { x: dx / Math.max(1e-6, d), z: dz / Math.max(1e-6, d), sprint: d > 60 };
  }

  /** The demo heading home: toward the return point while it's far (null near: the lab walks up to the crane). */
  demoHome(): MoveCommand | null {
    const p = this.player.sim.pelvis, h = this.home;
    const dx = h.x - p.x, dz = h.z - p.z, d = Math.hypot(dx, dz);
    if (this.exp.state !== "out" || d < 50 || !h.reachable) return null;
    return { x: dx / d, z: dz / d, sprint: false };
  }

  /** Debug line for the frame HUD. */
  get line() {
    const e = this.exp, sw = this.swarms;
    return `expedition ${e.state}${e.state === "out" ? ` ${Math.round(e.outFor)} s` : ""} · fuel ${Math.round(this.fuel.left)} s · home ${this.home.reachable ? Math.round(this.home.eta) + " s" : "unreachable"} (${this.home.crane ? "rear" : "front"} crane) · radar ${this.zoom.mode} ${Math.round(this.zoom.range)} m · POIs built ${this.sites.count} · camps & packs on the field ${sw.campsLive}, robots ${sw.count} (${sw.awake} awake) · packs ${this.threats.packs.filter((q) => q.kind !== "raid").length} (${this.threats.packs.filter((q) => q.state === "hunt").length} hunting), raids ${this.threats.packs.filter((q) => q.kind === "raid").length}, next raid ${Math.round(this.threats.raidT)} s, first fight ${this.threats.engaged ? "had" : "not yet"} · banked ${e.counts.banked}, recalled ${e.counts.recalled}, fuel ${e.counts.fuel}, lost ${e.counts.destroyed}, pilot killed ${e.counts.pilot}`;
  }
}
