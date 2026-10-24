// Several ground modifiers on one dune field (the convoy's road and the POI pads), applied in order.
//
// DuneField takes one modifier: a weight toward a floor (the swell plus `lift`, with `rough` of the small bumps)
// plus a berm on top. Applying two of them one after the other folds back into that same form exactly:
//   h2 = lerp(lerp(h0, F1, w1) + b1, F2, w2) + b2
//      = lerp(h0, F, W) + B,  with W = 1 - (1-w1)(1-w2), B = (1-w2) b1 + b2,
//      and F's lift and roughness the weighted mean of the two ((1-w2) w1 for the first, w2 for the second).
// So the stack is itself a GroundModifier and DuneField needs no change: still a pure function of position.
import type { DuneField, GroundModifier, ModifierSample } from "./terrain";

export class ModifierStack implements GroundModifier {
  private s: ModifierSample = { w: 0, berm: 0, lift: 0, rough: 0 };

  constructor(readonly list: GroundModifier[] = []) {}

  at(x: number, z: number, out: ModifierSample): boolean {
    let any = false;
    let W = 0, B = 0, L = 0, R = 0; // L and R carry weight W (sums of lift and rough times their share)
    const s = this.s;
    for (const m of this.list) {
      if (!m.at(x, z, s)) continue;
      any = true;
      const k = 1 - s.w;
      // Earlier floors keep (1 - w) of their share; this one takes w.
      L = L * k + s.w * s.lift;
      R = R * k + s.w * s.rough;
      W = 1 - (1 - W) * k;
      B = B * k + s.berm;
    }
    if (!any) return false;
    out.w = W;
    out.berm = B;
    out.lift = W > 1e-9 ? L / W : 0;
    out.rough = W > 1e-9 ? R / W : 0;
    return true;
  }
}

/**
 * Add a modifier to a field without clobbering one already there: wraps the field's modifier and the new one in a
 * stack (or adds to the stack it already has). Applied in the order added.
 */
export function addModifier(field: DuneField, m: GroundModifier): ModifierStack {
  const cur = field.modifier;
  if (cur instanceof ModifierStack) { if (!cur.list.includes(m)) cur.list.push(m); return cur; }
  const stack = new ModifierStack(cur ? [cur, m] : [m]);
  field.modifier = stack;
  return stack;
}

/** Take a modifier back out of a field's stack (or the field). */
export function removeModifier(field: DuneField, m: GroundModifier) {
  const cur = field.modifier;
  if (cur === m) field.modifier = null;
  else if (cur instanceof ModifierStack) { const i = cur.list.indexOf(m); if (i >= 0) cur.list.splice(i, 1); }
}
