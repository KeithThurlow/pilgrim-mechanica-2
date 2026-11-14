// Gear comparison (src/items/compare.ts, Keith 2026-11-14): what the card says a fit does must be what fitting it
// actually does to the mech, soft limits counted (leg load, the reactor), and comparing must never change the loadout.
import { BASES } from "../src/items/bases";
import { makeItem } from "../src/items/generate";
import { SLOTS, defaultLoadout, fit, fitProblem, copyLoadout, resolve, type Loadout } from "../src/items/loadout";
import { fitWithHeld } from "../src/items/fitting";
import { compareFit, slotFor } from "../src/items/compare";

const problems: string[] = [];
const must = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); };
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

// ---- Keith's case: Stilt legs under a Siege hull. Stilt legs are the fastest bare, but over their best load. ----
{
  const lo = defaultLoadout();
  fit(lo, "legs", makeItem("legs-stilt")); fit(lo, "hull", makeItem("hull-siege"));
  const now = resolve(lo).values;
  must(resolve(lo).load.over > 0, "Stilt legs under a Siege hull aren't over their best load (the case to compare)");
  const out: string[] = [];
  for (const b of ["legs-siege", "legs-rampart"]) {
    const c = compareFit(lo, "legs", makeItem(b), [])!;
    const walk = c.lines.find((l) => l.key === "walkSpeed");
    const real = copyLoadout(lo); fit(real, "legs", makeItem(b));
    const after = resolve(real).values.walkSpeed;
    must(!!walk && near(walk.before!, now.walkSpeed) && near(walk.after!, after), `${b} for the Stilt legs: card says walk ${walk?.before} → ${walk?.after}, fitting gives ${now.walkSpeed} → ${after}`);
    must(c.warnings.some((w) => w.good && /under the legs' best load/.test(w.text)), `${b} under a Siege hull doesn't say it's back under the best load`);
    out.push(`${b} ${now.walkSpeed.toFixed(2)} → ${after.toFixed(2)} m/s`);
  }
  // And the other way: the Stilt legs onto a Siege hull say they go over.
  const heavy = defaultLoadout(); fit(heavy, "hull", makeItem("hull-siege"));
  const c = compareFit(heavy, "legs", makeItem("legs-stilt"), [])!;
  must(c.warnings.some((w) => !w.good && /Over the legs' best load/.test(w.text)), "Stilt legs onto a Siege hull don't warn about the load");
  console.log(`stilt legs under a siege hull: ${out.join(" · ")}`);
}

// ---- The reactor: a sunder beam onto a Salvager hull is underpowered; a capacitor bank then clears it. ----
{
  const lo = defaultLoadout(); fit(lo, "hull", makeItem("hull-salvager"));
  const c = compareFit(lo, "mountL", makeItem("sunder-medium"), [])!;
  must(!!c && c.warnings.some((w) => !w.good && /Underpowered/.test(w.text)), "a sunder beam onto a Salvager doesn't warn it's underpowered");
  fit(lo, "mountL", makeItem("sunder-medium"));
  const d = compareFit(lo, "shoulderR", makeItem("sh-capacitor"), [])!;
  must(!!d && d.warnings.some((w) => w.good && /No longer underpowered/.test(w.text)), "a capacitor bank onto an underpowered Salvager doesn't say it clears it");
}

// ---- Every base in every slot it fits: the card's numbers are the fitted mech's; the loadout is untouched. ----
{
  const snap = (lo: Loadout) => SLOTS.map((s) => lo[s]?.id ?? "-").join(",");
  let n = 0;
  for (const b of BASES) {
    const it = makeItem(b.id, "rare", "cand-" + b.id), lo = defaultLoadout(), was = snap(lo);
    const pool = [makeItem("mg-light", "rare", "pool-mg")];
    for (const s of SLOTS) {
      if (fitProblem(lo, s, it)) { must(compareFit(lo, s, it, pool) === null, `${b.id} in ${s}: compared though it doesn't fit`); continue; }
      const c = compareFit(lo, s, it, pool);
      must(!!c, `${b.id} in ${s}: no comparison`);
      must(snap(lo) === was, `${b.id} in ${s}: comparing changed the loadout`);
      if (!c) continue;
      const real = copyLoadout(lo); fitWithHeld(real, s, it, pool);
      const v = resolve(real).values as unknown as Record<string, number>;
      for (const l of c.lines) if (l.key in v && l.after !== null) must(near(l.after, v[l.key]), `${b.id} in ${s}: card ${l.key} ${l.after}, fitted ${v[l.key]}`);
      n++;
    }
    const s = slotFor(lo, it, null);
    must(s === null || !fitProblem(lo, s, it), `${b.id}: slotFor picked ${s}, where it doesn't fit`);
  }
  console.log(`compared ${n} base-slot fits against the fitted mech`);
}

if (problems.length) {
  console.error(`compare check: ${problems.length} problem(s)\n  ` + problems.slice(0, 20).join("\n  "));
  process.exit(1);
}
console.log("compare check: ok");
