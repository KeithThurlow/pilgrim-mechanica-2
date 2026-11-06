// Bandit mechs in a fortress (Keith 2026-11-06: "the mech at the center of the fortress is sort of unbeatable... adhere
// to our duel rules... the outer ring starts out with swarms of bandits and maybe one mech, and the next ring has swarms
// of bandits and second mech... at the center one strong mech with a couple of weaker mechs on either side").
// Every one is a field rival (src/game/fieldRival.ts): the duel lab's brain on a rolled loadout, so the duel's rules
// hold. Its items roll relative to the player's own level and its brain is a rival level (Recruit, Veteran), which is
// what keeps it beatable. Escalating inward: one Recruit in the outer yard a level below the player, one in the middle
// yard at the player's level, and in the keep the warlord (Veteran, items at the player's level, hull ×1.3) with two
// Recruit flankers a level below.
// `fortMechPosts` (fortMechPosts.ts) is pure: where each stands, what it is, from the layout. FortMechs is the glue: it puts them down
// for the nearest live fortress, wakes each with its yard, and keeps who died and what health was left per fortress.
// Host owned (rule 12): their health, deaths, loadouts and brains.
import type * as THREE from "three/webgpu";
import type { Battlefield } from "../game/battlefield";
import type { MechUnit } from "../game/mechUnit";
import { FieldRival, type FieldRivalValues, type RivalSetup } from "../game/fieldRival";
import type { Layout } from "../pois/fortress";
import { FORT_MECH_PAINT, WARLORD_PAINT, fortMechPosts, type FortMechPost, type FortMechRole, type FortMechValues } from "./fortMechPosts";

export { FORT_MECH_DEFAULTS, FORT_MECH_PARAMS, fortMechPosts } from "./fortMechPosts";

export type FortMechEvent = { type: "fortMechDown"; poi: string; id: string; role: FortMechRole; yard: number; x: number; y: number; z: number };

interface Slot { rival: FieldRival; post: FortMechPost | null; pending: boolean; hp: number }

/** What the fortresses tell their mechs each frame about one live fortress. */
export interface FortForMechs { poi: string; L: Layout; seed: number; alert: (yard: number) => boolean; alarm: (yard: number) => void }

export class FortMechs {
  setup: RivalSetup | null = null;
  onEvent: ((e: FortMechEvent) => void) | null = null;
  /** The fortress whose mechs are down on the field now. */
  poi: string | null = null;
  private slots: Slot[] = [];
  private dead = new Set<string>();
  private kept = new Map<string, number>();

  constructor(private v: FortMechValues & FieldRivalValues, private bf: Battlefield, private scene: THREE.Scene, private player: MechUnit) {}

  /** Every mech on the field (alive or a wreck), for the register and the turrets. */
  list(): MechUnit[] { const o: MechUnit[] = []; for (const s of this.slots) if (s.post && s.rival.placed && s.rival.unit) o.push(s.rival.unit); return o; }
  /** Alive ones with their posts (HUD, labs). */
  live(): { post: FortMechPost; unit: MechUnit }[] { const o: { post: FortMechPost; unit: MechUnit }[] = []; for (const s of this.slots) if (s.post && s.rival.alive) o.push({ post: s.post, unit: s.rival.unit! }); return o; }
  isDead(id: string) { return this.dead.has(id); }
  /** Their meshes (hold-V). */
  objects(): THREE.Object3D[] { return this.slots.flatMap((s) => (s.post ? s.rival.objects() : [])); }

  /** Forget everything (a new expedition, or the lab's put-it-back). */
  reset() { this.leave(); this.dead.clear(); this.kept.clear(); }

  /** Off the field, keeping who's dead and the health left. */
  leave() {
    for (const s of this.slots) {
      if (!s.post) continue;
      if (s.rival.alive) this.kept.set(s.post.id, s.rival.unit!.health);
      s.rival.despawn();
      s.post = null;
    }
    this.poi = null;
  }

  /** One frame: `fort` the nearest live fortress (null: none), `hunting` the expedition's say. */
  update(dt: number, fort: FortForMechs | null, hunting: boolean) {
    if (!this.setup) return;
    if (!fort) { if (this.poi) this.leave(); return; }
    if (this.poi !== fort.poi) { this.leave(); this.place(fort); }
    const P = this.player.sim.pelvis;
    for (const s of this.slots) {
      const post = s.post;
      if (!post || s.pending || !s.rival.placed) continue;
      const u = s.rival.unit!;
      if (u.alive && u.health < s.hp - 1e-3) fort.alarm(post.yard);
      s.hp = u.health;
      const fight = hunting && fort.alert(post.yard) && Math.hypot(u.sim.pelvis.x - P.x, u.sim.pelvis.z - P.z) < this.v.fortMechWake;
      s.rival.step(dt, fight);
      s.rival.stepSummons(dt);
      if (s.rival.died) {
        s.rival.died = false;
        this.dead.add(post.id);
        const p = u.sim.pelvis;
        this.onEvent?.({ type: "fortMechDown", poi: fort.poi, id: post.id, role: post.role, yard: post.yard, x: p.x, y: p.y, z: p.z });
      }
    }
  }

  private place(fort: FortForMechs) {
    this.poi = fort.poi;
    const posts = fortMechPosts(fort.L, this.v, fort.seed).filter((p) => !this.dead.has(p.id));
    const lvl = Math.max(1, Math.round(this.setup?.playerLevel?.() ?? 1));
    while (this.slots.length < posts.length) {
      const rival = new FieldRival(this.bf, this.scene, this.v, this.player);
      rival.setup = this.setup;
      this.slots.push({ rival, post: null, pending: false, hp: 0 });
    }
    posts.forEach((post, n) => {
      const s = this.slots[n];
      s.post = post;
      s.pending = true;
      void s.rival.put({ seed: post.seed, x: post.x, z: post.z, face: post.face, level: lvl + Math.round(post.up), arena: post.arena, hull: post.hull, ai: post.ai,
        paint: post.role === "boss" ? WARLORD_PAINT : FORT_MECH_PAINT }).then((ok) => {
        if (s.post !== post) { if (ok && !s.post) s.rival.despawn(); return; }   // streamed out while its body loaded (a newer put owns it if any)
        s.pending = false;
        if (!ok) { s.post = null; return; }
        const hp = this.kept.get(post.id);
        if (hp !== undefined) s.rival.unit!.health = hp;
        s.hp = s.rival.unit!.health;
      });
    });
  }
}
