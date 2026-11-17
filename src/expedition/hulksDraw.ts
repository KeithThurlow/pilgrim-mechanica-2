// Marks salvageable hulks (drawing only; the hulks are hulks.ts). Keith 2026-11-17: "there's no light or indicator
// that you can salvage from a mech". Each hulk with parts left gets a beam in its best part's rarity colour (taller
// than an item drop's, so a hulk reads as the bigger prize from the game camera), a pulsing ring on the sand at the
// reach you open it from, and a label: "SALVAGE · n parts", with "[E] OPEN" when E would open it now. A jammed or
// picked-clean hulk loses its beam; its label says "JAMMED" for a few seconds, then goes.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import { canvasRect } from "../core/canvasRect";
import { RARITY, tierOf } from "../items/rarity";
import type { Hulk } from "./hulks";
import { HULK_GROUP } from "./hulks";

export const HULK_FX_DEFAULTS = { hulkBeamHeight: 14, hulkBeamWidth: 0.4, hulkBeamGlow: 0.6, hulkLabelRange: 90 };
export type HulkFxValues = typeof HULK_FX_DEFAULTS;
const G = HULK_GROUP;
export const HULK_FX_PARAMS: Param[] = [
  { key: "hulkBeamHeight", label: "Hulk beam height (m)", min: 2, max: 40, step: 0.5, group: G, tip: "The light over a hulk with parts left (in its best part's rarity colour)" },
  { key: "hulkBeamWidth", label: "Hulk beam width (m)", min: 0.05, max: 2, step: 0.05, group: G },
  { key: "hulkBeamGlow", label: "Hulk beam brightness", min: 0.05, max: 1, step: 0.05, group: G },
  { key: "hulkLabelRange", label: "Hulk label within (m)", min: 10, max: 300, step: 5, group: G },
];

interface Shown { root: THREE.Group; beam: THREE.Mesh; halo: THREE.Mesh; ring: THREE.Mesh; el: HTMLDivElement; html: string; col: string; tier: number; seed: number; gone: number }

export class HulksDraw {
  readonly group = new THREE.Group();
  readonly labels = document.createElement("div");
  private shown = new Map<string, Shown>();
  private beamGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).translate(0, 0.5, 0);
  private ringGeo = new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2);
  private p = new THREE.Vector3();
  private t = 0;

  constructor(public v: HulkFxValues, private ground: (x: number, z: number) => number) {
    Object.assign(this.labels.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "4" } as CSSStyleDeclaration);
    document.body.appendChild(this.labels);
  }

  private glow(color: string, opacity: number) {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
  }

  private make(h: Hulk): Shown {
    const best = h.parts.reduce((m, i) => Math.max(m, tierOf(i.rarity)), 0);
    const col = RARITY[(Object.keys(RARITY) as (keyof typeof RARITY)[])[best]].color;
    const root = new THREE.Group();
    const beam = new THREE.Mesh(this.beamGeo, this.glow(col, this.v.hulkBeamGlow));
    const halo = new THREE.Mesh(this.beamGeo, this.glow(col, this.v.hulkBeamGlow * 0.25));
    const ring = new THREE.Mesh(this.ringGeo, this.glow(col, 0.7));
    ring.position.y = 0.1;
    root.add(beam, halo, ring);
    this.group.add(root);
    const el = document.createElement("div");
    Object.assign(el.style, {
      position: "absolute", transform: "translate(-50%, -100%)", textAlign: "center", whiteSpace: "nowrap",
      font: "12px/1.25 system-ui, 'Segoe UI', sans-serif", textShadow: "0 1px 3px #000d", padding: "3px 8px",
      borderRadius: "4px", background: "#0d0c0bc0", border: `1px solid ${col}`, color: "#ffd9a0",
    } as CSSStyleDeclaration);
    this.labels.appendChild(el);
    return { root, beam, halo, ring, el, html: "", col, tier: best, seed: Math.random() * 10, gone: 0 };
  }

  private drop(id: string, s: Shown) {
    this.group.remove(s.root);
    for (const m of [s.beam, s.halo, s.ring]) (m.material as THREE.Material).dispose();
    s.el.remove();
    this.shown.delete(id);
  }

  clear() { for (const [id, s] of [...this.shown]) this.drop(id, s); }

  /**
   * One frame. hulks: every hulk on the field; target: the one E would open now; open: the one whose panel is up;
   * from: where the player is; reach: the open reach from there (the ring's size); show: out on the sand.
   */
  update(dt: number, hulks: readonly Hulk[], target: Hulk | null, open: Hulk | null, from: { x: number; z: number }, reach: number, show: boolean, camera: THREE.Camera | null, canvas: HTMLCanvasElement | null) {
    const v = this.v;
    this.t += dt;
    const live = new Set<string>();
    if (show) for (const h of hulks) {
      const done = h.jammed || !h.parts.length;
      let s = this.shown.get(h.id);
      if (!s) { if (done) continue; s = this.make(h); this.shown.set(h.id, s); }
      // A spent hulk: the beam goes at once, the label lingers 4 s.
      if (done) { s.gone += dt; if (s.gone > 4) continue; }
      live.add(h.id);
      s.root.position.set(h.x, this.ground(h.x, h.z), h.z);
      s.root.visible = !done;
      const pulse = 1 + 0.1 * Math.sin(this.t * 3 + s.seed), w = v.hulkBeamWidth * (1 + 0.12 * s.tier) * pulse;
      s.beam.scale.set(w, v.hulkBeamHeight * (1 + 0.15 * s.tier), w);
      s.halo.scale.set(w * 3.5, v.hulkBeamHeight * 0.75, w * 3.5);
      (s.beam.material as THREE.MeshBasicMaterial).opacity = v.hulkBeamGlow * (0.8 + 0.2 * pulse);
      (s.halo.material as THREE.MeshBasicMaterial).opacity = v.hulkBeamGlow * 0.25;
      const r = reach * (1 + 0.04 * Math.sin(this.t * 2.4 + s.seed));
      s.ring.scale.set(r, 1, r);
      (s.ring.material as THREE.MeshBasicMaterial).opacity = h === target || h === open ? 0.95 : 0.45;
      // The label.
      const dist = Math.hypot(h.x - from.x, h.z - from.z);
      let vis = !!camera && !!canvas && (dist <= v.hulkLabelRange || h === target);
      if (vis) {
        const p = this.p.set(h.x, this.ground(h.x, h.z) + 5, h.z).project(camera!);
        vis = p.z <= 1 && Math.abs(p.x) <= 1.1 && Math.abs(p.y) <= 1.1;
        if (vis) {
          const rc = canvasRect(canvas!);
          s.el.style.left = `${rc.left + (p.x * 0.5 + 0.5) * rc.width}px`;
          s.el.style.top = `${rc.top + (-p.y * 0.5 + 0.5) * rc.height}px`;
        }
      }
      const n = h.parts.length;
      const html = h.jammed ? `<b style="color:#ff8a6a">JAMMED</b>`
        : !n ? `<b>PICKED CLEAN</b>`
        : `<b style="letter-spacing:0.06em">SALVAGE</b> · ${n} part${n === 1 ? "" : "s"}${h.pulls ? ` · ${h.pulls} pulled` : ""}`
          + (h === open ? `<div style="color:#fff;font-weight:700">OPEN · E closes</div>` : h === target ? `<div style="color:#fff;font-weight:700;letter-spacing:0.06em">[E] OPEN</div>` : "");
      if (html !== s.html) { s.el.innerHTML = html; s.html = html; }
      s.el.style.display = vis ? "block" : "none";
      s.el.style.boxShadow = h === target || h === open ? `0 0 10px ${s.col}aa` : "none";
    }
    for (const [id, s] of [...this.shown]) if (!live.has(id)) this.drop(id, s);
  }
}
