// Draws the reactor novas (src/fx/nova.ts). Cosmetic. A slot per live nova (at most 8), each four meshes, hidden when
// idle: the flash (a white-hot ball), the shell (a fireball sphere lit at its silhouette: a fresnel rim, clear in the
// middle so the wreck shows through), the shockwave (a flat disc at the hull's height whose edge is a thin bright ring)
// and a soft ring on the sand. Additive, no depth writes.
import * as THREE from "three/webgpu";
import { abs, dot, float, length, normalize, normalView, positionGeometry, positionView, pow, smoothstep, uniform } from "three/tsl";
import { Novas, type Nova } from "./nova";
import { SoftRing } from "../weapons/ribbon";
import { NovaDebrisDraw } from "./novaDebrisDraw";

interface Ground { height(x: number, z: number): number }

const HOT = 0xf2f8ff, FIRE = 0xff9a3a, RING = 0xa8d8ff, DUST = 0xffc070;

interface Slot {
  flash: THREE.Mesh; shell: THREE.Mesh; wave: THREE.Mesh; ground: SoftRing;
  uFlash: ReturnType<typeof uniform>; uShell: ReturnType<typeof uniform>; uWave: ReturnType<typeof uniform>; uSharp: ReturnType<typeof uniform>;
}

const easeOut = (u: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 3);

export class NovaDraw {
  readonly group = new THREE.Group();
  private slots: Slot[] = [];
  private ball = new THREE.SphereGeometry(1, 24, 16);
  private disc = new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2);

  /** The hull shattering: shards and sparks (src/fx/novaDebris.ts). */
  private debris: NovaDebrisDraw;

  constructor(private novas: Novas, private ground: Ground) {
    this.debris = new NovaDebrisDraw(novas.debris);
    this.group.add(this.debris.group);
  }

  private make(): Slot {
    const add = (m: THREE.Material, g: THREE.BufferGeometry) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 5;
      this.group.add(mesh);
      return mesh;
    };
    const mat = (color: number) => new THREE.MeshBasicNodeMaterial({ color, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const uFlash = uniform(0), uShell = uniform(0), uWave = uniform(0), uSharp = uniform(14);
    const fm = mat(HOT); fm.opacityNode = uFlash;
    // The shell: bright where the surface turns away from the eye, clear through its middle.
    const sm = mat(FIRE);
    sm.side = THREE.FrontSide;
    const rim = float(1).sub(abs(dot(normalView, normalize(positionView.negate()))));
    sm.opacityNode = pow(rim, 2.2).mul(uShell);
    // The shockwave: the disc's edge, sharp, with a faint glow inward.
    const wm = mat(RING);
    const r = length(positionGeometry.xz);
    wm.opacityNode = pow(r, uSharp).mul(float(1).sub(smoothstep(0.97, 1, r))).mul(uWave);
    const ground = new SoftRing(96, DUST);
    ground.mat.blending = THREE.AdditiveBlending;
    this.group.add(ground.mesh);
    return { flash: add(fm, this.ball), shell: add(sm, this.ball), wave: add(wm, this.disc), ground, uFlash, uShell, uWave, uSharp };
  }

  update(dt: number) {
    const N = this.novas, v = N.v;
    N.update(dt);
    N.debris.update(dt, this.ground);
    this.debris.update();
    while (this.slots.length < N.list.length) this.slots.push(this.make());
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i], n: Nova | undefined = N.list[i];
      const on = !!n;
      s.flash.visible = s.shell.visible = s.wave.visible = s.ground.mesh.visible = on;
      if (!n) continue;
      const life = N.life(n), u = n.age / life, R = n.R * Math.min(2, n.k), B = v.novaBright;
      // Flash: out in a tenth of a second, gone in a third of its life.
      const fu = Math.min(1, n.age / 0.1), fade = Math.max(0, 1 - u * 3);
      s.flash.position.set(n.x, n.y, n.z);
      s.flash.scale.setScalar(Math.max(0.01, R * v.novaFlash * (0.4 + 0.6 * fu)));
      s.uFlash.value = fade * fade * B;
      s.flash.visible = fade > 0 && v.novaFlash > 0;
      // Shell: swells fast then slow to its size, fading through its life.
      s.shell.position.set(n.x, n.y, n.z);
      s.shell.scale.setScalar(Math.max(0.01, R * v.novaShell * easeOut(u * 1.4)));
      s.uShell.value = Math.pow(1 - u, 1.6) * 1.2 * B;
      s.shell.visible = v.novaShell > 0;
      // Shockwave: races out flat from the hull, past the blast's edge.
      s.wave.position.set(n.x, n.y, n.z);
      s.wave.scale.setScalar(Math.max(0.01, R * v.novaRing * easeOut(u * 1.15)));
      s.uWave.value = Math.pow(1 - u, 1.3) * B;
      s.uSharp.value = v.novaRingSharp;
      s.wave.visible = v.novaRing > 0;
      // Ground ring: rolls out over the sand, thinner as it goes.
      const gr = R * v.novaGround * easeOut(u * 1.3);
      if (gr > 0.5) {
        s.ground.set(n.x, n.z, Math.max(0, gr - 1.5 - 3 * (1 - u)), gr, this.ground, 0.85, 0.12);
        s.ground.mat.opacity = Math.max(0, 1 - u) * 0.75 * Math.min(1.5, B);
      } else s.ground.mesh.visible = false;
    }
  }
}
