// The weapon kit in TypeScript (a port of the old project's Blender kit, tools/blender/weapons/wkit.py there):
// build a weapon from lofted, turned and swept solids with paint sections, then emit a ModelDef that loads the
// same way as the converted GLBs.
import * as THREE from "three/webgpu";
import { Piece, emit, v, type V3 } from "./piece";
import type { ModelDef, Moving, Socket } from "../parts";

export * from "./piece";
export * from "./shapes";
export * from "./solids";
export * from "./marks";

/** Collects the pieces, sockets and moving parts of one weapon and emits its ModelDef. */
export class Build {
  private pieces = new Map<string, Piece>();
  private sockets: Record<string, Socket> = {};
  private moving: Moving[] = [];
  /** sd: the side the weapon hangs on (+1 left: outboard +X; -1 right: outboard -X), for asymmetric details. */
  constructor(public seed = 1, public k = 1, public sd: 1 | -1 = -1) {}

  /** The piece by name (made on first use; moving parts give their pivot). */
  piece(name = "Body", pivot: V3 = v(), parent?: string) {
    let p = this.pieces.get(name);
    if (!p) { p = new Piece(name, pivot.clone(), this.seed); this.pieces.set(name, p); if (parent) this.parents.set(name, parent); }
    return p;
  }
  private parents = new Map<string, string>();
  /** A socket; on a moving part name it "Part/Socket" so it rides the part. */
  socket(name: string, pos: V3, fwd?: V3) { this.sockets[name] = { pos: pos.clone(), fwd: fwd?.clone().normalize() }; }
  move(m: Moving) { this.moving.push(m); }

  /** Outboard direction for this side. */
  get out() { return v(this.sd, 0, 0); }
  /** Reading direction (left to right) on the outboard face, seen from outside. */
  get read() { return v(0, 0, -this.sd); }

  def(wear = 1): ModelDef {
    const parts = [...this.pieces.values()].filter((p) => !p.empty()).map((p) => ({ name: p.name, pivot: p.pivot.clone(), parent: this.parents.get(p.name), geometry: emit(p, { k: this.k, wear, seed: this.seed }) }));
    // Sockets on a part are given in model space here; the def holds them relative to the part's pivot.
    const sockets: Record<string, Socket> = {};
    for (const [k, s] of Object.entries(this.sockets)) {
      const host = k.includes("/") ? this.pieces.get(k.split("/")[0]) : undefined;
      sockets[k] = { ...s, pos: host ? s.pos.clone().sub(host.pivot) : s.pos.clone() };
    }
    return { parts, sockets, moving: this.moving };
  }
}

/** Unit vectors. */
export const X = () => new THREE.Vector3(1, 0, 0), Y = () => new THREE.Vector3(0, 1, 0), Z = () => new THREE.Vector3(0, 0, 1);
