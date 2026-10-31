// The arsenal's models from the weapon model library (src/weapons/library.ts), behind the arsenal's stand-in
// interface (src/weapons/models.ts): its kinds map to library ids, the model hangs straight on the Rampart's mount
// (library models are rooted on their mount), and the arsenal's cues drive the moving parts: a kick heats the
// barrels, hides the rocket and opens the pod doors; the "glow" opacity it sets drives the lamps (ready, charge).
// While a GLB is still loading the box stand-in shows, then the model takes its place.
import * as THREE from "three/webgpu";
import type { ToonLook } from "../look/toon";
import type { LauncherKind, WeaponModel as ArsenalModel } from "./models";
import { createWeapon, entry, isLoaded, loadDef, preloadWeapons, type WeaponModel } from "./library";
import { WeaponLook, WEAPON_LOOK_DEFAULTS } from "./weaponLook";

/** Which library model each arsenal kind draws as (scale on top of its fit; tilt raises a pod's face, degrees). */
export const KIND_MODELS: Record<LauncherKind, { id: string; scale?: number; tilt?: number }> = {
  rail: { id: "rail-cannon-hull" },
  railLight: { id: "rail-cannon-hull", scale: 0.75 },
  autocannon: { id: "autocannon-hull" },
  rpg: { id: "rocket-launcher-hull" },
  // The old Rampart's arm rocket pod (Unity kit, 2x2 tubes), built at the old mech's scale: grown to sit in the hand.
  rpgLight: { id: "missile-pod-l", scale: 2.4 },
  shoulderRpg: { id: "rocket-launcher-shoulder" },
  missiles: { id: "missile-pod-h", tilt: 30 },
  mortar: { id: "mortar-heavy" },
  linemortar: { id: "mortar-line" },
};

const ids = [...new Set(Object.values(KIND_MODELS).flatMap(({ id }) => [id, entry(id).mirror].filter((x): x is string => !!x)))];
// Warm the cache as soon as the arsenal is imported, so most fits find their model ready.
const warm = preloadWeapons(ids).catch((e) => console.warn("weapon models:", e));

const looks = new WeakMap<ToonLook, WeaponLook>();
/** The shared weapon look for a unit look (weapon sliders at their defaults; the armoury lab tunes them). */
export function weaponLookFor(toon: ToonLook) {
  let l = looks.get(toon);
  if (!l) { l = new WeaponLook({ ...WEAPON_LOOK_DEFAULTS }, toon); looks.set(toon, l); }
  return l;
}

let frameStamp = -1;

/** An arsenal model for a kind on a side: the library's, with the boxes until it's loaded. */
export function libraryModel(kind: LauncherKind, toon: ToonLook, side: "left" | "right", fallback: () => ArsenalModel): ArsenalModel {
  const pick = KIND_MODELS[kind];
  const id = side === "left" ? entry(pick.id).mirror ?? pick.id : pick.id;
  const root = new THREE.Group();
  root.name = `weapon-${kind}`;
  const lampProxy = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9 });
  let boxes: ArsenalModel | null = null;
  let lib: WeaponModel | null = null;
  const out: ArsenalModel = {
    kind, root, muzzles: [], glow: [lampProxy], meshes: [], laserFrom: null,
    get recoil() { return lib ? lib.recoil : boxes ? boxes.recoil : root; },
  } as ArsenalModel;

  const fill = () => {
    if (lib) return;
    const look = weaponLookFor(toon);
    const w = createWeapon(id, look);
    // The arsenal draws its own targeting laser (from the emitter): no second beam from the model.
    w.laser?.dispose();
    w.laser = null;
    w.root.scale.multiplyScalar(pick.scale ?? 1);
    if (pick.tilt) w.root.rotation.x = -(pick.tilt * Math.PI) / 180;
    w.setElevation(1);
    if (boxes) { boxes.root.removeFromParent(); boxes = null; }
    root.add(w.root);
    lib = w;
    out.muzzles.splice(0, out.muzzles.length, ...w.muzzles);
    out.meshes.splice(0, out.meshes.length, ...w.meshes);
    out.laserFrom = w.sockets.Laser ?? null;
    out.glowPoints = w.glows;
    animate(w);
  };

  // The arsenal's cues -> the model's parts, once a frame before it draws.
  const animate = (w: WeaponModel) => {
    let last = performance.now(), lastKick = 0, sinceKick = 99, shot = 0, reload = 0;
    w.meshes[0].onBeforeRender = (renderer, _scene, camera) => {
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const info = (renderer as unknown as { info: { render: { frame: number } } }).info.render.frame;
      if (info !== frameStamp) { frameStamp = info; weaponLookFor(toon).update(camera as THREE.PerspectiveCamera, renderer.domElement.clientHeight); }
      const kick = w.recoil.position.length();
      if (kick > lastKick + 0.03) {
        // A shot: heat, the loaded rocket gone, the next missile out, a rack tube recoils.
        w.setHeat(w.heat + 0.25);
        sinceKick = 0;
        if (w.tubes) { w.setMissile(shot % w.tubes, 1, false); shot++; reload = 1.6; }
        if (w.has(`Tube_${shot % 8}`)) { w.setTube(shot % 8, 1); shot++; }
      }
      lastKick = kick;
      sinceKick += dt;
      w.setHeat(w.heat - dt / 4);
      for (let i = 0; w.has(`Tube_${i}`); i++) w.set(`Tube_${i}`, Math.max(0, 1 - sinceKick * 6));
      // Pods open while firing; everything reloads after a quiet spell.
      w.setDoors(sinceKick < 2.5 ? 1 : Math.max(0, 1 - (sinceKick - 2.5) * 2));
      w.setLid(Math.max(0, 1 - sinceKick * 3));
      if (reload > 0 && (reload -= dt) <= 0 && w.tubes) { for (let i = 0; i < w.tubes; i++) w.setMissile(i, 0, true); shot = 0; }
      w.setLamp(0.3 + lampProxy.opacity * 1.4);
    };
  };

  if (isLoaded(id)) fill();
  else {
    boxes = fallback();
    root.add(boxes.root);
    out.muzzles.push(...boxes.muzzles);
    out.meshes.push(...boxes.meshes);
    loadDef(id).then(fill, (e) => console.warn(`weapon model ${id}:`, e));
  }
  return out;
}

export { warm as weaponModelsReady };
