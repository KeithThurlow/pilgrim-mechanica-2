// Crushers in the expedition (glue; Keith 2026-11-01: "a relatively common kind of robot you see out and about in the
// world ... near scrap or salvage areas, because it salvages things. A danger to the player while they're salvaging,
// but not a super dangerous robot. But destroying it ... is likely to summon a robot swarm": do I want to salvage
// here, or kill it and escalate the zone?).
//
// A share of the salvage POIs (crusherSiteChance, seeded by the POI's id; never fortresses, hubs or bare rock) have a
// crusher grazing on them: it walks from spot to spot and eats them (a spot it eats is gone, the player's loss). It
// goes for the mech only inside crusherHunt (shorter out here) and hurts at crusherSiteDamage of the lab's numbers.
// Killing it: a red flare goes up from the wreck, every camp within crusherCallWake hears it, and with chance
// crusherCall a swarm of crusherCallSize comes in from crusherCallFrom off, heading for the wreck.
// Stood up within crusherSiteNear of the mech, taken off past crusherSiteFar (its health remembered); a dead one
// stays dead. Ownership: host (crushers, salvage eaten, the call); the flare cosmetic.
import * as THREE from "three/webgpu";
import type { Param } from "../core/tweaks";
import type { Battlefield } from "../game/battlefield";
import type { MechUnit } from "../game/mechUnit";
import type { DuneField } from "../world/terrain";
import type { Prey } from "../pilot/quarry";
import type { PoiPlacement } from "../world/pois";
import type { SpotState } from "../pois/salvage";
import { CRUSHER_DEFAULTS, CRUSHER_PARAMS, type Crusher, type CrusherFood } from "../combat/crusher";
import { CrusherField } from "../combat/crusherField";
import { ROBOT_TEAR_DEFAULTS } from "../combat/robotTearFx";
import type { FieldSites } from "./sites";
import type { SwarmCamps } from "./swarmCamps";

export const CRUSHER_SITE_DEFAULTS = {
  ...CRUSHER_DEFAULTS, ...ROBOT_TEAR_DEFAULTS,
  // Out in the world it minds its salvage more than you.
  crusherHunt: 28,
  crusherEatTime: 8,
  crushersOn: 1, crusherSiteChance: 0.75, crusherSiteDamage: 0.6, crusherSiteNear: 550, crusherSiteFar: 750,
  crusherCall: 0.75, crusherCallSize: 30, crusherCallFrom: 160, crusherCallWake: 250,
};
export type CrusherSiteValues = typeof CRUSHER_SITE_DEFAULTS;
const G = "Crushers: in the field";
export const CRUSHER_SITE_PARAMS: Param[] = [
  { key: "crushersOn", label: "Crushers in the field (0 off, 1 on)", min: 0, max: 1, step: 1, group: G },
  { key: "crusherSiteChance", label: "Salvage sites with one (share)", min: 0, max: 1, step: 0.01, group: G, tip: "Wrecks, pods, debris fields, dead convoys and the like; seeded per site" },
  { key: "crusherSiteDamage", label: "Damage (× the lab's)", min: 0, max: 2, step: 0.05, group: G, tip: "Out here it's a nuisance while you salvage, not a killer" },
  { key: "crusherSiteNear", label: "Stands up within (m)", min: 100, max: 1500, step: 10, group: G },
  { key: "crusherSiteFar", label: "Taken off past (m)", min: 150, max: 2000, step: 10, group: G },
  { key: "crusherCall", label: "A kill calls a swarm (chance)", min: 0, max: 1, step: 0.01, group: G, tip: "Its death flare: kill it and the zone escalates" },
  { key: "crusherCallSize", label: "The swarm it calls (robots)", min: 1, max: 150, step: 1, group: G },
  { key: "crusherCallFrom", label: "The swarm comes from (m off)", min: 40, max: 600, step: 5, group: G },
  { key: "crusherCallWake", label: "Its flare wakes camps within (m)", min: 0, max: 1000, step: 10, group: G },
  ...CRUSHER_PARAMS,
];
export const CRUSHER_SITE_TOPIC = { id: "crushers", label: "Crushers", groups: [G, "Crushers", "Crushers: maw", "Crushers: pincers", "Crushers: eating"] };

/** A crusher's site: a POI it grazes on. Not a fortress or hub, not bare rock. */
export const crusherSiteKind = (p: PoiPlacement) => p.kind !== "fortress" && p.kind !== "hub" && p.kind !== "outcrop";

/** A string's seeded share (0..1): FNV-1a. */
export function idShare(id: string, salt = 0): number {
  let h = 0x811c9dc5 ^ salt;
  for (let k = 0; k < id.length; k++) { h ^= id.charCodeAt(k); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

interface Live { c: Crusher; poi: PoiPlacement }
interface Flare { mesh: THREE.Mesh; t: number }

export class CrusherSites {
  readonly cf: CrusherField;
  /** Swarms called by kills since construction (for the HUD and the check). */
  calls = 0;
  private live = new Map<string, Live>();
  private health = new Map<string, number>();
  private dead = new Set<string>();
  private food: (CrusherFood & { spot: SpotState })[] = [];
  private spotIds = new Map<string, number>();
  private scanT = 0;
  private flares: Flare[] = [];

  constructor(private v: CrusherSiteValues, bf: Battlefield, private scene: THREE.Scene, private field: DuneField, mech: MechUnit,
    private sites: FieldSites, private swarms: SwarmCamps, shake?: (k: number) => void) {
    this.cf = new CrusherField(v, bf, scene, field, mech, shake, 11, false);
    this.cf.onAte = (food) => {
      const f = this.food.find((x) => x.id === food);
      // Eaten: the spot is gone (stripped, paying nobody).
      if (f) { f.spot.progress = 1; f.spot.done = true; }
    };
    this.cf.onDown = (c) => this.died(c);
  }

  get count() { return this.cf.pack.alive; }

  reset() {
    for (const l of this.live.values()) this.cf.remove(l.c);
    this.live.clear(); this.health.clear(); this.dead.clear();
    for (const f of this.flares) this.scene.remove(f.mesh);
    this.flares = [];
  }

  /** Mech radar contacts (big robots). */
  contacts(x: number, z: number, r: number, out: { id: number; x: number; z: number; kind: number }[]) {
    for (const c of this.cf.pack.list) if (c.alive && Math.hypot(c.x - x, c.z - z) < r) out.push({ id: 5e9 + c.id, x: c.x, z: c.z, kind: 2 });
  }

  /** Crushers within r of (x, z), as points (the convoy's turrets track them). */
  threats(x: number, z: number, r: number, out: THREE.Vector3[], max = 24) {
    for (const c of this.cf.pack.list) {
      if (c.alive && out.length < max && Math.hypot(c.x - x, c.z - z) <= r) out.push(new THREE.Vector3(c.x, c.bodyY, c.z));
    }
    return out;
  }

  /** One frame. p: the mech (or the pilot); hunting: the expedition is on and someone's on the sand. */
  update(dt: number, hunting: boolean, p: { x: number; z: number }, prey: Prey) {
    const v = this.v;
    this.cf.damageK = v.crusherSiteDamage;
    if (v.crushersOn < 0.5) { if (this.live.size) this.reset(); return; }
    this.scanT -= dt;
    if (this.scanT <= 0) { this.scanT = 0.5; this.scan(p); }
    // Food: the unstripped spots of the sites with a crusher on them.
    this.food.length = 0;
    for (const s of this.sites.salvage.spots) {
      if (s.done || !this.live.has(s.poi)) continue;
      let id = this.spotIds.get(s.id);
      if (id === undefined) { id = this.spotIds.size + 1; this.spotIds.set(s.id, id); }
      this.food.push({ id, x: s.x, y: this.field.height(s.x, s.z) + s.h, z: s.z, spot: s });
    }
    this.cf.update(dt, hunting ? prey : null, this.food);
    for (const f of [...this.flares]) {
      f.t -= dt;
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, Math.min(1, f.t / 2)) * (0.7 + Math.random() * 0.3);
      f.mesh.scale.x = f.mesh.scale.z = 1 + Math.sin(f.t * 9) * 0.15;
      if (f.t <= 0) { this.scene.remove(f.mesh); this.flares.splice(this.flares.indexOf(f), 1); }
    }
  }

  /** The nearest site with a crusher on it (alive or not yet stood up) within r of (x, z), or null (the lab's ?crusher). */
  nearestSite(x: number, z: number, r: number): PoiPlacement | null {
    let best: PoiPlacement | null = null, bd = Infinity;
    for (const poi of this.sites.poisIn(x - r, z - r, x + r, z + r)) {
      if (this.dead.has(poi.id) || !crusherSiteKind(poi) || idShare(poi.id) >= this.v.crusherSiteChance) continue;
      const d = Math.hypot(poi.x - x, poi.z - z);
      if (d < bd) { bd = d; best = poi; }
    }
    return best;
  }

  /** Stand crushers up at the sites near p; take far ones off. */
  private scan(p: { x: number; z: number }) {
    const v = this.v, near = v.crusherSiteNear, far = Math.max(near + 50, v.crusherSiteFar);
    for (const [id, l] of this.live) {
      if (!l.c.alive) continue;
      if (Math.hypot(l.c.x - p.x, l.c.z - p.z) > far) { this.health.set(id, l.c.health); this.cf.remove(l.c); this.live.delete(id); }
    }
    for (const poi of this.sites.poisIn(p.x - near, p.z - near, p.x + near, p.z + near)) {
      if (this.live.has(poi.id) || this.dead.has(poi.id) || !crusherSiteKind(poi)) continue;
      if (idShare(poi.id) >= v.crusherSiteChance || Math.hypot(poi.x - p.x, poi.z - p.z) > near) continue;
      // At the site's edge, facing in.
      const a = idShare(poi.id, 7) * Math.PI * 2, off = poi.reach * 0.6 + 6;
      const x = poi.x + Math.sin(a) * off, z = poi.z + Math.cos(a) * off;
      const c = this.cf.spawn(x, z, Math.atan2(poi.x - x, poi.z - z));
      const hp = this.health.get(poi.id);
      if (hp !== undefined) c.health = Math.min(c.maxHealth, hp);
      this.live.set(poi.id, { c, poi });
    }
  }

  /** A kill: the flare, camps woken, and (likely) a swarm called to the wreck. */
  private died(c: Crusher) {
    const v = this.v;
    let site: string | null = null;
    for (const [id, l] of this.live) if (l.c === c) { site = id; break; }
    if (!site) return;
    this.live.delete(site);
    this.dead.add(site);
    this.flare(c.x, c.bodyY, c.z);
    if (v.crusherCallWake > 0) this.swarms.noise(c.x, c.z, v.crusherCallWake);
    if (idShare(site, 31) < v.crusherCall) {
      const a = idShare(site, 53) * Math.PI * 2, d = v.crusherCallFrom;
      this.swarms.addGroup(`crusherCall:${site}`, Math.max(1, Math.round(v.crusherCallSize)), c.x + Math.sin(a) * d, c.z + Math.cos(a) * d, undefined, 0, { x: c.x, z: c.z });
      this.calls++;
    }
  }

  private flare(x: number, y: number, z: number) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Mesh(FLARE, mat);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.flares.push({ mesh, t: 8 });
  }
}

/** The death flare: a tall thin red column (90 m). */
const FLARE = new THREE.CylinderGeometry(0.35, 0.8, 90, 8, 1, true).translate(0, 45, 0);
