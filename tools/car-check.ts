// Headless vehicle check: drive every raider kind (technical, gun truck, six-wheeler, war rig, tank) over the tall dunes and flat ground (straight, circles at full
// lock, slalom, brake to a stop, reverse) and fail on what breaks the illusion: NaN, grounded wheels off the ground,
// the body through the ground, speed past the top speed, yaw rate blowing up, too much time in the air.
// Run: npm test (or npx tsx tools/car-check.ts).
import { CarSim, carValues, type CarKind } from "../src/vehicles/car";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";

interface Run { name: string; seconds: number; cmd: (t: number, sim: CarSim) => [number, number] }

const runs: Run[] = [
  { name: "straight", seconds: 40, cmd: () => [1, 0] },
  { name: "circle left", seconds: 30, cmd: () => [1, 1] },
  { name: "circle right", seconds: 30, cmd: () => [1, -1] },
  { name: "tight circle", seconds: 20, cmd: (_t, sim) => [Math.max(-1, Math.min(1, (5 - sim.speed) * 0.5)), 1] },
  { name: "slalom", seconds: 40, cmd: (t) => [1, Math.sin(t * 1.6) > 0 ? 1 : -1] },
  { name: "brake to stop", seconds: 20, cmd: (t) => [t < 8 ? 1 : -1, 0] },
  { name: "reverse", seconds: 20, cmd: (t) => [t < 2 ? 0 : -1, t > 10 ? 0.6 : 0] },
];
/** Tracked kinds also turn on the spot with no throttle. */
const pivot: Run = { name: "pivot", seconds: 15, cmd: (t) => [0, t < 8 ? 1 : -1] };

const dt = 1 / 120;
let failed = false;
const kinds: CarKind[] = ["technical", "gunTruck", "sixWheeler", "warRig", "tank", "turretTruck", "partyBus"];
for (const kind of kinds) {
  const v = carValues(kind);
  for (const flat of [false, true]) {
    console.log(`-- ${kind} on ${flat ? "flat ground" : "tall dunes"}`);
    const terrain = { ...TERRAIN_DEFAULTS };
    if (flat) { terrain.height = 0; terrain.swell = 0; terrain.bumps = 0; }
    const field = new DuneField(terrain);
    for (const r of v.tracked ? [...runs, pivot] : runs) {
      const sim = new CarSim({ ...v }, field);
      sim.reset(13, -40, 0.3);
      const frames = Math.round(r.seconds / dt);
      let nan = 0, wheelOff = 0, maxWheelOff = 0, below = 0, overSpeed = 0, maxSpeed = 0, minSpeed = 0, air = 0, maxSlip = 0;
      let pivotTurn = 0;
      let yawRun = 0, yawBlow = 0, maxYaw = 0, radiusSum = 0, radiusN = 0, stopAt = -1, maxPitch = 0, maxRoll = 0, maxSlide = 0;
      for (let i = 0; i < frames; i++) {
        const [th, st] = r.cmd(i * dt, sim);
        sim.update(dt, th, st);
        const vals = [sim.pos.x, sim.pos.y, sim.pos.z, sim.heading, sim.speed, sim.yawRate, sim.pitch, sim.roll, sim.quat.w];
        if (vals.some((x) => !Number.isFinite(x))) { nan++; break; }
        for (const w of sim.wheels) {
          if (!Number.isFinite(w.pos.y) || !Number.isFinite(w.spin)) nan++;
          if (w.grounded) {
            const off = Math.abs(w.pos.y - field.height(w.pos.x, w.pos.z));
            maxWheelOff = Math.max(maxWheelOff, off);
            if (off > 0.15) wheelOff++;
          }
          maxSlip = Math.max(maxSlip, w.slip);
        }
        if (sim.pos.y < field.height(sim.pos.x, sim.pos.z)) below++;
        if (sim.speed > v.topSpeed * 1.1 || sim.speed < -v.reverseSpeed * 1.1) overSpeed++;
        maxSpeed = Math.max(maxSpeed, sim.speed);
        minSpeed = Math.min(minSpeed, sim.speed);
        if (sim.contacts === 0) air++;
        maxPitch = Math.max(maxPitch, Math.abs(sim.pitch));
        if (Math.abs(sim.speed) > 3) maxSlide = Math.max(maxSlide, Math.atan2(Math.abs(sim.lateral), Math.abs(sim.speed)));
        maxRoll = Math.max(maxRoll, Math.abs(sim.roll));
        maxYaw = Math.max(maxYaw, Math.abs(sim.yawRate));
        yawRun = Math.abs(sim.yawRate) > 3 ? yawRun + dt : 0;
        if (yawRun > 0.5) yawBlow++;
        // Turning circle: steady state late in the circle runs.
        if (r.name.includes("circle") && i * dt > r.seconds / 2 && Math.abs(sim.yawRate) > 0.05) {
          radiusSum += Math.hypot(sim.vel.x, sim.vel.z) / Math.abs(sim.yawRate); radiusN++;
        }
        if (r.name === "pivot" && i * dt < 8) pivotTurn += sim.yawRate * dt;
        if (r.name === "brake to stop" && i * dt > 8 && stopAt < 0 && Math.abs(sim.speed) < 0.05) stopAt = i * dt - 8;
      }
      const problems: string[] = [];
      const airPct = (air / frames) * 100;
      if (nan) problems.push("NaN");
      if (wheelOff) problems.push(`${wheelOff} grounded wheel-frames off the ground (max ${maxWheelOff.toFixed(2)} m)`);
      if (below) problems.push(`${below} frames with the body centre under the ground`);
      if (overSpeed) problems.push(`${overSpeed} frames past top speed + 10%`);
      if (yawBlow) problems.push(`yaw rate over 3 rad/s for over 0.5 s (${yawBlow} frames)`);
      if (!flat && airPct > 5) problems.push(`airborne ${airPct.toFixed(1)}% of frames`);
      if (flat && air > 0) problems.push(`airborne on flat ground (${air} frames)`);
      if (r.name === "brake to stop" && flat && stopAt < 0) problems.push("never stopped");
      if (r.name === "reverse" && minSpeed > -1) problems.push("never reversed");
      if (r.name === "pivot" && Math.abs(pivotTurn) < 1.5) problems.push(`hardly turned on the spot (${(pivotTurn * 57.3).toFixed(0)}° in 8 s)`);
      if (r.name === "pivot" && flat && Math.max(maxSpeed, -minSpeed) > 0.5) problems.push("crept while pivoting on flat ground");
      let extra = "";
      if (radiusN) extra += ` · turning circle r ${(radiusSum / radiusN).toFixed(1)} m`;
      if (r.name === "pivot") extra += ` · turned ${(pivotTurn * 57.3).toFixed(0)}° in 8 s`;
      if (r.name === "brake to stop") extra += ` · stop ${stopAt < 0 ? "-" : stopAt.toFixed(2) + " s"}`;
      const line = `${r.name.padEnd(14)} speed ${minSpeed.toFixed(1)}..${maxSpeed.toFixed(1)} m/s · max yaw ${maxYaw.toFixed(2)} rad/s · ` +
        `max slip ${maxSlip.toFixed(2)} · slide ${(maxSlide * 57.3).toFixed(0)}° · airborne ${airPct.toFixed(2)}% · pitch/roll max ${(maxPitch * 57.3).toFixed(0)}°/${(maxRoll * 57.3).toFixed(0)}° · ` +
        `wheel off ${maxWheelOff.toFixed(3)} m · moved ${Math.hypot(sim.pos.x - 13, sim.pos.z + 40).toFixed(0)} m${extra}`;
      console.log((problems.length ? "FAIL " : "ok   ") + line + (problems.length ? "\n       " + problems.join("; ") : ""));
      if (problems.length) failed = true;
    }
  }
}
if (failed) throw new Error("car check failed");
console.log("car check passed");
