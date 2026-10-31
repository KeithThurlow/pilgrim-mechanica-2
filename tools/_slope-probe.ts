import { WalkerSim } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
const gz = -0.65;
const plane = { height: (_x: number, z: number) => gz * z, normal: (_x: number, _z: number, o: number[] = [0, 0, 0]) => { const l = Math.hypot(1, gz); o[0] = 0; o[1] = 1 / l; o[2] = -gz / l; return o; } };
const sim = new WalkerSim({ ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values }, plane as never);
sim.reset(0, 0, 0);
for (let i = 0; i < 120 * 6; i++) {
  sim.update(1 / 120, { x: 0, z: 1, sprint: false });
  if (i % 30 === 0) console.log((i / 120).toFixed(2), sim.speed.toFixed(2), sim.vel.z.toFixed(2), sim.skid.z.toFixed(2), sim.airborne, sim.feet.map((f) => (f.hang ? "H" : f.swinging ? "s" : "p")).join(""));
}
