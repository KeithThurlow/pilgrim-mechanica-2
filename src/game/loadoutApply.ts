// Put a resolved loadout (src/items/loadout.ts) onto a mech unit: its values go into the unit's tuning (legs change
// the walk, the hull the hull points and torso turn, the pack the dash), each gun gets its own values or is switched
// off when its side has none, and the model hides what isn't fitted. A gun whose values match the shared sliders
// runs on the sliders (so the default loadout leaves the mech exactly as it was, sliders live).
import type { GunStats } from "../mech/upper";
import type { Resolved } from "../items/loadout";
import type { MechUnit } from "./mechUnit";

const same = (g: GunStats, v: MechUnit["v"]) =>
  g.fireRate === v.fireRate && g.spinUp === v.spinUp && g.ammo === v.ammoPerGun && g.arc === v.podYawMax && g.track === v.podTrack &&
  g.damage === v.roundDamage && g.spread === v.spread && g.range === v.range && g.pierce === v.roundPierce;

export function applyLoadout(unit: MechUnit, r: Resolved) {
  Object.assign(unit.v, r.values);
  const [left, right] = unit.upper.guns;
  for (const [g, s] of [[left, r.guns.left], [right, r.guns.right]] as const) {
    g.enabled = !!s;
    g.stats = s && !same(s, unit.v) ? s : null;
    if (!s) { g.spin = 0; g.firing = false; }
  }
  unit.body.showParts?.({ gunLeft: !!r.guns.left, gunRight: !!r.guns.right, drums: r.parts.drums, pack: r.parts.pack });
  // Fitted at the bay: full drums, full hull, dash charges topped up to the new pack.
  unit.upper.resupply();
  if (unit.alive) unit.health = unit.maxHealth;
  unit.dash.charges = Math.round(unit.v.dashCharges);
}
