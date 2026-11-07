// Mechs carried on the convoy (Keith 2026-11-06: "show that the convoy is really transporting mechs"): Ramparts in
// the convoy's paint knelt on the motor pool's deck beside its tied-down vehicle, at the slots furniture.ts lays out.
// Each one a walker sim held in the parked kneel (hold.ts) on its platform every frame, so it rides the deck's heave,
// pitch and roll; nothing else is simulated (no guns, no health). Bodies load in the background, one at a time.
// Ownership: cosmetic (each peer poses its own from the platform it already agrees on).
import type * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import { WalkerSim } from "../mech/walker";
import { UpperSim } from "../mech/upper";
import type { WalkerValues } from "../mech/walkerTuning";
import type { UpperValues } from "../mech/upper";
import type { RampartBody } from "../mech/rampart";
import type { ToonLook } from "../look/toon";
import type { Ground } from "../mech/walker";
import { kneelPose, type Kneel } from "./hold";
import type { Convoy } from "./platform";
import { furniture } from "./furniture";
import { FRIENDLY, CULL_MARGIN } from "./platformBody";
import type { ViewCull } from "../core/viewCull";

export const DECK_MECH_DEFAULTS = { deckMechsOn: 1, deckMechCrouch: 1.1, deckMechPitch: 8 };
export type DeckMechValues = typeof DECK_MECH_DEFAULTS;
const G = "Mechs aboard";
export const DECK_MECH_PARAMS: Param[] = [
  { key: "deckMechsOn", label: "Mechs aboard", min: 0, max: 1, step: 1, group: G, tip: "Ramparts knelt on the motor pool's deck beside its vehicle" },
  { key: "deckMechCrouch", label: "Kneel (m)", min: 0, max: 1.6, step: 0.05, group: G, tip: "How far their hips sit down" },
  { key: "deckMechPitch", label: "Nose down (°)", min: 0, max: 20, step: 0.5, group: G },
];
export const DECK_MECH_GROUPS = [G];

interface Aboard { pi: number; kneel: Kneel; sim: WalkerSim; upper: UpperSim; body: RampartBody | null }

export class DeckMechs {
  private list: Aboard[] = [];
  private loading = false;

  constructor(private convoy: Convoy, readonly v: DeckMechValues & WalkerValues & UpperValues, ground: Ground,
    private scene: THREE.Scene, private look: ToonLook, private load: () => Promise<RampartBody>) {
    convoy.platforms.forEach((p, pi) => {
      for (const s of furniture(p.spec, p.deck).mechs) {
        const sim = new WalkerSim(v, ground), upper = new UpperSim(v);
        upper.reset(p.heading + s.heading);
        this.list.push({ pi, sim, upper, body: null, kneel: { x: s.x, z: s.z, relHeading: s.heading, k: 1, crouch: 0, pitch: 0, from: null } });
      }
    });
  }

  /** Their bodies, for hold-V. */
  objects(): THREE.Object3D[] { return this.list.flatMap((a) => (a.body ? [a.body.root] : [])); }

  private async add(a: Aboard) {
    this.loading = true;
    try {
      const body = await this.load();
      body.paint(this.look, FRIENDLY);
      this.scene.add(body.root);
      a.body = body;
    } catch (e) { console.warn("deck mech body not loaded:", e); this.v.deckMechsOn = 0; }
    this.loading = false;
  }

  /** With a view (perf 2026-11-07): mechs on a car well off the screen aren't posed (it is all from the deck, nothing
   *  carried over, so they're right again the frame they come back). */
  update(view?: ViewCull) {
    const on = this.v.deckMechsOn > 0;
    for (const a of this.list) {
      if (!a.body) { if (on && !this.loading) void this.add(a); continue; }
      a.body.root.visible = on;
      if (!on) continue;
      const p = this.convoy.platforms[a.pi];
      if (view && !view.sees(p.x, p.y, p.z, p.spec.length / 2 + CULL_MARGIN)) continue;
      a.kneel.crouch = this.v.deckMechCrouch; a.kneel.pitch = this.v.deckMechPitch;
      kneelPose(a.sim, p, a.kneel);
      a.upper.torsoYaw = p.heading + a.kneel.relHeading;
      a.body.update(a.sim, a.upper);
    }
  }
}
