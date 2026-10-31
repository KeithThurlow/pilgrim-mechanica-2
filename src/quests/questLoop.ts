// Contracts and high value targets wired into the expedition (glue; docs/proposal-quests.md). The rules live in
// contracts.ts, hvt.ts and tow.ts; here: kills from the robot swarm and the bandit camps, stripped spots, the run's
// banking and losses, offers placed on real POIs, camps, lairs and open sand, the HVT's mech, payouts, notes, the
// hulk on its cable and the pods, beacons, radar diamonds and edge marks, and the move-command slowdown for the lab.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Battlefield } from "../game/battlefield";
import type { MechUnit } from "../game/mechUnit";
import type { RobotSwarm } from "../combat/robots";
import { SMALL, MID, BIG } from "../combat/robots";
import type { Expedition, ExpEvent } from "../expedition/expedition";
import type { ExpeditionHud } from "../expedition/expeditionHud";
import type { FieldSites } from "../expedition/sites";
import type { CampField } from "../expedition/camps";
import type { BanditField } from "../expedition/banditCamps";
import type { Mark } from "../expedition/threatMarks";
import type { DropField, DropContext } from "../expedition/drops";
import type { DuneField } from "../world/terrain";
import { POI_KINDS } from "../world/pois";
import { buildSite, type SiteValues } from "../pois/kinds";
import { ContractBoard, CONTRACT_DEFAULTS, CONTRACT_PARAMS, CONTRACT_GROUP, REWARD_GROUP, KIND_NAME, type KillKind, type OfferSources, type Contract, type ContractKind } from "./contracts";
import { Lairs, HVT_DEFAULTS, HVT_PARAMS, HVT_GROUP, type Lair } from "./hvt";
import { TowCable, TOW_DEFAULTS, TOW_PARAMS, TOW_GROUP, podsInReach } from "./tow";
import { HvtMech, type HvtSetup } from "./hvtMech";
import { QuestDraw, type Beacon } from "./questDraw";
import { QuestHud } from "./questHud";

export const QUEST_DEFAULTS = { ...CONTRACT_DEFAULTS, ...HVT_DEFAULTS, ...TOW_DEFAULTS, hvtWreckFor: 25 };
export type QuestValues = typeof QUEST_DEFAULTS;
export const QUEST_PARAMS: Param[] = [
  ...CONTRACT_PARAMS, ...TOW_PARAMS, ...HVT_PARAMS,
  { key: "hvtWreckFor", label: "Its wreck lies for (s)", min: 2, max: 120, step: 1, group: HVT_GROUP },
];
export const QUEST_GROUPS = [CONTRACT_GROUP, REWARD_GROUP, TOW_GROUP, HVT_GROUP];

const GOLD = 0xffc04a, RED = 0xff5a3a;

export interface QuestWorld {
  exp: Expedition;
  hud: ExpeditionHud;
  sites: FieldSites;
  camps: CampField;
  bandits: BanditField;
  drops: DropField;
  dropCtx: (x: number, z: number) => DropContext;
  depth: (x: number, z: number) => number;
  /** Where offers measure from (the convoy's lead car). */
  lead: () => { x: number; z: number };
  /** Open sand for a hulk or a crash site (not the road, not near the train). */
  blocked: (x: number, z: number) => boolean;
}

export interface QuestInput {
  out: boolean;
  onSand: boolean;
  eHeld: boolean;
  jHeld: boolean;
  /** Who's out there: the mech, and the pilot when on foot. */
  mech: { x: number; z: number; alive: boolean };
  pilot: { x: number; z: number } | null;
  /** The expedition's events this frame (before the loot panel drains them). */
  expEvents: readonly ExpEvent[];
}

export class QuestLoop {
  readonly board: ContractBoard;
  readonly lairs: Lairs;
  readonly tow: TowCable;
  readonly hvt: HvtMech;
  /** Made when the lab hands over the look (setup). */
  draw: QuestDraw | null = null;
  private qhud: QuestHud;
  private scanT = 0;
  private wreckT = 0;
  private near: Lair | null = null;
  private src: OfferSources;
  /** The tow job whose hulk is on the sand (the first active tow). */
  private hulkJob: string | null = null;
  private placed = new Set<string>();
  private hook = new THREE.Vector3();
  /** Radar diamonds and edge marks (the loop reads them). */
  readonly radar: { x: number; z: number; color: string }[] = [];
  readonly marks: Mark[] = [];
  /** What E does here this frame (the loop shows it in the top prompt), "" when nothing. */
  prompt = "";
  /** E is ours this frame (hooking or dropping the hulk): the loop shouldn't strip with it. */
  usesE = false;

  constructor(readonly v: QuestValues & SiteValues & Record<string, number>, private w: QuestWorld, bf: Battlefield, private scene: THREE.Scene,
    private field: DuneField, private player: MechUnit) {
    this.board = new ContractBoard(v);
    this.lairs = new Lairs(v);
    this.lairs.depth = w.depth;
    this.tow = new TowCable(v);
    this.hvt = new HvtMech(bf, scene, v as never, player);
    this.qhud = new QuestHud(w.hud.questSlot);
    this.src = this.sources();
  }

  /** The lab hands over what the HVT's mech needs (the toon look and a Rampart loader); without it no HVT spawns. */
  setup(s: HvtSetup) {
    this.hvt.setup = s;
    if (!this.draw) { this.draw = new QuestDraw(this.field, s.look); this.scene.add(this.draw.group); }
  }

  /** Kills from the robot swarm (chained on its onDeath) and the bandit camps (call from their onKill). */
  watch(sw: RobotSwarm) {
    const prev = sw.onDeath;
    sw.onDeath = (i, nx, nz, speed) => {
      prev?.(i, nx, nz, speed);
      const k = sw.kind[i];
      this.killed(k === SMALL ? "scrapper" : k === MID ? "cutter" : k === BIG ? "excavator" : "scrapper", sw.px[i], sw.pz[i]);
    };
  }
  killed(kind: KillKind, x: number, z: number) {
    if (!this.w.exp.out) return;
    this.board.kill(kind, x, z);
    this.lairs.kill(kind, x, z);
  }
  /** A salvage spot at a POI was stripped. */
  stripped(poi: string) { if (this.w.exp.out) this.board.stripped(poi); }

  /** Start over (the lab's restart): no contracts, every lair dormant, nothing on the cable, the HVT gone. */
  reset() {
    this.board.reset(); this.lairs.reset(); this.tow.drop(); this.hvt.despawn();
    this.hulkJob = null; this.placed.clear(); this.near = null;
  }

  /** The move command's speed share (towing) and whether sprint and dash are off. */
  get moveScale() { return this.tow.slow; }
  get noSprint() { return this.tow.on; }

  /** Offer a contract of a kind now (lab flags); accepted at once when `take`; a bounty on `lair` if given. */
  force(kind: ContractKind, take = true, lair?: Lair | null) {
    this.src.from = this.w.lead();
    const src = lair ? { ...this.src, lair: () => ({ id: lair.id, x: lair.x, z: lair.z, radius: this.v.hvtRadius, name: lair.name }) } : this.src;
    const c = this.board.offer(src, kind);
    if (c && take) this.board.accept(c.id);
    return c;
  }

  /** Where offers go: real POIs, camps and lairs in the distance band from the convoy, or open sand. */
  private sources(): OfferSources {
    const w = this.w, v = this.v;
    const ring = <T extends { x: number; z: number }>(list: T[], min: number, max: number, from: { x: number; z: number }) =>
      list.filter((q) => { const d = Math.hypot(q.x - from.x, q.z - from.z); return d >= min && d <= max; });
    const pick = <T>(r: () => number, list: T[]) => (list.length ? list[Math.floor(r() * list.length)] : null);
    const taken = (id: string) => this.board.list.some((c) => (c.state === "offered" || c.state === "active") && c.site === id);
    const src: OfferSources = {
      from: { x: 0, z: 0 },
      poi: (r, min, max) => {
        const f = src.from;
        const ps = ring(w.sites.poisIn(f.x - max, f.z - max, f.x + max, f.z + max), min, max, f).filter((p) => !w.sites.stripped(p) && !taken(p.id) && !p.id.startsWith("clash:"));
        const p = pick(r, ps);
        if (!p) return null;
        const spots = buildSite(p, v).sections.reduce((n, s) => n + s.spots.length, 0);
        return { id: p.id, x: p.x, z: p.z, label: POI_KINDS[p.kind].label, spots };
      },
      camp: (r, min, max) => {
        const f = src.from, mid = (min + max) / 2;
        const robots = ring(w.camps.campsNear(f.x, f.z, max), min, max, f).map((c) => ({ id: c.id, x: c.x, z: c.z, radius: Math.max(80, c.radius * 2.5), cull: (r() < 0.75 ? "scrapper" : "cutter") as KillKind }));
        const bandits = ring(w.bandits.campsNear(f.x, f.z, max), min, max, f).map((c) => ({ id: c.id, x: c.x, z: c.z, radius: Math.max(70, c.radius * 4), cull: "bandit" as KillKind }));
        void mid;
        return pick(r, [...robots, ...bandits].filter((c) => !taken(c.id)));
      },
      lair: (r, min, max) => {
        const f = src.from;
        const ls: Lair[] = [];
        for (const c of ring(w.camps.campsNear(f.x, f.z, max), min, max, f)) { const l = this.lairs.at({ id: c.id, x: c.x, z: c.z, faction: "robot" }); if (l) ls.push(l); }
        for (const c of ring(w.bandits.campsNear(f.x, f.z, max), min, max, f)) { const l = this.lairs.at({ id: c.id, x: c.x, z: c.z, faction: "bandit" }); if (l) ls.push(l); }
        const l = pick(r, ls.filter((q) => q.state !== "dead" && !taken(q.id)));
        return l ? { id: l.id, x: l.x, z: l.z, radius: v.hvtRadius, name: l.name } : null;
      },
      open: (r, min, max) => {
        const f = src.from;
        for (let k = 0; k < 24; k++) {
          const a = r() * Math.PI * 2, d = min + r() * (max - min), x = f.x + Math.sin(a) * d, z = f.z + Math.cos(a) * d;
          if (w.blocked(x, z) || w.camps.campsNear(x, z, 150).length || w.bandits.campsNear(x, z, 120).length) continue;
          return { x, z };
        }
        return null;
      },
    };
    return src;
  }

  update(dt: number, inp: QuestInput) {
    const { board, lairs, tow, hvt, w, v } = this;
    const who = inp.pilot ?? inp.mech;
    this.src.from = w.lead();
    this.usesE = false;
    this.prompt = "";
    // The run: banked delivers what was carried; a loss fails it.
    for (const e of inp.expEvents) {
      if (e.type === "banked") board.banked();
      else if (e.type === "lost") board.lost();
    }
    board.step(dt, inp.out, inp.jHeld, this.src);
    // Lairs: look at the camps round whoever is out there a couple of times a second.
    this.scanT -= dt;
    if (this.scanT <= 0 && inp.out) {
      this.scanT = 0.5;
      this.near = null;
      let nd = Infinity;
      const R = v.hvtLeash;
      const consider = (l: Lair | null) => { if (!l) return; const d = Math.hypot(l.x - who.x, l.z - who.z); if (d < v.hvtRadius && d < nd) { nd = d; this.near = l; } };
      for (const c of w.camps.campsNear(who.x, who.z, R)) consider(lairs.at({ id: c.id, x: c.x, z: c.z, faction: "robot" }));
      for (const c of w.bandits.campsNear(who.x, who.z, R)) consider(lairs.at({ id: c.id, x: c.x, z: c.z, faction: "bandit" }));
    }
    if (inp.out) lairs.step(dt, who.x, who.z);
    for (const e of lairs.events) {
      if (e.type === "stirring") this.note(`${e.lair.name} has noticed · it's coming`, "#ff8a6a", 4);
      else if (e.type === "summon") {
        const l = e.lair, level = Math.max(1, Math.round(1 + w.depth(l.x, l.z) / Math.max(1, v.levelMetres ?? 100))) + Math.round(v.hvtUp);
        void hvt.spawn(l, e.x, e.z, level).then((ok) => { if (!ok) lairs.stand(l.id); else this.note(`${l.name} · high value target`, "#ff5a3a", 4); });
      } else if (e.type === "escaped") {
        if (hvt.lair?.id === e.lair.id) hvt.despawn();
        this.note(`${e.lair.name} went back to ground`, "#a99f8a", 3);
      }
    }
    lairs.events.length = 0;
    // The HVT: its step, its death (drops, the bounty), its wreck cleared after a while.
    if (hvt.lair) {
      hvt.step(dt);
      if (hvt.died) {
        hvt.died = false;
        const l = hvt.lair, p = hvt.pos!;
        lairs.killed(l.id);
        board.hvtKilled(l.id);
        const ctx = w.dropCtx(p.x, p.z);
        for (let k = 0, n = Math.round(v.hvtDrops); k < n; k++) w.drops.roll(`hvt:${l.id}:${k}`, 1, p.x, p.z, ctx, { rarity: k === 0 ? "epic" : "rare", level: hvt.level });
        this.note(`${l.name} destroyed`, "#ffd27a", 4);
        this.wreckT = v.hvtWreckFor;
      }
      if (!hvt.unit?.alive && (this.wreckT -= dt) <= 0) hvt.despawn();
    }
    // Board events: notes and pay.
    for (const e of board.events) {
      const c = e.c;
      if (e.type === "offered") this.note(`Contract offered · ${KIND_NAME[c.kind]} · ${Math.round(c.dist / 10) * 10} m · +${c.reward} · J to accept`, "#ffd27a", 5);
      else if (e.type === "accepted") this.note(`Contract taken · ${KIND_NAME[c.kind]}`, "#ffd27a", 3);
      else if (e.type === "done") {
        if (e.to === "atRisk") { w.exp.add({ kind: "scrap", amount: c.reward, label: `Contract: ${KIND_NAME[c.kind]}` }); this.note(`${KIND_NAME[c.kind]} done · +${c.reward} scrap at risk`, "#ffd27a", 4); }
        else { w.exp.bank.scrap += c.reward; this.note(`${KIND_NAME[c.kind]} delivered · +${c.reward} scrap banked`, "#ffd27a", 4); }
      } else if (e.type === "failed") this.note(`${KIND_NAME[c.kind]} failed · ${e.why}`, "#ff8a6a", 4);
      else if (e.type === "dropped") this.note(`${KIND_NAME[c.kind]} dropped`, "#a99f8a", 3);
    }
    // A tow or pod contract ending clears its things off the sand.
    for (const e of board.events) if ((e.type === "done" || e.type === "failed" || e.type === "dropped") && e.c.id === this.hulkJob) { tow.drop(); this.hulkJob = null; }
    board.events.length = 0;
    this.stepTow(dt, inp);
    this.stepPods(inp);
    this.show(dt, inp);
  }

  private note(text: string, color: string, secs: number) { this.w.hud.note(text, color, secs); }

  /** The hulk: put on the sand when its tow is taken; hold E by it to hook, again to drop; dragged on the cable. */
  private stepTow(dt: number, inp: QuestInput) {
    const { tow, board } = this, m = inp.mech;
    if (!this.hulkJob) {
      const c = board.active.find((q) => q.kind === "tow");
      if (c) { this.hulkJob = c.id; if (!this.placed.has(c.id)) { this.placed.add(c.id); tow.place(c.x, c.z, this.field.height(c.x, c.z)); } }
    }
    if (!this.hulkJob) return;
    // Only the mech tows (not the pilot on foot), alive, out on the sand.
    const can = inp.out && inp.onSand && m.alive && !inp.pilot;
    if (!can && tow.on) { tow.drop(); board.towing(this.hulkJob, false); }
    if (can && (tow.on || tow.reach(m.x, m.z))) {
      this.usesE = inp.eHeld || tow.hold > 0;
      this.prompt = tow.hold > 0 ? `${tow.on ? "Dropping" : "Hooking"}… ${Math.round(tow.hold * 100)}%` : tow.on ? "" : "Hold E: hook the downed Rampart";
      const r = tow.holdE(dt, inp.eHeld, this.hulkJob);
      if (r === "hooked") { board.towing(this.hulkJob, true); this.note("Hulk on the cable · get it to the crane", "#ffd27a", 3); }
      if (r === "dropped") board.towing(this.hulkJob, false);
    } else tow.holdE(dt, false, this.hulkJob);
    // While aboard (banked with it, hanging from the crane) the hulk rides along; the contract ends right after.
    tow.step(dt, m.x, m.z, (x, z) => this.field.height(x, z));
  }

  /** Pods: walked over by the mech (on the sand) or the pilot on foot. */
  private stepPods(inp: QuestInput) {
    if (!inp.out) return;
    const who = inp.pilot ?? (inp.onSand && inp.mech.alive ? inp.mech : null);
    if (!who) return;
    for (const c of this.board.active) {
      if (c.kind !== "pods" || !c.pods) continue;
      for (const k of podsInReach(c.pods, who.x, who.z, this.v.podReach)) if (this.board.pod(c.id, k)) this.note(`Escape pod aboard · ${c.have}/${c.need} (at risk)`, "#ffd27a", 2.5);
    }
  }

  /** Beacons, the hulk and pods, radar diamonds, edge marks, the panel. */
  private show(dt: number, inp: QuestInput) {
    const { board, hvt, tow } = this, beacons: Beacon[] = [], pods: { x: number; z: number }[] = [];
    this.radar.length = 0; this.marks.length = 0;
    const field = this.field;
    for (const c of board.active) {
      if (c.kind === "tow" && c.carrying) continue;
      const at = c.kind === "tow" && c.id === this.hulkJob ? { x: tow.x, z: tow.z } : c.kind === "bounty" && hvt.lair?.id === c.site && hvt.pos ? hvt.pos : c;
      beacons.push({ x: at.x, z: at.z, color: GOLD });
      this.radar.push({ x: at.x, z: at.z, color: "#ffd27a" });
      this.marks.push({ id: "contract:" + c.id, x: at.x, y: field.height(at.x, at.z) + 3, z: at.z, text: `CONTRACT · ${KIND_NAME[c.kind].toUpperCase()}`, color: "#ffd27a", strength: 1 });
      if (c.pods) for (const p of c.pods) if (p) pods.push(p);
    }
    // The lair stirring or its HVT out: a red pillar and diamond.
    const l = hvt.lair ?? this.lairs.known().find((q) => q.state === "stirring") ?? null;
    if (l) {
      const at = hvt.lair && hvt.pos && hvt.unit?.alive ? hvt.pos : l;
      beacons.push({ x: at.x, z: at.z, color: RED });
      this.radar.push({ x: at.x, z: at.z, color: "#ff6a4a" });
      if (hvt.unit?.alive) this.marks.push({ id: "hvt", x: at.x, y: field.height(at.x, at.z) + 5, z: at.z, text: l.name.toUpperCase(), color: "#ff6a4a", strength: 1 });
    }
    const hulk = this.hulkJob ? { x: tow.x, y: tow.y, z: tow.z, heading: tow.heading } : null;
    let hook = null;
    if (hulk && tow.on) { const p = this.player.sim.pelvis, h = this.player.sim.heading; hook = this.hook.set(p.x - Math.sin(h) * 1.2, p.y + 0.4, p.z - Math.cos(h) * 1.2); }
    this.draw?.update(dt, beacons, hulk, hook, pods);
    const u = hvt.unit;
    this.qhud.update({
      board, from: inp.pilot ?? inp.mech,
      lair: hvt.lair ?? this.near,
      hvt: hvt.lair && u && u.alive ? { name: hvt.lair.name, health: u.health / u.maxHealth, level: hvt.level } : null,
      towing: tow.on, prompt: this.prompt,
    });
  }

  /** Debug line. */
  get line() {
    const b = this.board, l = this.hvt.lair;
    return `contracts ${b.active.length} active, ${b.offers.length} offered (next ${Math.max(0, b.next).toFixed(0)} s) · lairs known ${this.lairs.known().length}${l ? ` · HVT ${l.name} ${this.hvt.unit?.alive ? "fighting" : "down"}` : ""}${this.tow.on ? " · towing" : ""}`;
  }
}

/** Contract kinds as lab flag values. */
export const QUEST_FLAGS: ContractKind[] = ["salvage", "cull", "bounty", "tow", "pods"];
export type { Contract };
