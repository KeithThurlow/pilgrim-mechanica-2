// A headless duel (for tools/duel-check.ts): two mechs on the real leg sim (WalkerSim) and dash (Dash), each driven by
// a RivalAi through the same MechCommand the lab hands a MechUnit, with simple weapon models fed by the same kit stats
// (src/combat/rivalKit.ts): rounds hit by the miss between the aim and the body plus spread, rails along their line at
// the release, rockets, shells, mortars, line-mortar strips and missile swarms land after their flight with their
// blast. No torso turn, no penetration, no Protocols: it's for checking the AI's rules (it dodges, it fights, it never
// gets stuck), not for balance numbers. Seeded throughout.
import { WalkerSim } from "../mech/walker";
import { WALKER_DEFAULTS } from "../mech/walkerTuning";
import { LEG_TYPES } from "../mech/legTypes";
import { Dash, DASH_DEFAULTS } from "../mech/dash";
import { BOUND_DEFAULTS } from "../mech/bound";
import { MECH_DEFAULTS } from "../game/mechUnit";
import { WEAPON_DEFAULTS } from "../weapons/tuning";
import { DuneField, TERRAIN_DEFAULTS } from "../world/terrain";
import { addModifier } from "../world/modifiers";
import { rng, LOOT_DEFAULTS } from "../items/generate";
import { resolve, LOADOUT_DEFAULTS, type Loadout } from "../items/loadout";
import { DuelGround, DUEL_GROUND_DEFAULTS, lineOfSight } from "../game/duelGround";
import { RivalAi, RIVAL_AI_DEFAULTS, type DuelView, type MechCommand, type Threat, type WeaponState } from "./rivalAi";
import { kitOf, rollRivalLoadout, type KitWeapon } from "./rivalKit";
import { DuelScore } from "./duelScore";

const W = WEAPON_DEFAULTS;
const HIT_R = MECH_DEFAULTS.hitRadius;

interface Flying { id: number; from: 0 | 1; kind: string; x: number; z: number; ax?: number; az?: number; r: number; land: number; damage: number; blast: number; homing: number;
  /** Would it have hit where the target stood when it was fired? (for the dodge count) */ wouldHit: boolean; dealt: number; parts: number; partsLeft: number; spacing: number; length: number }

interface Gun { cool: number; charge: number; holding: boolean; spin: number; acc: number; prevKey: boolean; railFrom: { x: number; z: number } | null }

class DuelMech {
  sim: WalkerSim;
  dash: Dash;
  health: number;
  hull: number;
  kit: KitWeapon[];
  guns: Gun[];
  moved = 0;
  fired = 0;
  hist: { x: number; z: number }[] = [];
  constructor(readonly v: typeof WALKER_DEFAULTS & typeof DASH_DEFAULTS & typeof BOUND_DEFAULTS & { hull: number; walkSpeed: number }, field: DuneField, lo: Loadout) {
    const r = resolve(lo, LOADOUT_DEFAULTS);
    Object.assign(this.v, r.values);
    this.sim = new WalkerSim(this.v, field);
    this.dash = new Dash(this.v);
    this.dash.charges = Math.round(this.v.dashCharges);
    this.hull = this.health = r.values.hull;
    this.kit = kitOf(r, W);
    this.guns = this.kit.map(() => ({ cool: 0, charge: 0, holding: false, spin: 0, acc: 0, prevKey: false, railFrom: null }));
  }
  get alive() { return this.health > 0; }
}

export interface DuelResult {
  winner: 0 | 1 | -1;
  time: number;
  score: DuelScore;
  /** Telegraphed shots that would have hit where their target stood when fired, and how many of those missed. */
  threatened: [number, number];
  dodged: [number, number];
  dashes: [number, number];
  /** Threatened / dodged by weapon kind (both sides). */
  byKind: Record<string, [number, number]>;
  /** Rail slugs fired and slugs that hurt, by shooter. */
  rail: [[number, number], [number, number]];
  /** Worst stretch (s) where a mech neither moved 3 m nor fired. */
  stuckWorst: number;
  nan: boolean;
  /** Seconds each AI spent in each state. */
  states: Record<string, number>[];
  ai?: RivalAi[];
}

export interface DuelOptions {
  seedA: number; seedB: number; aiSeed?: number; maxTime?: number; field?: { flat?: boolean }; ai?: Partial<typeof RIVAL_AI_DEFAULTS>;
  /** Fitted loadouts instead of rolled ones (a drill's fixed kit). */
  loadouts?: [Loadout | null, Loadout | null];
  /** Drive a mech by script instead of its AI (a drill's shooter): return null to let the AI decide. */
  script?: (i: number, view: DuelView, t: number) => MechCommand | null;
  /** Where the two start (default: duelStart apart on Z, facing each other). */
  starts?: [{ x: number; z: number; heading: number }, { x: number; z: number; heading: number }];
  /** Hull for both (a drill keeps them alive). */
  hull?: number;
  /** Per-mech AI values (e.g. a level for the rival, index 1) over `ai`, and a hull multiplier each. */
  aiEach?: [Partial<typeof RIVAL_AI_DEFAULTS> | undefined, Partial<typeof RIVAL_AI_DEFAULTS> | undefined];
  hullMul?: [number, number];
  /** Called with every command each frame (a check watching the painted spot). */
  onCmd?: (i: number, cmd: MechCommand, t: number) => void;
  /** Dash charges refilled every frame for this mech (a drill's dodger: every shot gets a dash). */
  freeDash?: [boolean, boolean];
  /** Cover drifts (default the lab's). */
  cover?: number;
}

/** Run one duel to a kill (or maxTime). */
export function runDuel(o: DuelOptions): DuelResult {
  const gv = { ...DUEL_GROUND_DEFAULTS, ...(o.cover !== undefined ? { duelCover: o.cover } : {}) };
  const field = new DuneField({ ...TERRAIN_DEFAULTS, ...(o.field?.flat ? { height: 0, swell: 0, bumps: 0 } : {}) });
  const ground = new DuelGround(gv);
  addModifier(field, ground);
  field.update();
  const h = (x: number, z: number) => field.height(x, z);
  const sees = (ax: number, az: number, bx: number, bz: number) => lineOfSight(h, ground.spots, ax, az, bx, bz);
  const base = () => ({ ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values, ...DASH_DEFAULTS, ...BOUND_DEFAULTS, hull: MECH_DEFAULTS.hull });
  const mechs = [new DuelMech(base(), field, o.loadouts?.[0] ?? rollRivalLoadout(o.seedA, LOOT_DEFAULTS)), new DuelMech(base(), field, o.loadouts?.[1] ?? rollRivalLoadout(o.seedB, LOOT_DEFAULTS))];
  const starts = o.starts ?? [{ x: 0, z: -gv.duelStart, heading: 0 }, { x: 0, z: gv.duelStart, heading: Math.PI }];
  mechs.forEach((m, i) => { m.sim.reset(starts[i].x, starts[i].z, starts[i].heading); if (o.hull) m.hull = m.health = o.hull; if (o.hullMul) m.hull = m.health = Math.round(m.hull * o.hullMul[i]); });
  const aiv = { ...RIVAL_AI_DEFAULTS, ...o.ai };
  const ais = [new RivalAi({ ...aiv, ...o.aiEach?.[0] }, (o.aiSeed ?? 1) * 2 + 1), new RivalAi({ ...aiv, ...o.aiEach?.[1] }, (o.aiSeed ?? 1) * 2 + 2)];
  const r = rng((o.aiSeed ?? 1) * 104729 + o.seedA * 31 + o.seedB);
  const score = new DuelScore();
  score.start(0);
  const flying: Flying[] = [];
  let nextId = 1;
  const res: DuelResult = { winner: -1, time: 0, score, threatened: [0, 0], dodged: [0, 0], dashes: [0, 0], byKind: {}, rail: [[0, 0], [0, 0]], stuckWorst: 0, nan: false, states: [] };
  const dt = 1 / 60, maxT = o.maxTime ?? 90;
  let t = 0;
  const lastAct = [0, 0], lastPos = mechs.map((m) => ({ x: m.sim.pos.x, z: m.sim.pos.z }));

  const tally = (i: number, kind: string, dodged: boolean) => {
    res.threatened[i]++; if (dodged) res.dodged[i]++;
    const b = res.byKind[kind] ?? (res.byKind[kind] = [0, 0]);
    b[0]++; if (dodged) b[1]++;
  };
  const hurt = (i: number, kind: string, amount: number) => {
    const m = mechs[i];
    if (!m.alive || amount <= 0) return 0;
    if (m.dash.shoving) amount *= m.v.dashDamageCut;
    const d = Math.min(m.health, amount);
    m.health -= d;
    score.hit(i === 0 ? "player" : "rival", kind, d, t);
    return d;
  };
  /** Blast damage: full at the hull, half at the blast's edge. */
  const blastOn = (i: number, x: number, z: number, blast: number, damage: number, kind: string) => {
    const m = mechs[i], e = Math.max(0, Math.hypot(m.sim.pos.x - x, m.sim.pos.z - z) - HIT_R);
    return e <= blast ? hurt(i, kind, damage * (1 - 0.5 * e / Math.max(0.01, blast))) : 0;
  };
  const inZone = (f: Flying, x: number, z: number) => {
    if (f.ax === undefined) return Math.hypot(x - f.x, z - f.z) < f.r + HIT_R;
    const lx = f.x - f.ax, lz = f.z - f.az!, l2 = lx * lx + lz * lz || 1;
    const u = Math.max(0, Math.min(1, ((x - f.ax) * lx + (z - f.az!) * lz) / l2));
    return Math.hypot(x - (f.ax + lx * u), z - (f.az! + lz * u)) < f.r + HIT_R;
  };

  function view(i: number): DuelView {
    const m = mechs[i], f = mechs[1 - i];
    const threats: Threat[] = [];
    for (const fl of flying) if (fl.from !== i) threats.push(fl.ax !== undefined
      ? { id: fl.id, kind: "line", ax: fl.ax, az: fl.az, x: fl.x, z: fl.z, r: fl.r, t: Math.max(0, fl.land - t) }
      : { id: fl.id, kind: "ring", x: fl.x, z: fl.z, r: fl.r, t: Math.max(0, fl.land - t), homing: !!fl.homing });
    // The foe's rails charging: a line from it along its aim.
    f.kit.forEach((k, j) => {
      const g = f.guns[j];
      if (k.kind !== "rail" || !g.holding || !g.railFrom) return;
      const dx = g.railFrom.x - f.sim.pos.x, dz = g.railFrom.z - f.sim.pos.z, l = Math.hypot(dx, dz) || 1;
      threats.push({ id: 100000 + (1 - i) * 10 + j, kind: "line", ax: f.sim.pos.x, az: f.sim.pos.z, x: f.sim.pos.x + dx / l * k.range, z: f.sim.pos.z + dz / l * k.range, r: W.railSheetHalf, t: Infinity, rail: true, charge: g.charge });
    });
    const weapons: WeaponState[] = m.kit.map((_k, j) => ({ i: j, ready: m.guns[j].cool <= 0, charge: m.guns[j].charge }));
    return {
      t, threats, cover: ground.spots, sees, arena: { x: 0, z: 0, r: gv.duelRadius },
      self: { x: m.sim.pos.x, z: m.sim.pos.z, vx: m.sim.vel.x, vz: m.sim.vel.z, heading: m.sim.heading, health: m.health / m.hull, dashCharges: m.dash.charges, canDash: m.sim.canDash, dashing: m.dash.active, walkSpeed: m.v.walkSpeed, kit: m.kit, weapons },
      foe: { x: f.sim.pos.x, y: f.sim.pelvis.y, z: f.sim.pos.z, vx: f.sim.vel.x, vz: f.sim.vel.z, health: f.health / f.hull, dashCharges: f.dash.charges, alive: f.alive, gunsOff: false, airborne: f.sim.airborne, staggered: f.sim.stagger > 0, r: HIT_R },
    };
  }

  function launch(i: number, k: KitWeapon, kind: string, at: { x: number; z: number }, extra: Partial<Flying> = {}) {
    const m = mechs[i], f = mechs[1 - i];
    const d = Math.hypot(at.x - m.sim.pos.x, at.z - m.sim.pos.z);
    const flight = extra.land ?? (k.flight || d / Math.max(1, k.speed === Infinity ? 200 : k.speed));
    const fl: Flying = { id: nextId++, from: i as 0 | 1, kind, x: at.x, z: at.z, r: k.blast, land: t + flight, damage: k.damage, blast: k.blast, homing: 0, wouldHit: false, dealt: 0, parts: 1, partsLeft: 1, spacing: 0, length: 0, ...extra };
    if (extra.land !== undefined) fl.land = t + extra.land;
    fl.wouldHit = inZone(fl, f.sim.pos.x, f.sim.pos.z);
    flying.push(fl);
    m.fired++; lastAct[i] = t;
  }

  function weapons(i: number, cmd: MechCommand) {
    const m = mechs[i], f = mechs[1 - i];
    const dist = Math.hypot(f.sim.pos.x - m.sim.pos.x, f.sim.pos.z - m.sim.pos.z);
    const see = sees(m.sim.pos.x, m.sim.pos.z, f.sim.pos.x, f.sim.pos.z);
    m.kit.forEach((k, j) => {
      const g = m.guns[j];
      g.cool = Math.max(0, g.cool - dt);
      if ("trigger" in k.ctl) {
        const held = cmd.trigger[k.ctl.trigger] && m.alive;
        if (k.kind === "minigun" || k.kind === "autocannon") {
          g.spin = held ? Math.min(1, g.spin + dt / Math.max(0.05, k.spinUp)) : Math.max(0, g.spin - dt * 2);
          if (!held || g.spin < 1 || !cmd.shotAt || dist > k.range) { g.acc = 0; return; }
          g.acc += k.rate * dt;
          while (g.acc >= 1) {
            g.acc -= 1; m.fired++; lastAct[i] = t;
            const spread = Math.tan(k.spread * Math.PI / 180) * dist * r();
            const a = r() * Math.PI * 2;
            if (k.kind === "minigun") {
              const mx = cmd.shotAt.x + Math.cos(a) * spread - f.sim.pos.x, mz = cmd.shotAt.z + Math.sin(a) * spread - f.sim.pos.z;
              if (see && Math.hypot(mx, mz) < HIT_R) hurt(1 - i, "minigun", k.damage);
            } else if (cmd.lock) {
              const fl = dist / k.speed;
              const at = { x: cmd.lock.x + (cmd.lock.vx ?? 0) * fl + Math.cos(a) * spread, z: cmd.lock.z + (cmd.lock.vz ?? 0) * fl + Math.sin(a) * spread };
              launch(i, k, "autocannon", at, { r: Math.max(k.blast, 0.5), land: fl });
            }
          }
        } else if (k.kind === "rail") {
          // In a dash: the charge is dropped and none builds (Keith 2026-10-31, as src/weapons/arsenal.ts).
          if (m.sim.inDash) { g.holding = false; g.charge = 0; }
          else if (held) {
            if (g.cool <= 0) { if (!g.holding) g.railFrom = null; g.holding = true; g.charge = Math.min(1, g.charge + dt / Math.max(0.05, k.charge)); }
            if (cmd.lock) g.railFrom = { x: cmd.lock.x, z: cmd.lock.z };
          } else if (g.holding) {
            g.holding = false;
            const c = g.charge; g.charge = 0;
            if (c >= W.railMinCharge && g.railFrom) {
              g.cool = k.cooldown; m.fired++; lastAct[i] = t;
              const power = c >= 1 - W.railGrace ? 1 : c;
              const ax = m.sim.pos.x, az = m.sim.pos.z, dx = g.railFrom.x - ax, dz = g.railFrom.z - az, l = Math.hypot(dx, dz) || 1;
              const seg = (px: number, pz: number) => { const u = Math.max(0, Math.min(k.range, (px - ax) * dx / l + (pz - az) * dz / l)); return Math.hypot(px - (ax + dx / l * u), pz - (az + dz / l * u)); };
              const was = f.hist[Math.max(0, f.hist.length - 24)] ?? { x: f.sim.pos.x, z: f.sim.pos.z };
              const would = seg(was.x, was.z) < HIT_R + W.railSheetHalf;
              const hit = see && seg(f.sim.pos.x, f.sim.pos.z) < HIT_R + W.railSheetHalf ? hurt(1 - i, "rail", k.damage * power) : 0;
              res.rail[i][0]++; if (hit) res.rail[i][1]++;
              if (would) tally(1 - i, "rail", !hit);
            }
          }
        } else if (k.kind === "rpg") {
          if (held && g.cool <= 0 && cmd.cursor && dist < k.range) { g.cool = k.cooldown; launch(i, k, "rocket", cmd.cursor); }
        }
        return;
      }
      // Shoulders: hold to paint, release fires.
      const key = cmd.keys[k.ctl.key - 1] && m.alive;
      const released = g.prevKey && !key;
      g.prevKey = key;
      if (!released || g.cool > 0 || !cmd.cursor) return;
      g.cool = k.cooldown;
      const c = cmd.cursor;
      if (k.kind === "mortar") launch(i, k, "mortar", c, { land: k.flight });
      else if (k.kind === "shrpg") launch(i, k, "rocket", c);
      else if (k.kind === "missiles") launch(i, k, "missiles", c, { homing: 1, parts: k.count, partsLeft: k.count, land: dist / k.speed + 0.8, r: k.blast + 1 });
      else {
        // The line mortar: a strip from the mech's side of the cursor, out along the line to it.
        const dx = c.x - m.sim.pos.x, dz = c.z - m.sim.pos.z, l = Math.hypot(dx, dz) || 1, L = W.salvoLength;
        const ax = c.x - dx / l * L / 2, az = c.z - dz / l * L / 2;
        launch(i, k, "linemortar", { x: c.x + dx / l * L / 2, z: c.z + dz / l * L / 2 }, { ax, az, r: k.blast, parts: k.count, partsLeft: k.count, spacing: W.salvoLandGap, land: Math.hypot(ax - m.sim.pos.x, az - m.sim.pos.z) / k.speed + 0.8, length: L });
      }
    });
  }

  function land() {
    for (let n = flying.length - 1; n >= 0; n--) {
      const fl = flying[n], ti = 1 - fl.from, tgt = mechs[ti];
      // Missiles follow their target all the way down (src/weapons/swarm.ts): no getting out, only the dash's damage cut.
      if (fl.homing) { fl.x = tgt.sim.pos.x; fl.z = tgt.sim.pos.z; }
      if (t < fl.land) continue;
      const kind = fl.kind === "autocannon" ? "autocannon" : fl.kind;
      if (fl.ax !== undefined) {
        // One rocket of the strip at a time, near end first.
        const u = fl.parts > 1 ? 1 - fl.partsLeft / fl.parts : 0.5;
        const x = fl.ax + (fl.x - fl.ax) * u, z = fl.az! + (fl.z - fl.az!) * u;
        fl.dealt += blastOn(ti, x, z, fl.blast, fl.damage, kind);
        fl.partsLeft--; fl.land += fl.spacing;
        if (fl.partsLeft > 0) continue;
      } else if (fl.parts > 1) {
        for (let p = 0; p < fl.parts; p++) { const a = p * 2.4, rr = 1.2 * Math.sqrt(p / fl.parts); fl.dealt += blastOn(ti, fl.x + Math.cos(a) * rr, fl.z + Math.sin(a) * rr, fl.blast, fl.damage, kind); }
      } else if (fl.kind === "autocannon") {
        const d = Math.hypot(tgt.sim.pos.x - fl.x, tgt.sim.pos.z - fl.z);
        fl.dealt += d < HIT_R ? hurt(ti, kind, fl.damage) : d < HIT_R + fl.blast ? hurt(ti, kind, fl.damage * W.acSplashShare) : 0;
      } else fl.dealt += blastOn(ti, fl.x, fl.z, fl.blast, fl.damage, kind);
      if (fl.kind !== "autocannon" && !fl.homing && fl.wouldHit) tally(ti, fl.kind, fl.dealt <= 0);
      flying.splice(n, 1);
    }
  }

  while (t < maxT && mechs.every((m) => m.alive)) {
    t += dt;
    const cmds = mechs.map((_, i) => { const vw = view(i); return o.script?.(i, vw, t) ?? ais[i].decide(vw, dt); });
    if (o.onCmd) cmds.forEach((c, i) => o.onCmd!(i, c, t));
    mechs.forEach((m, i) => {
      const cmd = cmds[i];
      if (o.freeDash?.[i]) m.dash.charges = Math.round(m.v.dashCharges);
      if (cmd.dash && m.sim.canDash && m.dash.start(cmd.dash.x, cmd.dash.z)) { m.sim.dash(m.dash.dirX, m.dash.dirZ); res.dashes[i]++; }
      for (let s = 0; s < 2; s++) {
        m.dash.update(dt / 2);
        m.sim.push.set(0, 0, 0);
        m.sim.crouch = 0;
        const was = m.sim.inDash;
        m.sim.update(dt / 2, cmd.move);
        if (was && !m.sim.inDash) m.dash.cut();
      }
      if (!Number.isFinite(m.sim.pos.x + m.sim.pos.z + m.sim.pelvis.y)) res.nan = true;
      m.hist.push({ x: m.sim.pos.x, z: m.sim.pos.z });
      if (m.hist.length > 60) m.hist.shift();
      const lp = lastPos[i];
      if (Math.hypot(m.sim.pos.x - lp.x, m.sim.pos.z - lp.z) > 3) { lastAct[i] = Math.max(lastAct[i], t); lp.x = m.sim.pos.x; lp.z = m.sim.pos.z; }
      res.stuckWorst = Math.max(res.stuckWorst, t - lastAct[i]);
    });
    mechs.forEach((_, i) => weapons(i, cmds[i]));
    land();
    if (res.nan) break;
  }
  res.time = t;
  res.winner = mechs[0].alive && !mechs[1].alive ? 0 : mechs[1].alive && !mechs[0].alive ? 1 : -1;
  if (res.winner >= 0) score.end(t, res.winner === 0 ? "player" : "rival");
  res.states = ais.map((a) => ({ ...a.stats.states }));
  res.ai = ais;
  return res;
}
