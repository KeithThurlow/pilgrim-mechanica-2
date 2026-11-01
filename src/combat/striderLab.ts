// Striders in a combat lab (Keith 2026-11-01: "labs robots and lab strider should probably be the same lab"): the glue
// that was labs/strider, now mounted in the robots lab. Stands striders up round the player, resolves their events on
// the battlefield (beam, slam, grab and tear, footfalls, deaths as ragdolls), draws them and their attacks. Host for
// the damage; drawing cosmetic.
// Flags: ?strider=N (N up at once), ?strider=beam|slam|grab (one about to beam at 45 m, slam at 14 m, grab at 6 m; no
// robot packs), ?striderdist=m (where they stand up).
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { CombatLab, SelectEntry } from "../game/combatLab";
import { Striders, STRIDER_DEFAULTS, STRIDER_PARAMS, type Strider } from "./strider";
import { StriderBody } from "./striderBody";
import { StriderTarget } from "./striderTarget";
import { StriderFx } from "./striderFx";
import { striderRagdoll } from "./striderRagdoll";
import { fireRobotBeam } from "../game/robotBeam";
import { RobotTearFx, ROBOT_TEAR_DEFAULTS } from "./robotTearFx";

export const STRIDER_LAB_DEFAULTS = { ...STRIDER_DEFAULTS, ...ROBOT_TEAR_DEFAULTS, striderCount: 1, striderFrom: 90, striderBack: 6, striderBeamReach: 5 };
export type StriderLabValues = typeof STRIDER_LAB_DEFAULTS;
const GL = "Striders: in the lab";
export const STRIDER_LAB_PARAMS: Param[] = [
  { key: "striderCount", label: "Striders up at once", min: 0, max: 6, step: 1, group: GL },
  { key: "striderFrom", label: "They stand up at (m)", min: 20, max: 300, step: 5, group: GL },
  { key: "striderBack", label: "Another after a kill (s)", min: 0, max: 60, step: 1, group: GL },
  { key: "striderBeamReach", label: "Beam burns up to (m above ground)", min: 1, max: 15, step: 0.5, group: "Striders: beam" },
  ...STRIDER_PARAMS,
];
export const STRIDER_TOPIC = { id: "striders", label: "Striders", groups: [GL, "Striders", "Striders: beam", "Striders: slam", "Striders: tearing"] };

/** Make before the lab (its selector entry and buttons), attach() once the lab is up. */
export class StriderLab {
  readonly bodies = new Map<number, StriderBody>();
  pack: Striders | null = null;
  readonly selectable: SelectEntry = { topic: "striders", label: "Striders", objects: () => [...this.bodies.values()].map((b) => b.root) };
  readonly actions = [{ label: "Strider now", onClick: () => this.spawn() }, { label: "Striders stand up again", onClick: () => this.restart() }];
  /** True when a ?strider= scenario asked for no robot packs. */
  readonly scenario: string | null;
  private lab: CombatLab<StriderLabValues> | null = null;
  private spawnSeed = 1;
  private backClock = 0;
  private grabs = 0;
  private grabDamage = 0;

  constructor(private q = new URLSearchParams(location.search)) {
    const f = q.get("strider");
    this.scenario = f === "beam" || f === "slam" || f === "grab" ? f : null;
  }

  report() { const p = this.pack; return p ? { striders: p.alive, beams: p.beams, slams: p.slams, grabs: this.grabs, kills: p.kills } : {}; }

  attach<E extends StriderLabValues>(lab: CombatLab<E>) {
    const L = lab as unknown as CombatLab<StriderLabValues>;
    this.lab = L;
    const { V, bf, player, field } = L, q = this.q;
    const f = q.get("strider");
    if (f !== null && this.scenario === null) V.striderCount = Number(f) || 0;
    if (q.has("striderdist")) V.striderFrom = Number(q.get("striderdist")) || V.striderFrom;
    const pack = (this.pack = new Striders(V, field, 1));
    const target = new StriderTarget(pack, 3);
    bf.targets.push(target);
    bf.register.add(target);
    const fx = new StriderFx(field);
    L.app.scene.add(fx.group);
    const tear = new RobotTearFx(bf.gunFx, bf.sfx, field, V);
    L.app.scene.add(tear.group);
    const at = new THREE.Vector3(), hitAt = new THREE.Vector3(), hitDir = new THREE.Vector3();
    // Who they hunt this frame (the mech, or the pilot on foot when he's nearer).
    let hunted: ReturnType<typeof L.prey> | null = null;
    pack.onEvent = (e) => {
      if (e.type === "melee") {
        // The claws and blades bite: the damage, sparks and torn plate where they hit, and the strike throws the mech.
        if (!hunted?.alive) return;
        hunted.unit.damage(e.damage, hitAt.set(e.x, e.y, e.z), hitDir.set(e.dx, 0, e.dz));
        this.grabDamage += e.damage;
        const src = pack.list.find((x) => x.id === e.id)?.pos(at);
        tear.bite(e.x, e.y, e.z, src?.x ?? e.x, src?.z ?? e.z);
        if (e.kind === "strike") {
          this.grabs++;
          tear.bite(e.x, e.y + 0.5, e.z, src?.x ?? e.x, src?.z ?? e.z);
          L.shake(0.6);
          if (hunted.kind === "mech" && src) player.shoveFrom(src.x, src.z, V.striderMeleeReach * 2, e.shove);
        }
      } else if (e.type === "beam") {
        fx.beam(e.id, e.beam);
        fireRobotBeam(bf, e.beam, V.striderBeamReach);
        L.shake(0.25);
      } else if (e.type === "slam") {
        fx.slam(e.id, e.x, e.y, e.z);
        bf.blast(3, at.set(e.x, e.y, e.z), e.radius, e.damage, e.pierce, "beam");
        const d = Math.hypot(player.sim.pos.x - e.x, player.sim.pos.z - e.z);
        L.shake(d < e.radius * 2 ? 1 : 0.3);
      } else if (e.type === "footfall") {
        bf.dust.stomp(e.x, e.y, e.z, 0.5 * Math.min(1.5, e.k));
        const d = Math.hypot(player.sim.pos.x - e.x, player.sim.pos.z - e.z);
        if (d < 40) L.shake(0.08 * (1 - d / 40));
      } else if (e.type === "down") {
        const s = pack.list.find((x) => x.id === e.id);
        if (!s) return;
        const r = striderRagdoll(s, field.height(s.pos(at).x, at.z));
        L.deaths.ragdoll(r.parts, r.joints, r.x, r.y, r.z, r.yaw, { x: 0, y: 0, z: 0 }, 0, 0, 1);
        bf.blast(3, at.set(e.x, e.y, e.z), 6, 0, 0, "death");
        this.drop(s);
        this.backClock = V.striderBack;
      }
    };
    // Scenarios: one close by about to slam, one at 45 m about to beam, one in reach about to grab.
    if (this.scenario) V.striderCount = Math.max(1, V.striderCount);
    if (this.scenario === "slam") { const s = this.spawn(14, 0.6); s.slamClock = 0; }
    if (this.scenario === "grab") { const s = this.spawn(6, 0.3); s.meleeClock = 0; s.slamClock = 99; }
    if (this.scenario === "beam") { const s = this.spawn(45, -0.5); s.beamClock = 0.2; s.lockT = V.striderLockTime; }

    const sees = (from: THREE.Vector3, to: THREE.Vector3) => bf.canSee(from, to);
    const prey = { x: 0, y: 0, z: 0, vx: 0, vz: 0, alive: true };
    L.onFrame((dt) => {
      this.backClock -= dt;
      if (pack.list.length < V.striderCount && this.backClock <= 0) this.spawn();
      if (!pack.list.length) return;
      const p0 = pack.list[0].pos(at);
      const pr = L.prey(p0.x, p0.z);
      hunted = pr;
      prey.x = pr.at.x; prey.y = pr.at.y; prey.z = pr.at.z; prey.vx = pr.sim.vel.x; prey.vz = pr.sim.vel.z; prey.alive = pr.alive;
      pack.update(dt, prey, sees);
      for (const s of pack.list) this.bodies.get(s.id)?.update(s, dt);
      fx.update(dt, pack.list);
      tear.update(dt);
      const s = pack.list[0];
      const mode = ["walking", "beam charging", "slam charging", "standing", "down", "grabbing"][s.mode] + (s.rushT > 0 ? " (rushing)" : "");
      L.hud("striders", `striders ${pack.alive} · ${mode} · ${Math.round(s.health)} hp · ${s.seen ? "sees you" : "seeking"} · beams ${pack.beams} · slams ${pack.slams} · grabs ${this.grabs} (${Math.round(this.grabDamage)} damage) · killed ${pack.kills} · hits body ${target.partHits[0]} leg ${target.partHits[1]} foot ${target.partHits[2]}`);
    });
  }

  /** Stand one up `dist` from the player (seeded direction unless given). */
  spawn(dist?: number, angle?: number): Strider {
    const L = this.lab!, pack = this.pack!;
    const a = angle ?? ((this.spawnSeed++ * 2.39996) % (Math.PI * 2));
    const p = L.player.sim.pos, d = dist ?? L.V.striderFrom;
    const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
    const s = pack.spawn(x, z, Math.atan2(p.x - x, p.z - z));
    const body = new StriderBody();
    this.bodies.set(s.id, body);
    L.app.scene.add(body.root);
    return s;
  }

  /** Every strider off the field; they stand up again by the count. */
  restart() { if (this.pack) for (const s of [...this.pack.list]) this.drop(s); this.backClock = 0; }

  private drop(s: Strider) {
    this.pack!.remove(s);
    const b = this.bodies.get(s.id);
    if (b) { this.lab!.app.scene.remove(b.root); this.bodies.delete(s.id); }
  }
}
