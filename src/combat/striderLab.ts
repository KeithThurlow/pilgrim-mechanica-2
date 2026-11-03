// Striders in a combat lab (Keith 2026-11-01: "labs robots and lab strider should probably be the same lab"): the glue
// that was labs/strider, now mounted in the robots lab. Stands striders up round the player, resolves their events on
// the battlefield (beam, slam, grab and tear, footfalls, deaths as ragdolls), draws them and their attacks. Host for
// the damage; drawing cosmetic.
// Flags: ?strider=N (N up at once), ?strider=beam|slam|grab (one about to beam at 45 m, slam at 14 m, grab at 6 m; no
// robot packs), ?striderdist=m (where they stand up).
import type { Param } from "../core/tweaks";
import type { CombatLab, SelectEntry } from "../game/combatLab";
import { STRIDER_DEFAULTS, STRIDER_PARAMS, type Strider } from "./strider";
import { ROBOT_TEAR_DEFAULTS } from "./robotTearFx";
import { StriderField } from "./striderField";

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
export const STRIDER_TOPIC = { id: "striders", label: "Striders", groups: [GL, "Striders", "Striders: beam", "Striders: slam", "Striders: tearing", "Striders: death"] };

/** Make before the lab (its selector entry and buttons), attach() once the lab is up. */
export class StriderLab {
  sf: StriderField | null = null;
  get pack() { return this.sf?.pack ?? null; }
  readonly selectable: SelectEntry = { topic: "striders", label: "Striders", objects: () => (this.sf ? [...this.sf.bodies.values()].map((b) => b.root) : []) };
  readonly actions = [{ label: "Strider now", onClick: () => this.spawn() }, { label: "Striders stand up again", onClick: () => this.restart() }];
  /** True when a ?strider= scenario asked for no robot packs. */
  readonly scenario: string | null;
  private lab: CombatLab<StriderLabValues> | null = null;
  private spawnSeed = 1;
  private backClock = 0;

  constructor(private q = new URLSearchParams(location.search)) {
    const f = q.get("strider");
    this.scenario = f === "beam" || f === "slam" || f === "grab" ? f : null;
  }

  report() { const p = this.pack; return p ? { striders: p.alive, beams: p.beams, slams: p.slams, grabs: this.sf!.grabs, kills: p.kills } : {}; }

  attach<E extends StriderLabValues>(lab: CombatLab<E>) {
    const L = lab as unknown as CombatLab<StriderLabValues>;
    this.lab = L;
    const { V, bf, player, field } = L, q = this.q;
    const f = q.get("strider");
    if (f !== null && this.scenario === null) V.striderCount = Number(f) || 0;
    if (q.has("striderdist")) V.striderFrom = Number(q.get("striderdist")) || V.striderFrom;
    const sf = (this.sf = new StriderField(V, bf, L.app.scene, field, player, L.deaths, L.shake));
    sf.onDown = () => { this.backClock = V.striderBack; };
    const pack = sf.pack, target = sf.target;
    // Scenarios: one close by about to slam, one at 45 m about to beam, one in reach about to grab.
    if (this.scenario) V.striderCount = Math.max(1, V.striderCount);
    if (this.scenario === "slam") { const s = this.spawn(14, 0.6); s.slamClock = 0; }
    if (this.scenario === "grab") { const s = this.spawn(6, 0.3); s.meleeClock = 0; s.slamClock = 99; }
    if (this.scenario === "beam") { const s = this.spawn(45, -0.5); s.beamClock = 0.2; s.lockT = V.striderLockTime; }

    L.onFrame((dt) => {
      this.backClock -= dt;
      if (pack.list.length < V.striderCount && this.backClock <= 0) this.spawn();
      // The field runs on with nobody standing: the last one's core still counts down, its fx and tears settle
      // (Keith 2026-11-03: the blast waited for the next strider to stand up, 6 s on).
      const p0 = pack.list.length ? pack.list[0].pos() : L.player.sim.pos;
      sf.update(dt, L.prey(p0.x, p0.z));
      if (!pack.list.length) return;
      const s = pack.list[0];
      const mode = ["walking", "beam charging", "slam charging", "standing", "down", "grabbing"][s.mode] + (s.rushT > 0 ? " (rushing)" : "");
      L.hud("striders", `striders ${pack.alive} · ${mode} · ${Math.round(s.health)} hp · ${s.seen ? "sees you" : "seeking"} · beams ${pack.beams} · slams ${pack.slams} · grabs ${sf.grabs} (${Math.round(sf.grabDamage)} damage) · killed ${pack.kills} · hits body ${target.partHits[0]} leg ${target.partHits[1]} foot ${target.partHits[2]}`);
    });
  }

  /** Stand one up `dist` from the player (seeded direction unless given). */
  spawn(dist?: number, angle?: number): Strider {
    const L = this.lab!;
    const a = angle ?? ((this.spawnSeed++ * 2.39996) % (Math.PI * 2));
    const p = L.player.sim.pos, d = dist ?? L.V.striderFrom;
    const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
    return this.sf!.spawn(x, z, Math.atan2(p.x - x, p.z - z));
  }

  /** Every strider off the field; they stand up again by the count. */
  restart() { if (this.sf) for (const s of [...this.sf.pack.list]) this.sf.remove(s); this.backClock = 0; }
}
