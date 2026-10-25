// Code stand-ins for projectiles still to be modelled (docs/asset-list.md): the missile (W4's missile.glb).
// The rocket (rocket.glb) is the desktop agent's (W1); the mortar shell is in mortar.ts.
import { Build, v, Z } from "../kit";
import { rocket } from "./common";
import type { ModelDef } from "../parts";

/** The missile projectile (missile.glb stand-in): slimmer than the rocket, a pointed nose, four fins. */
export function missileProjectile(): ModelDef {
  const B = new Build(4, 0.6), P = B.piece("Body");
  rocket(P, v(), 0.06, 0.7, { bulb: 1.0, n: 6, fuze: false, warhead: "secondary", band: "trim" });
  B.socket("Glow_0", v(0, 0, -0.02), Z().negate());
  return B.def();
}
