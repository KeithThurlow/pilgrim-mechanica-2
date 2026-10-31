// A fortress's warlord (Keith 2026-10-31, docs/proposal-fortresses.md; Claude's default for the open question "what is
// the boss": a heavier red Rampart, the war band's bandit mech made tougher). It stands in the keep beside the vault,
// asleep until the keep's yard is alerted, then fights from inside the keep: holds off at range, strafes, keeps its
// guns on the mech when it can see it, never leaves the keep (a leash back to the vault). Killed, it drops a few
// guaranteed items and stays dead for the expedition.
//
// One MechUnit is reused for whichever fortress is streamed in (only one keep is ever near). Ownership: host (its
// health, its death, the drops); the body is cosmetic.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Battlefield } from "../game/battlefield";
import type { MechUnit } from "../game/mechUnit";
import type { Register } from "../game/register";
import { putMech } from "../game/registerOwners";
import { ObjectSerials } from "../game/register";

export const WARLORD_DEFAULTS = { warlordHull: 4500, warlordArmour: 9, warlordDamage: 1.3, warlordRange: 30, warlordDrops: 3, warlordLeash: 0.7 };
export type WarlordValues = typeof WARLORD_DEFAULTS;
const G = "Fortress: warlord";
export const WARLORD_PARAMS: Param[] = [
  { key: "warlordHull", label: "Hit points", min: 100, max: 30000, step: 50, group: G, tip: "A bandit mech has 1800" },
  { key: "warlordArmour", label: "Armour (flat per hit)", min: 0, max: 40, step: 0.5, group: G },
  { key: "warlordDamage", label: "Damage ×", min: 0, max: 4, step: 0.05, group: G, tip: "Its miniguns' rounds against yours" },
  { key: "warlordRange", label: "Holds off at (m)", min: 6, max: 60, step: 1, group: G },
  { key: "warlordDrops", label: "Items it drops", min: 0, max: 10, step: 1, group: G },
  { key: "warlordLeash", label: "Stays within (share of the keep)", min: 0.1, max: 1, step: 0.05, group: G, tip: "How far from the vault it walks, as a share of the keep's inner radius" },
];

export type WarlordEvent = { type: "warlordUp"; poi: string } | { type: "warlordDown"; poi: string; x: number; y: number; z: number };

export class Warlord {
  /** The fortress it guards now, or null (off the field). */
  poi: string | null = null;
  awake = false;
  private home = { x: 0, z: 0, r: 10 };
  private dead = new Set<string>();
  private kept = new Map<string, number>();
  private clock = 0;
  private serials = new ObjectSerials();
  private onField = false;
  private tgt = new THREE.Vector3();
  readonly name = "warlord";
  onEvent: ((e: WarlordEvent) => void) | null = null;

  constructor(public v: WarlordValues, private bf: Battlefield, private scene: THREE.Object3D, readonly unit: MechUnit | null) {}

  /** Dead for this expedition? */
  isDead(poi: string) { return this.dead.has(poi); }

  /** Forget everything (a new expedition). */
  reset() { this.leave(); this.dead.clear(); this.kept.clear(); }

  /** Stand it in a keep (centre and inner radius): asleep beside the vault. */
  place(poi: string, x: number, z: number, keepR: number, heading: number) {
    const m = this.unit;
    if (!m || this.dead.has(poi) || this.poi === poi) return;
    this.leave();
    this.poi = poi;
    this.awake = false;
    this.home = { x, z, r: Math.max(3, keepR * this.v.warlordLeash) };
    m.hullOverride = this.v.warlordHull;
    m.armourOverride = this.v.warlordArmour;
    m.damageScale = this.v.warlordDamage;
    m.reset(x + Math.sin(heading) * 6, z + Math.cos(heading) * 6, heading);
    const hp = this.kept.get(poi);
    if (hp !== undefined) m.health = hp;
    if (!this.onField) { this.bf.targets.push(m); this.scene.add(m.body.root); this.onField = true; }
    this.onEvent?.({ type: "warlordUp", poi });
  }

  /** Off the field (its fortress streamed out), keeping its health. */
  leave() {
    const m = this.unit;
    if (!m || !this.onField) { this.poi = null; return; }
    if (this.poi && m.alive) this.kept.set(this.poi, m.health);
    const k = this.bf.targets.indexOf(m);
    if (k >= 0) this.bf.targets.splice(k, 1);
    this.scene.remove(m.body.root);
    this.onField = false;
    this.poi = null;
  }

  /** Into the register (the soft lock and the weapons see it). */
  publish(reg: Register) { const m = this.unit; if (m && this.onField && m.alive) putMech(reg, m, 0, this.serials.serial(m, reg)); }

  /** One step: target is the mech (or the pilot); fight when awake and hunting, else stand by the vault. */
  update(dt: number, target: { x: number; y: number; z: number; alive: boolean }, fight: boolean) {
    const m = this.unit;
    if (!m || !this.onField || !this.poi) return;
    if (!m.alive) {
      m.step(dt, { x: 0, z: 0, sprint: false }, null, false);
      if (!this.dead.has(this.poi)) {
        this.dead.add(this.poi);
        const p = m.sim.pos;
        this.onEvent?.({ type: "warlordDown", poi: this.poi, x: p.x, y: p.y, z: p.z });
      }
      return;
    }
    if (fight) this.awake = true;
    const p = m.sim.pos;
    const hx = this.home.x - p.x, hz = this.home.z - p.z, hd = Math.hypot(hx, hz);
    if (!this.awake || !fight || !target.alive) {
      // Back to the vault and stand.
      const go = hd > 3 ? { x: hx / hd, z: hz / hd } : { x: 0, z: 0 };
      m.step(dt, { x: go.x * 0.6, z: go.z * 0.6, sprint: false }, null, false);
      return;
    }
    const dx = target.x - p.x, dz = target.z - p.z, dist = Math.hypot(dx, dz) || 1;
    const ux = dx / dist, uz = dz / dist;
    const close = Math.max(-1, Math.min(1, (dist - this.v.warlordRange) / 8));
    this.clock += dt;
    const strafe = Math.sin(this.clock * 0.5) > 0 ? 0.6 : -0.6;
    let x = ux * close - uz * strafe, z = uz * close + ux * strafe;
    // The leash: past it, the pull home wins.
    const over = (hd - this.home.r) / 4;
    if (over > 0) { const k = Math.min(1, over); x = x * (1 - k) + (hx / hd) * k; z = z * (1 - k) + (hz / hd) * k; }
    const l = Math.hypot(x, z); if (l > 1) { x /= l; z /= l; }
    const sees = this.bf.canSee(m.sim.pelvis, this.tgt.set(target.x, target.y, target.z));
    m.step(dt, { x, z, sprint: false }, { x: target.x, y: target.y, z: target.z }, sees && dist < m.v.range + 4);
  }
}
