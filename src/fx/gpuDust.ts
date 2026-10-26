// The dust on the GPU (scale step 5; the CPU sim is src/fx/dust.ts, kept behind the fxGpuDust slider). The same puffs
// and the same rules: clumps thrown low and settling, cloud blooming, rising and drifting on the wind, spray streaking;
// the dust sources (DustSim.stomp, kick, hit, wheel, smoke, emit) are unchanged and hand their puffs here when it's on.
// A GpuPool ring stepped by one compute pass; drawn by DustDraw with the CPU dust's own shader (src/fx/dustDraw.ts
// makes both), unsorted (one colour family, soft edges), and a shadow under each puff draped on the ground.
//
// Differences from the CPU dust: no back-to-front sort; no march toward the sun over the dunes per puff (the sun's
// shadow map, which the puffs already read per pixel, carries the dunes' shadows inside the shadow box); the floor is
// the detail patch's 1 m grid (src/fx/gpuGround.ts), else the ground where the puff was made.
//
// Buffers: P (position, age), V (velocity, life), A (start size, density, kind, seed), B (tint, drag, ground where made, 0).
import * as THREE from "three/webgpu";
import { float, uniform, If, exp, min, max, sin, cos, pow, select } from "three/tsl";
import { GpuPool, type PoolStep } from "./gpuPool";
import { groundAt, type GpuGroundSource } from "./gpuGround";
import { CLOUD, SPRAY, type DustValues } from "./dust";

type F = THREE.Node<"float">;

/** A puff's drawn radius and opacity from its state (shared by the step, the sprites and the shadows). */
export function puffLook(age: F, life: F, size0: F, dens: F, kind: F, uGrow: F): { radius: F; alpha: F } {
  const u = age.div(max(life, 1e-4));
  const isCloud = kind.sub(CLOUD).abs().lessThan(0.5), isSpray = kind.sub(SPRAY).abs().lessThan(0.5);
  const rCloud = size0.mul(float(1).add(uGrow.sub(1).mul(float(1).sub(exp(u.mul(-4))))));
  const rClump = size0.mul(float(1).add(u.mul(0.8)));
  const radius = select(isCloud, rCloud, select(isSpray, size0, rClump));
  const aCloud = dens.mul(min(1, u.mul(30))).mul(pow(max(float(1).sub(u), 0), 1.4));
  const aSpray = dens.mul(float(1).sub(u.mul(u)));
  const aClump = dens.mul(min(1, u.mul(20))).mul(float(1).sub(u.mul(u)));
  const alpha = select(age.lessThan(life), select(isCloud, aCloud, select(isSpray, aSpray, aClump)), float(0));
  return { radius, alpha };
}

export class GpuDust {
  readonly pool: GpuPool;
  readonly uWind = uniform(new THREE.Vector2());
  readonly uTurb = uniform(0.5);
  readonly uRise = uniform(0.35);
  readonly uGrow = uniform(3.5);
  readonly uWindIn = uniform(1.2);

  constructor(N: number, maxSpawn: number, readonly ground: GpuGroundSource) {
    // Descending: drawn newest first, oldest (risen, spread) last.
    this.pool = new GpuPool(N, maxSpawn, (s) => this.step(s), true);
  }

  private step(s: PoolStep) {
    const { P, V, A, B, dt, time } = s;
    P.w.assign(P.w.add(dt));
    If(P.w.lessThan(V.w), () => {
      const age = P.w, sd = A.w, kind = A.z, drag = B.y;
      const u = age.div(max(V.w, 1e-4));
      const r = float(0).toVar();
      If(kind.sub(CLOUD).abs().lessThan(0.5), () => {
        // First the throw slows under drag (still air), then the wind and a slow swirl take it; it rises and grows.
        const w = select(this.uWindIn.greaterThan(0), min(1, age.div(max(this.uWindIn, 1e-4))), float(1));
        const ws = w.mul(w).mul(float(3).sub(w.mul(2)));
        const k = min(1, dt.mul(drag));
        const tx = this.uWind.x.add(sin(time.mul(0.7).add(sd.mul(40))).mul(this.uTurb)).mul(ws);
        const tz = this.uWind.y.add(cos(time.mul(0.6).add(sd.mul(31))).mul(this.uTurb)).mul(ws);
        V.x.assign(V.x.add(tx.sub(V.x).mul(k)));
        V.z.assign(V.z.add(tz.sub(V.z).mul(k)));
        V.y.assign(V.y.add(this.uRise.mul(sd.mul(0.8).add(0.6)).sub(V.y).mul(k)));
        r.assign(A.x.mul(float(1).add(this.uGrow.sub(1).mul(float(1).sub(exp(u.mul(-4)))))));
      }).ElseIf(kind.sub(SPRAY).abs().lessThan(0.5), () => {
        // Spray: ballistic grains, full gravity, a little drag.
        const k = exp(dt.mul(drag).negate());
        V.x.assign(V.x.mul(k)); V.z.assign(V.z.mul(k)); V.y.assign(V.y.mul(k).sub(dt.mul(9.8)));
        r.assign(A.x);
      }).Else(() => {
        // Clumps: thrown, slowed hard, falling and settling on the sand.
        const k = exp(dt.mul(drag).negate());
        V.x.assign(V.x.mul(k)); V.z.assign(V.z.mul(k)); V.y.assign(V.y.sub(dt.mul(9.8 * 0.6)));
        r.assign(A.x.mul(float(1).add(u.mul(0.8))));
      });
      P.xyz.assign(P.xyz.add(V.xyz.mul(dt)));
      const g = groundAt(this.ground, P.x, P.z, B.z).x.add(r.mul(0.25));
      If(P.y.lessThan(g), () => {
        P.y.assign(g);
        V.y.assign(max(V.y, 0));
      });
    });
  }

  /** One puff, as DustSim.emit makes it (tint: surface darkness; drag: its drag; ground: the ground under it now). */
  emit(kind: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, dens: number,
    seed: number, tint: number, drag: number, ground: number): boolean {
    return this.pool.emit(x, y, z, 0, vx, vy, vz, life, size, dens, kind, seed, tint, drag, ground, 0, life);
  }

  update(renderer: THREE.WebGPURenderer, dt: number, v: DustValues) {
    const wa = (v.dustWindAngle * Math.PI) / 180;
    this.uWind.value.set(Math.sin(wa) * v.windSpeed, Math.cos(wa) * v.windSpeed);
    this.uTurb.value = v.turbulence; this.uRise.value = v.cloudRise; this.uGrow.value = v.cloudGrow; this.uWindIn.value = v.windIn;
    this.pool.update(renderer, dt);
  }
}
