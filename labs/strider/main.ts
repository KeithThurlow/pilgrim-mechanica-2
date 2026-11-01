// Strider lab (Keith 2026-11-01): large, wiry white robots on the mech's own walker rig, scaled up
// (src/combat/strider.ts). They walk in to their range and strafe; red: the head's seeker sweeps until it sees you,
// then holds you; blue: a beam that ploughs a furrow down the sand where you stood, and up close a slam: a column
// straight down at its feet, a ring on the sand, then the ground blows out round it.
// Flags: ?count=N (striders up at once, 1), ?dist=m (where they stand up, 90 m), ?slam (one 14 m off, slamming at once),
// ?beam (one at 45 m, beam charging at once), plus the combat-lab flags.
import "../../src/core/lab.css";
import * as THREE from "three/webgpu";
import type { Param } from "../../src/core/tweaks";
import { combatLab } from "../../src/game/combatLab";
import { Striders, STRIDER_DEFAULTS, STRIDER_PARAMS, type Strider } from "../../src/combat/strider";
import { StriderBody } from "../../src/combat/striderBody";
import { StriderTarget } from "../../src/combat/striderTarget";
import { StriderFx } from "../../src/combat/striderFx";
import { striderRagdoll } from "../../src/combat/striderRagdoll";
import { fireRobotBeam } from "../../src/game/robotBeam";

const LAB_DEFAULTS = { striderCount: 1, striderFrom: 90, striderBack: 6, striderBeamReach: 5 };
const LAB_PARAMS: Param[] = [
  { key: "striderCount", label: "Striders up at once", min: 0, max: 6, step: 1, group: "Strider lab" },
  { key: "striderFrom", label: "They stand up at (m)", min: 20, max: 300, step: 5, group: "Strider lab" },
  { key: "striderBack", label: "Another after a kill (s)", min: 0, max: 60, step: 1, group: "Strider lab" },
  { key: "striderBeamReach", label: "Beam burns up to (m above ground)", min: 1, max: 15, step: 0.5, group: "Striders: beam" },
];

const q = new URLSearchParams(location.search);
const bodies = new Map<number, StriderBody>();
// eslint-disable-next-line prefer-const
let pack: Striders;
const lab = await combatLab({
  id: "strider-lab",
  title: "Striders",
  defaults: { ...STRIDER_DEFAULTS, ...LAB_DEFAULTS },
  params: [...LAB_PARAMS, ...STRIDER_PARAMS],
  topics: [{ id: "striders", label: "Striders", groups: ["Strider lab", "Striders", "Striders: beam", "Striders: slam"] }],
  selectables: [{ topic: "striders", label: "Striders", objects: () => [...bodies.values()].map((b) => b.root) }],
  actions: [{ label: "Strider now", onClick: () => spawn() }, { label: "Stand them up again", onClick: () => restart() }],
  report: (): Record<string, unknown> => ({ striders: pack.alive, beams: pack.beams, slams: pack.slams, kills: pack.kills }),
  onChange: (key) => { if (key === "striderScale") restart(); },
});
const { V, bf, player, field } = lab;
if (q.has("count")) V.striderCount = Number(q.get("count")) || 0;
if (q.has("dist")) V.striderFrom = Number(q.get("dist")) || V.striderFrom;
pack = new Striders(V, field, 1);
const target = new StriderTarget(pack, 3);
bf.targets.push(target);
bf.register.add(target);
const fx = new StriderFx(field);
lab.app.scene.add(fx.group);
let spawnSeed = 1;

function spawn(dist = V.striderFrom, angle?: number): Strider {
  // Seeded where they come from (the lab's own count), so a reload gives the same fight.
  const a = angle ?? ((spawnSeed++ * 2.39996) % (Math.PI * 2));
  const p = player.sim.pos;
  const x = p.x + Math.sin(a) * dist, z = p.z + Math.cos(a) * dist;
  const s = pack.spawn(x, z, Math.atan2(p.x - x, p.z - z));
  const body = new StriderBody();
  bodies.set(s.id, body);
  lab.app.scene.add(body.root);
  return s;
}
function drop(s: Strider) {
  pack.remove(s);
  const b = bodies.get(s.id);
  if (b) { lab.app.scene.remove(b.root); bodies.delete(s.id); }
}
function restart() { for (const s of [...pack.list]) drop(s); backClock = 0; }

const at = new THREE.Vector3();
let backClock = 0;
pack.onEvent = (e) => {
  if (e.type === "beam") {
    fx.beam(e.id, e.beam);
    fireRobotBeam(bf, e.beam, V.striderBeamReach);
    lab.shake(0.25);
  } else if (e.type === "slam") {
    fx.slam(e.id, e.x, e.y, e.z);
    bf.blast(3, at.set(e.x, e.y, e.z), e.radius, e.damage, e.pierce, "beam");
    const d = Math.hypot(player.sim.pos.x - e.x, player.sim.pos.z - e.z);
    lab.shake(d < e.radius * 2 ? 1 : 0.3);
  } else if (e.type === "footfall") {
    bf.dust.stomp(e.x, e.y, e.z, 0.5 * Math.min(1.5, e.k));
    const d = Math.hypot(player.sim.pos.x - e.x, player.sim.pos.z - e.z);
    if (d < 40) lab.shake(0.08 * (1 - d / 40));
  } else if (e.type === "down") {
    const s = pack.list.find((x) => x.id === e.id);
    if (!s) return;
    const r = striderRagdoll(s, field.height(s.pos(at).x, at.z));
    lab.deaths.ragdoll(r.parts, r.joints, r.x, r.y, r.z, r.yaw, { x: 0, y: 0, z: 0 }, 0, 0, 1);
    bf.blast(3, at.set(e.x, e.y, e.z), 6, 0, 0, "death");
    drop(s);
    backClock = V.striderBack;
  }
};

// ?slam: one close by, about to slam; ?beam: one at 45 m, its beam about to charge.
if (q.has("slam")) { V.striderCount = Math.max(1, V.striderCount); const s = spawn(14, 0.6); s.slamClock = 0; }
if (q.has("beam")) { V.striderCount = Math.max(1, V.striderCount); const s = spawn(45, -0.5); s.beamClock = 0.2; s.lockT = V.striderLockTime; }

const sees = (from: THREE.Vector3, to: THREE.Vector3) => bf.canSee(from, to);
const prey = { x: 0, y: 0, z: 0, vx: 0, vz: 0, alive: true };
lab.onFrame((dt) => {
  backClock -= dt;
  if (pack.list.length < V.striderCount && backClock <= 0) spawn();
  // Who it hunts: the mech, or the pilot on foot when he's nearer.
  const p0 = pack.list[0]?.pos(at);
  const pr = lab.prey(p0?.x ?? player.sim.pos.x, p0?.z ?? player.sim.pos.z);
  prey.x = pr.at.x; prey.y = pr.at.y; prey.z = pr.at.z; prey.vx = pr.sim.vel.x; prey.vz = pr.sim.vel.z; prey.alive = pr.alive;
  pack.update(dt, prey, sees);
  for (const s of pack.list) bodies.get(s.id)?.update(s, dt);
  fx.update(dt, pack.list);
  const s = pack.list[0];
  const mode = s ? ["walking", "beam charging", "slam charging", "standing", "down"][s.mode] : "none up";
  lab.hud("striders", `striders ${pack.alive} · ${mode}${s ? ` · ${Math.round(s.health)} hp · ${s.seen ? "sees you" : "seeking"}` : ""} · beams ${pack.beams} · slams ${pack.slams} · killed ${pack.kills} · hits body ${target.partHits[0]} leg ${target.partHits[1]} foot ${target.partHits[2]}`);
});
