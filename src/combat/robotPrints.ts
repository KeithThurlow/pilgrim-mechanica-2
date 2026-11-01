// Robot footfalls in the sand (Keith 2026-11-01: every leg prints its own foot): dust as before, and a print in the
// shape of the foot. The big walker's excavator bucket is baked from its model (three claw marks); the medium walkers'
// pipe legs end in a bare peg (a small round hole). Glue for every place a robot swarm walks (camps, the robots and
// stress labs). Cosmetic. Sliders: Ground dents (src/fx/dents.ts: printRobots, printBigDepth, printMidDepth).
import * as THREE from "three/webgpu";
import type { Battlefield } from "../game/battlefield";
import { BIG, type RobotSwarm } from "./robots";
import { BIG_SPEC } from "./robotLegs";
import { bucketGeometry } from "./robotShapes";
import { bakeDiscFoot, footShape, type FootShape } from "../fx/footprint";
import { bakeFootFromGeometry } from "../fx/footprintMesh";

let bucket: FootShape | null = null, peg: FootShape | null = null, baked = false;
/** The two robot feet, baked once on first use. The bucket in its own units (1: the foot's height). */
function shapes() {
  if (baked) return;
  baked = true;
  const g = bucketGeometry();
  bucket = footShape("robot-bucket") ?? bakeFootFromGeometry("robot-bucket", g, new THREE.Vector3(), 1);
  g.dispose();
  peg = footShape("robot-peg") ?? bakeDiscFoot("robot-peg", 0.6);
}

/** A swarm's footfall handler: dust, and the foot's print. */
export function robotFootfall(bf: Battlefield, sw: RobotSwarm) {
  return (i: number, x: number, y: number, z: number, leg: number) => {
    const v = bf.marks.v;
    const big = sw.kind[i] === BIG;
    bf.dust.stomp(x, y, z, big ? 0.5 : 0.12);
    if (v.printRobots < (big ? 1 : 2) || !bf.marks.denting || bf.inWater(x, z)) return;
    shapes();
    if (big) {
      // The bucket's claws point out along its leg's spoke (robotsDraw: the foot faces heading + the leg's angle).
      bf.marks.print(x, z, sw.heading[i] + BIG_SPEC.angles[leg], 1, bucket, BIG_SPEC.toe * sw.heightOf(i), v.printBigDepth);
    } else {
      // A peg about the pipe leg's width (robotsDraw: the shin's pipe is 0.055 × size across).
      bf.marks.print(x, z, sw.heading[i], 1, peg, sw.size[i] * 0.1, v.printMidDepth);
    }
  };
}
