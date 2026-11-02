// The rail must find moving trucks (Keith 2026-11-02: it hit dummies but rarely trucks over dunes): its sheet's rays
// must meet a truck with a clear line from the muzzle whatever dune it's on, aimed at its centre or a little off.
import * as THREE from "three";
import { WEAPON_DEFAULTS } from "../src/weapons/tuning";
import { railSheet } from "../src/weapons/rail";
import { makeSheet, sheetHits } from "../src/game/sheetFire";
import { RangeCar, RANGE_CAR_DEFAULTS } from "../src/game/rangeVehicles";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";

const V = { ...WEAPON_DEFAULTS } as any;
const flat: any = { height: () => 0, normal: (_x: number, _z: number, o = [0, 1, 0]) => { o[0] = 0; o[1] = 1; o[2] = 0; return o; } };
const dunes: any = new DuneField({ ...TERRAIN_DEFAULTS });
let bad = 0;
for (const [name, ground] of [["flat", flat], ["dunes", dunes]] as const) {
  for (const kind of ["technical", "truck"] as const) {
    for (const off of [0, 1.5]) {
      const car = new RangeCar(kind, ground, { ...RANGE_CAR_DEFAULTS } as any, 0);
      let clearN = 0, found = 0;
      for (let step = 0; step < 600; step++) {
        car.update(1 / 60);
        const p = car.sim.pos, aim = { x: p.x + off, y: p.y, z: p.z + off };
        const mz = new THREE.Vector3(0, ground.height(0, 0) + 4.5, 0);
        let clear = true;
        for (let t = 0; t <= 1; t += 0.01) if (ground.height(p.x * t, p.z * t) > mz.y + (p.y + 1 - mz.y) * t) { clear = false; break; }
        if (!clear) continue;
        const d = new THREE.Vector3(aim.x, 0, aim.z).normalize();
        const f = railSheet(V, { damage: 1000, charge: 1, cooldown: 1, range: 90, pen: V.railPen } as any, aim);
        clearN++;
        if (sheetHits([car], 1, makeSheet(ground, mz, d, 90, f, V), null).length) found++;
      }
      const share = found / Math.max(1, clearN);
      if (share < 0.99 || clearN < 100) { bad++; console.error(`FAIL ${name} ${kind} off ${off}: found ${found}/${clearN}`); }
    }
  }
}
if (bad) process.exit(1);
console.log("railtruck check passed");
