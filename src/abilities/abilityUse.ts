// Glue for abilities in a lab: keys 3 and 4 pressed while driving send the useAbility command (aimed at the cursor),
// the heal zones step over the player's mech, the pilot on foot and any allies the lab adds, and the zones draw. A
// sound as a zone opens. Builds the HUD's ability slots.
import * as THREE from "three/webgpu";
import type { MechUnit } from "../game/mechUnit";
import type { OnFoot } from "../pilot/onFoot";
import type { Sfx } from "../audio/sfx";
import { Synth, rng } from "../audio/synth";
import { HealZones, type HealTarget } from "./zones";
import { ZonesDraw } from "./zonesDraw";
import { ABILITY_NAMES } from "./abilities";

export class AbilityControl {
  readonly zones: HealZones;
  readonly draw: ZonesDraw;
  /** Other friendly mechs zones can heal (co-op allies; the repair lab's parked friend). */
  readonly allies: MechUnit[] = [];
  private was = [false, false];
  private at = new THREE.Vector3();
  private pilot: HealTarget;

  constructor(private player: MechUnit, private foot: OnFoot, scene: THREE.Scene, height: (x: number, z: number) => number, private sfx: Sfx | null) {
    this.zones = new HealZones(player.v);
    this.draw = new ZonesDraw(this.zones, height);
    scene.add(this.draw.group);
    const f = foot, team = player.team;
    this.pilot = {
      id: "pilot", team,
      get x() { return f.sim.pos.x; }, get z() { return f.sim.pos.z; },
      get alive() { return f.sim.alive && f.mount.onFoot; }, get max() { return f.sim.v.pilotHealth; },
      heal: (n) => { const add = Math.max(0, Math.min(n, f.sim.v.pilotHealth - f.sim.health)); f.sim.health += add; return add; },
    };
    if (sfx) {
      const S = new Synth(sfx.rate);
      sfx.addSound("zoneOpen", [S.mix(S.whine(0.9, 300, 1200, 0.12), S.noise(rng(81), 0.7, 3000, 0.25, 0.05), S.thump(0.15, 140, 70, 0.4))], () => player.v.kitSound);
    }
  }

  /** k3, k4: keys 3 and 4 down; demo: the lab's demo is driving. */
  update(dt: number, k3: boolean, k4: boolean, demo: boolean) {
    const p = this.player, keys = [k3, k4];
    for (let i = 0; i < 2; i++) {
      const pressed = keys[i] && !this.was[i];
      this.was[i] = keys[i];
      if (!pressed || demo || !this.foot.driving) continue;
      const c = p.cursor ?? p.sim.pelvis;
      p.abilities.use(i + 3, { id: p.uid, team: p.team, x: p.sim.pelvis.x, z: p.sim.pelvis.z, alive: p.alive }, c.x, c.z, this.zones);
    }
    const targets: HealTarget[] = [p.healTarget(), this.pilot, ...this.allies.map((a) => a.healTarget())];
    this.zones.step(dt, targets);
    for (const e of this.zones.events) {
      if (e.kind !== "zoneOpened" || !this.sfx) continue;
      const z = this.zones.zones.find((q) => q.id === e.zone);
      if (z) this.sfx.playSound("zoneOpen", this.at.set(z.x, p.sim.pelvis.y, z.z), 1);
    }
    this.zones.events.length = 0;
    this.draw.update(dt);
  }

  /** The HUD's ability slots. */
  view() {
    const a = this.player.abilities;
    return a.slots.map((s) => ({ key: String(s.key), name: ABILITY_NAMES[s.id], ready: a.ready(s), active: s.id === "weld" ? a.braced > 0 : this.zones.zones.some((z) => z.kind === s.id && z.owner === this.player.uid) }));
  }

  /** Being healed right now (the HUD's bar glows). */
  healing(id: string) { return (this.zones.lastHeal.get(id) ?? 0) > 0; }
}
