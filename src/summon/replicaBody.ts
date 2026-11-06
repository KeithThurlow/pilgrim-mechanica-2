// The mech replica's model (Keith 2026-11-03: "something that basically looks like my mech, but like very thin, like use
// the same underlying skeleton, but ... no need for a pilot in the center. The legs can be thinner because it doesn't
// have to support the same weight. The weapons will in general just be a little bit lighter looking ... a robot in
// there"). The Rampart's own model on the same rig (src/mech/rampart.ts), slimmed (RampartBody.slim): thin legs and
// feet, a narrow, low hull, smaller guns, no ammo drums, power pack or back unit, no cockpit pod (RampartBody.dropCab: the front plated over), bleached to a pale unmanned grey (RampartBody.bleach, a slider), a twin-optic sensor head for a head.
// The gun is still rolled per build (Keith 2026-11-02, replicas.ts): its minigun pods, or a light rocket rack in their
// place. The look values are sliders (Summons › Replicas: look) and apply live.
// The Rampart loads asynchronously; until it has (and in headless checks, where there are no models) the old wire
// frame stands in (replicaWire.ts), so the sim never waits on a model.
// Drawing only (cosmetic).
import * as THREE from "three/webgpu";
import type { WalkerSim } from "../mech/walker";
import type { UpperSim } from "../mech/upper";
import type { MechBody, DeadRig } from "../game/mechUnit";
import type { ToonLook } from "../look/toon";
import { RampartBody } from "../mech/rampart";
import type { FootShape } from "../fx/footprint";
import { WireReplica, type ReplicaWeapon } from "./replicaWire";

export type { ReplicaWeapon } from "./replicaWire";

/** The look values (replicas.ts REPLICA_DEFAULTS). */
export interface ReplicaLook { repLegThin: number; repFootSize: number; repHullW: number; repHullH: number; repHullL: number; repGunSize: number; repShade: number }

const tubeGeo = new THREE.CylinderGeometry(1, 1, 1, 8).rotateX(Math.PI / 2).translate(0, 0, 0.5);
const boxGeo = new THREE.BoxGeometry(1, 1, 1);

/** A light rocket rack on a gun pivot (+Z along the barrel): a slim box of four tubes, a muzzle at its front. */
function rocketRack(look: ToonLook): { g: THREE.Group; muzzle: THREE.Object3D; meshes: THREE.Mesh[] } {
  const g = new THREE.Group(), meshes: THREE.Mesh[] = [];
  const add = (geo: THREE.BufferGeometry, s: [number, number, number], at: [number, number, number], dark = false) => {
    const m = new THREE.Mesh(geo); m.scale.set(...s); m.position.set(...at); m.userData.dark = dark; g.add(m); meshes.push(m); look.apply(m, true); return m;
  };
  add(boxGeo, [0.5, 0.42, 0.9], [0, 0, 0.05]);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) add(tubeGeo, [0.09, 0.09, 0.95], [sx * 0.12, sy * 0.1, -0.38], true);
  add(boxGeo, [0.08, 0.2, 0.5], [0, -0.3, -0.1]); // the cradle under it
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, 0.62);
  g.add(muzzle);
  return { g, muzzle, meshes };
}

export class ReplicaBody implements MechBody {
  readonly root = new THREE.Group();
  readonly armed = true;
  weapon: ReplicaWeapon = "minigun";
  private wire: WireReplica;
  private rb: RampartBody | null = null;
  private racks: { side: 1 | -1; g: THREE.Group; muzzle: THREE.Object3D; meshes: THREE.Mesh[] }[] = [];
  private lastPaint: { look: ToonLook; color: number | null } | null = null;
  private looks: ReplicaLook | null = null;
  private applied = "";

  constructor(private look: ToonLook) {
    this.root.name = "replica";
    this.wire = new WireReplica(look);
    this.root.add(this.wire.root);
    // The Rampart's files are fetched and parsed once per page (the player's mech already has), shared by every body.
    if (typeof window !== "undefined") RampartBody.load(look).then((rb) => this.useRampart(rb)).catch(() => {});
  }

  /** The slimmed Rampart, once loaded: the wire frame goes. */
  private useRampart(rb: RampartBody) {
    this.rb = rb;
    rb.showParts({ gunLeft: true, gunRight: true, drums: false, pack: false, sensor: true, sensorId: "sensor-optic", sensorStyle: "head" });
    for (const side of [1, -1] as const) {
      const r = rocketRack(this.look), kick = rb.mount(side === 1 ? "left" : "right");
      // Where the minigun pod sits on its pivot (its meshes are in the pivot's frame): the rack goes there.
      const box = new THREE.Box3();
      for (const o of kick.children) { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrix)); } }
      if (!box.isEmpty()) { const c = box.getCenter(new THREE.Vector3()); r.g.position.set(c.x, c.y, Math.max(0, c.z - 0.2)); }
      kick.add(r.g);
      this.racks.push({ side, ...r });
    }
    rb.dropCab();
    this.root.remove(this.wire.root);
    this.root.add(rb.root);
    this.applied = "";
    if (this.looks) this.setLook(this.looks);
    this.setWeapon(this.weapon);
    if (this.lastPaint) this.paint(this.lastPaint.look, this.lastPaint.color);
  }

  /** The look sliders (live: re-applied when they change). */
  setLook(v: ReplicaLook) {
    this.looks = v;
    const key = `${v.repLegThin},${v.repFootSize},${v.repHullW},${v.repHullH},${v.repHullL},${v.repGunSize},${v.repShade}`;
    if (!this.rb || key === this.applied) return;
    this.applied = key;
    this.rb.slim({ leg: v.repLegThin, foot: v.repFootSize, hull: [v.repHullW, v.repHullH, v.repHullL], gun: v.repGunSize, back: false });
    this.rb.bleach(v.repShade);
    if (this.lastPaint) this.paint(this.lastPaint.look, this.lastPaint.color);
  }

  /** Which gun the pods carry: the Rampart's minigun pods, or the rocket rack in their place. */
  setWeapon(w: ReplicaWeapon) {
    this.weapon = w;
    this.wire.setWeapon(w);
    if (!this.rb) return;
    for (const side of [1, -1] as const) this.rb.showPod(side, w === "minigun", false);
    for (const r of this.racks) r.g.visible = w === "rockets";
  }

  update(sim: WalkerSim, upper: UpperSim) { (this.rb ?? this.wire).update(sim, upper); }
  shoulderLine(out = new THREE.Vector3()) { return (this.rb ?? this.wire).shoulderLine(out); }
  muzzle(side: 1 | -1, out = new THREE.Vector3()) {
    if (!this.rb) return this.wire.muzzle(side, out);
    return this.weapon === "rockets" ? this.racks.find((r) => r.side === side)!.muzzle.getWorldPosition(out) : this.rb.muzzle(side, out);
  }
  eject(side: 1 | -1, out = new THREE.Vector3()) { return (this.rb ?? this.wire).eject(side, out); }
  /** Keith 2026-11-06: their prints were the big plain oval; now the Rampart's own sole at the slimmed feet's size
   *  (the wire stand-in, before the model loads: the plain oval at that size). */
  footprint(side: 1 | -1): FootShape | null { return this.rb?.footprint(side) ?? null; }
  printScale() { return this.rb?.printScale() ?? this.looks?.repFootSize ?? 1; }
  barrel(side: 1 | -1, out = new THREE.Vector3()) { return (this.rb ?? this.wire).barrel(side, out); }

  /** The Rampart's own paint (bleached paler by `repShade` in setLook); the wreck's colour as given. */
  paint(look: ToonLook, color: number | null) {
    this.lastPaint = { look, color };
    if (!this.rb) { this.wire.paint(look, color); return; }
    this.rb.paint(look, color);
    const s = this.looks?.repShade ?? 0, rack = new THREE.Color(0x5d6648).lerp(new THREE.Color(0xb4b8b6), Math.min(1, s * 1.2)).getHex();
    for (const r of this.racks) for (const m of r.meshes) look.tint(m, m.userData.dark ? 0x2b2d31 : color ?? rack);
  }

  deadRig(): DeadRig { return this.rb ? this.rb.deadRig() : this.wire.deadRig(); }
}

