// Item models from public/models/parts/ (tools/blender/parts/items.py, asset batch 6) swapped into the arsenal's code
// models once they load: a sword's hilt and blade by its base id, a shoulder feed's, the capacitor bank's or a strike's body, and
// the summoner shoulders (drone rack, swarm hive), which have no weapon model of their own. The box stand-ins show until
// the GLB loads and stay when there is none (headless checks, a missing file). Drawing only.
import * as THREE from "three/webgpu";
import type { ToonLook } from "../look/toon";
import type { WeaponModel } from "./models";
import { dressPart, partFromGlb, partGlb } from "../mech/partModels";
import { BASE_BY_ID } from "../items/bases";

/** The model's meshes, not the outline shells the unit look hangs on them. */
function meshesOf(o: THREE.Object3D) {
  const out: THREE.Mesh[] = [];
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh && !(c.parent as THREE.Mesh | null)?.isMesh) out.push(c as THREE.Mesh); });
  return out;
}

/** A lamp the arsenal can dim (it sets every glow material's opacity each frame), keeping the model's lamp colours. */
const lamp = () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, opacity: 0.9 });

/**
 * A sword's model by its base id: the GLB's hilt in the swing, its `Blade` node in the blade group, divided by its own
 * length (it's built at its base's true length, from the stand-in blade's start 0.46 m ahead of the hand) so the
 * arsenal's stretch to the live reach still fits, and its lit edge on the edge material the arsenal drives. The blade
 * is built at its base's heft, kept in `sword.heft` for the arsenal to divide out of the rolled heft.
 */
export function swordFromGlb(m: WeaponModel, base: string, look: ToonLook) {
  m.base = base;
  const ms = m.sword;
  if (!ms) return;
  void partGlb(base).then((scene) => {
    if (!scene || m.base !== base) return;
    const copy = scene.clone(true);
    dressPart(copy, look);
    const node = copy.getObjectByName("Blade");
    if (!node) return;
    node.removeFromParent();
    node.position.set(0, 0, 0);
    node.updateMatrixWorld(true);
    const L = Math.max(0.1, new THREE.Box3().setFromObject(node).max.z);
    const inner = new THREE.Group();
    inner.scale.z = 1 / L;
    inner.add(node);
    node.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.userData.glow) (o as THREE.Mesh).material = ms.edge; });
    for (const c of [...ms.swing.children]) if (c !== ms.blade) ms.swing.remove(c);
    ms.blade.clear();
    ms.blade.add(inner);
    ms.swing.add(copy);
    const own = [...meshesOf(copy), ...meshesOf(node)];
    ms.heft = BASE_BY_ID[base]?.stats.heft?.base ?? 1;
    m.meshes.length = 0;
    m.meshes.push(...own);
  });
}

/** A shoulder feed's, the capacitor bank's or a strike's model by base id: the GLB in place of the boxes, its lamps the glow. */
export function gearFromGlb(m: WeaponModel, base: string, look: ToonLook) {
  m.base = base;
  void partGlb(base).then((scene) => {
    if (!scene || m.base !== base) return;
    const part = partFromGlb(scene, look);
    const lamps: THREE.MeshBasicMaterial[] = [];
    part.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.userData.glow) { const mat = lamp(); (o as THREE.Mesh).material = mat; lamps.push(mat); } });
    // The boxes out; the muzzles (and the groups holding them) stay, the first moved to the GLB's Muzzle socket.
    const boxes: THREE.Object3D[] = [];
    m.recoil.traverse((o) => { if ((o as THREE.Mesh).isMesh && !(o.parent as THREE.Mesh | null)?.isMesh) boxes.push(o); });
    for (const o of boxes) o.removeFromParent();
    m.recoil.add(part);
    const sock = part.getObjectByName("Muzzle"), mz = m.muzzles[0];
    if (sock && mz) {
      m.recoil.updateWorldMatrix(true, true);
      const at = m.recoil.worldToLocal(sock.getWorldPosition(new THREE.Vector3()));
      m.recoil.add(mz);
      mz.position.copy(at);
      mz.quaternion.identity();
    }
    m.glow.length = 0;
    m.glow.push(...lamps);
    m.meshes.length = 0;
    m.meshes.push(...meshesOf(part));
  });
}

/** A shoulder item with no weapon model (the drone rack, the swarm hive): a group that fills once its GLB loads. */
export function shoulderPart(base: string, look: ToonLook): THREE.Group {
  const g = new THREE.Group();
  g.name = `shoulder-${base}`;
  void partGlb(base).then((scene) => { if (scene) g.add(partFromGlb(scene, look)); });
  return g;
}
