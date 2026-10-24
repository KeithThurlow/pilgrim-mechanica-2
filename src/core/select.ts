// Selection mode (Keith 2026-10-24): hold V, point at something in the scene and it lights up with its name; click
// it and the tuning panel shows only that thing's sliders (its topic). Things are registered with the meshes that
// make them up; clicking the ground picks the ground's topic and clicking the sky picks the sky's.
// While V is held, labs should not fire or act on clicks (check `active`).
import * as THREE from "three/webgpu";
import type { App } from "./app";
import type { Ground } from "../mech/walker";
import { screenToGround } from "../world/raycast";

export interface Selectable {
  /** The panel topic this opens. */
  topic: string;
  /** Shown next to the cursor. */
  label: string;
  /** The meshes that make it up (looked up each time, so models loaded later can be listed). */
  objects: () => THREE.Object3D[];
}

export interface SelectOptions {
  items: Selectable[];
  /** Topic and label for a click on the ground, and the ground to test against. */
  ground?: { topic: string; label: string; field: Ground };
  /** Topic and label for a click on nothing (the sky). */
  sky?: { topic: string; label: string };
  onPick: (topic: string) => void;
  /** Keys that hold the mode on (default V). */
  key?: string;
}

const HOVER = new THREE.Color(0xff9a3c), PICKED = new THREE.Color(0xffc46b);

export class Selector {
  active = false;
  private hovered: Selectable | null = null;
  private hoverGround: "ground" | "sky" | null = null;
  private picked: Selectable | null = null;
  private tag = document.createElement("div");
  private banner = document.createElement("div");
  private ray = new THREE.Raycaster();
  private lit = new Map<THREE.Material, { color: THREE.Color; intensity: number }>();
  private mouse = { x: 0, y: 0 };

  constructor(private app: App, private o: SelectOptions) {
    const key = o.key ?? "KeyV";
    this.tag.className = "select-tag";
    this.tag.hidden = true;
    this.banner.className = "select-banner";
    this.banner.textContent = "Selecting: click something to tune it";
    this.banner.hidden = true;
    document.body.append(this.tag, this.banner);
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    addEventListener("keydown", (e) => { if (e.code === key && !typing(e) && !this.active) this.setActive(true); });
    addEventListener("keyup", (e) => { if (e.code === key) this.setActive(false); });
    addEventListener("blur", () => this.setActive(false));
    const canvas = app.renderer.domElement;
    canvas.addEventListener("pointermove", (e) => { this.mouse = { x: e.clientX, y: e.clientY }; if (this.active) this.hover(); });
    // Capture phase, so orbit controls and firing never see a selecting click.
    canvas.addEventListener("pointerdown", (e) => {
      if (!this.active || e.button !== 0) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      this.hover();
      if (this.hovered) { this.picked = this.hovered; this.o.onPick(this.hovered.topic); }
      else if (this.hoverGround === "ground" && this.o.ground) { this.picked = null; this.o.onPick(this.o.ground.topic); }
      else if (this.hoverGround === "sky" && this.o.sky) { this.picked = null; this.o.onPick(this.o.sky.topic); }
      this.paint();
    }, true);
  }

  /** The thing last picked in the scene (for reports), or null. */
  get selection() { return this.picked?.label ?? null; }

  /** Forget the picked thing (when the panel changes topic by its buttons). */
  clear() { this.picked = null; this.paint(); }

  private setActive(on: boolean) {
    this.active = on;
    document.body.classList.toggle("selecting", on);
    this.banner.hidden = !on;
    if (on) this.hover();
    else { this.hovered = null; this.hoverGround = null; this.tag.hidden = true; this.paint(); }
  }

  private hover() {
    const canvas = this.app.renderer.domElement, r = canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((this.mouse.x - r.left) / r.width) * 2 - 1, -((this.mouse.y - r.top) / r.height) * 2 + 1), this.app.camera);
    let best: { item: Selectable; d: number } | null = null;
    for (const item of this.o.items) {
      const objs = item.objects().filter((o) => o.visible);
      const hit = this.ray.intersectObjects(objs, true).find((h) => !(h.object as THREE.Mesh).userData.ink);
      if (hit && (!best || hit.distance < best.d)) best = { item, d: hit.distance };
    }
    this.hovered = best?.item ?? null;
    this.hoverGround = null;
    let label = this.hovered?.label ?? null;
    if (!this.hovered && this.o.ground && screenToGround(this.mouse.x, this.mouse.y, canvas, this.app.camera, this.o.ground.field)) {
      this.hoverGround = "ground"; label = this.o.ground.label;
    } else if (!this.hovered && this.o.sky) { this.hoverGround = "sky"; label = this.o.sky.label; }
    this.tag.hidden = !label;
    if (label) {
      this.tag.textContent = label;
      this.tag.style.left = this.mouse.x + "px";
      this.tag.style.top = this.mouse.y + "px";
    }
    this.paint();
  }

  /** Tint the hovered thing (and, while selecting, the picked one) through their materials' emissive. */
  private paint() {
    for (const [m, was] of this.lit) { const s = m as THREE.MeshStandardMaterial; s.emissive.copy(was.color); s.emissiveIntensity = was.intensity; }
    this.lit.clear();
    const glow = (item: Selectable | null, c: THREE.Color, k: number) => {
      if (!item) return;
      for (const root of item.objects()) root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || mesh.userData.ink) return;
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          const s = m as THREE.MeshStandardMaterial;
          if (!s.emissive || this.lit.has(s)) continue;
          this.lit.set(s, { color: s.emissive.clone(), intensity: s.emissiveIntensity });
          s.emissive.copy(c);
          s.emissiveIntensity = k;
        }
      });
    };
    if (this.active) {
      glow(this.picked, PICKED, 0.18);
      glow(this.hovered, HOVER, 0.35);
    }
  }
}
