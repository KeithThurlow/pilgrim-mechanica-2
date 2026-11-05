// Round guns (src/weapons/guns.ts; Keith 2026-11-02): the SMG, battle rifle and scattergun in a hand, the longshot rifle
// and flak cannon on the hull. Must hold: each quick pick resolves to its class, size and pellets; the first round
// leaves on the click (no spin-up, even for the sniper's slow cycle); held, they fire at their rate until the magazine
// runs dry; the card's DPS counts every pellet. The breach cannon (src/weapons/cannon.ts) likewise.
import { UpperSim, UPPER_DEFAULTS } from "../src/mech/upper";
import { loadoutFor, type Pick } from "../src/items/weaponPick";
import { resolve } from "../src/items/loadout";
import { makeItem } from "../src/items/generate";
import { itemCadence, dpsOf } from "../src/items/dps";
import { CANNON_DEFAULTS as GUN_DEFAULTS_C } from "../src/weapons/cannon";
import { ROUND_GUNS, gunNumbers, type RoundGun } from "../src/weapons/guns";
import { WEAPON_DEFAULTS as GUN_DEFAULTS } from "../src/weapons/tuning";

const fails: string[] = [];
const must = (ok: boolean, msg: string) => { if (!ok) fails.push(msg); };
const out: string[] = [];

const HELD: RoundGun[] = ["smg", "rifle", "shotgun", "flamer", "frost"], HULL: RoundGun[] = ["sniper", "flak", "inferno", "cryo"];
const BASE: Record<RoundGun, string> = { smg: "smg-light", rifle: "rifle-light", shotgun: "shotgun-light", sniper: "sniper-medium", flak: "flak-medium", flamer: "flamer-light", inferno: "inferno-medium", frost: "frost-light", cryo: "cryo-medium" };

for (const kind of ROUND_GUNS) {
  const pick: Pick = { left: kind, right: "minigun", k1: "none", k2: "none", k3: "pack" };
  const r = resolve(loadoutFor(pick));
  const g = r.guns.left;
  const n = gunNumbers(kind, GUN_DEFAULTS);
  must(g?.cls === kind, `?left=${kind} didn't resolve to a ${kind} (got ${g?.cls})`);
  if (!g) continue;
  must(!!g.light === HELD.includes(kind), `${kind}: light should be ${HELD.includes(kind)}`);
  must(r.parts.mountL === (HULL.includes(kind) ? "gun" : "arm"), `${kind}: wrong mount (${r.parts.mountL})`);
  must((g.pellets ?? 1) === n.pellets, `${kind}: ${g.pellets} pellets, sliders say ${n.pellets}`);
  must(r.guns.right?.cls === undefined, "the right minigun changed");

  // Fire it in the gun sim: aim dead ahead, trigger held on the left for 6 s.
  const sim = new UpperSim({ ...UPPER_DEFAULTS });
  sim.guns[0].stats = g; sim.guns[1].enabled = false;
  sim.resupply();
  const dt = 1 / 120, shoulder = { x: 0, y: 4.3, z: 0 }, aim = { x: 0, y: 0, z: 25 };
  // Settle on target without the trigger, then press.
  for (let i = 0; i < 240; i++) sim.update(dt, 0, shoulder, aim, [false, false]);
  let first = -1, count = 0;
  for (let i = 0; i < 720; i++) for (const s of sim.update(dt, 0, shoulder, aim, [true, false])) { if (s !== 1) continue; if (first < 0) first = i * dt; count++; }
  // Expected over 6 s: the magazine, a reload, then more at the rate.
  const cyc = n.magazine / n.fireRate + n.reload, full = Math.floor(6 / cyc);
  const left = 6 - full * cyc, expect = full * n.magazine + Math.min(n.magazine, Math.floor(left * n.fireRate) + 1);
  must(first >= 0 && first <= 0.02, `${kind}: first round ${first.toFixed(3)} s after the click (should be on it)`);
  must(Math.abs(count - expect) <= Math.max(2, expect * 0.1), `${kind}: ${count} shots in 6 s, expected about ${expect}`);

  // The card's DPS: damage × pellets × sustained rate.
  const cad = itemCadence(makeItem(BASE[kind]), false)!;
  must(cad.rounds === n.pellets, `${kind}: the card counts ${cad.rounds} rounds a shot, not ${n.pellets}`);
  out.push(`${kind} ${first.toFixed(3)}s ${count} shots ${Math.round(dpsOf(cad))} dps`);
}

// The breach cannon (src/weapons/cannon.ts): a hull weapon on the gun's clock whose first shell leaves on the click, and
// whose card DPS is its direct damage × sustained shells/s.
{
  const r = resolve(loadoutFor({ left: "cannon", right: "minigun", k1: "none", k2: "none", k3: "pack" }));
  const g = r.guns.left;
  must(g?.cls === "cannon" && !g.light && r.parts.mountL === "gun", "?left=cannon didn't resolve to a hull breach cannon");
  if (g) {
    const sim = new UpperSim({ ...UPPER_DEFAULTS });
    sim.guns[0].stats = g; sim.guns[1].enabled = false;
    sim.resupply();
    const dt = 1 / 120, shoulder = { x: 0, y: 4.3, z: 0 }, aim = { x: 0, y: 0, z: 25 };
    for (let i = 0; i < 240; i++) sim.update(dt, 0, shoulder, aim, [false, false]);
    let first = -1, count = 0;
    for (let i = 0; i < 720; i++) for (const s of sim.update(dt, 0, shoulder, aim, [true, false])) { if (s !== 1) continue; if (first < 0) first = i * dt; count++; }
    const expect = Math.min(GUN_DEFAULTS_C.cannonMag, Math.ceil(6 * GUN_DEFAULTS_C.cannonRate));
    must(first >= 0 && first <= 0.02, `cannon: first shell ${first.toFixed(3)} s after the click`);
    must(Math.abs(count - expect) <= 1, `cannon: ${count} shells in 6 s, expected about ${expect}`);
    const cad = itemCadence(makeItem("cannon-medium"), false)!;
    must(cad.rounds === 1 && Math.abs(cad.rate - GUN_DEFAULTS_C.cannonRate) < 1e-6, "cannon: the card's cadence is off");
    out.push(`cannon ${first.toFixed(3)}s ${count} shells ${Math.round(dpsOf(cad))} dps`);
  }
}

console.log("guns: " + out.join(" · "));
if (fails.length) { console.log("FAIL\n  " + fails.join("\n  ")); process.exit(1); }
console.log("guns check passed");
