// The shell every combat lab shares: streamed dunes and desert light, the battlefield (dust, marks, gun effects,
// sound), the player's Rampart on twin-stick controls (WASD legs, mouse aim, left button fires, R resupplies), the
// iso game camera, the slider panel with topics and hold-V selection, the Report box, a hull bar and a red edge when
// hit, and a demo that walks loops and shoots the nearest enemy until you take over. A lab adds its enemies.
import * as THREE from "three/webgpu";
import { createApp, type App } from "../core/app";
import { installReport } from "../core/report";
import { Selector } from "../core/select";
import { tweakPanel, type Param } from "../core/tweaks";
import { Keys } from "../core/input";
import { IsoCamera, ISO_DEFAULTS, ISO_PARAMS } from "../core/isoCamera";
import { DuneField, TERRAIN_DEFAULTS, TERRAIN_PARAMS } from "../world/terrain";
import { TerrainStreamer, STREAM_DEFAULTS, STREAM_PARAMS } from "../world/chunks";
import { DesertLook, LOOK_DEFAULTS, LOOK_PARAMS } from "../world/look";
import { screenToGround } from "../world/raycast";
import { WALKER_DEFAULTS, WALKER_PARAMS } from "../mech/walkerTuning";
import { UPPER_DEFAULTS, UPPER_PARAMS, type Aim } from "../mech/upper";
import type { MoveCommand } from "../mech/walker";
import { LEG_TYPES } from "../mech/legTypes";
import { RampartBody } from "../mech/rampart";
import { ToonLook, TOON_DEFAULTS, TOON_PARAMS } from "../look/toon";
import { MARK_DEFAULTS, MARK_PARAMS } from "../fx/sandMarks";
import { MINIGUN_FX_DEFAULTS, MINIGUN_FX_PARAMS } from "../fx/minigun";
import { DUST_DEFAULTS, DUST_PARAMS } from "../fx/dust";
import { SFX_DEFAULTS, SFX_PARAMS } from "../audio/sfx";
import { Battlefield } from "./battlefield";
import { MechUnit, MECH_DEFAULTS, MECH_PARAMS } from "./mechUnit";

export const BASE_DEFAULTS = {
  ...WALKER_DEFAULTS, ...UPPER_DEFAULTS, ...MINIGUN_FX_DEFAULTS, ...SFX_DEFAULTS, ...TOON_DEFAULTS, ...ISO_DEFAULTS,
  ...TERRAIN_DEFAULTS, ...STREAM_DEFAULTS, ...LOOK_DEFAULTS, ...DUST_DEFAULTS, ...MARK_DEFAULTS, ...MECH_DEFAULTS,
  radius: 4, shadowBox: 40,
};
export type BaseValues = typeof BASE_DEFAULTS;
const BASE_PARAMS: Param[] = [...MECH_PARAMS, ...WALKER_PARAMS, ...UPPER_PARAMS, ...MINIGUN_FX_PARAMS, ...DUST_PARAMS, ...MARK_PARAMS, ...SFX_PARAMS, ...TOON_PARAMS, ...ISO_PARAMS, ...TERRAIN_PARAMS, ...STREAM_PARAMS, ...LOOK_PARAMS];

export interface SelectEntry { topic: string; label: string; objects: () => THREE.Object3D[] }

export interface CombatLabOptions<E extends object> {
  id: string;
  title: string;
  /** The lab's own tuning (merged into the shared values; keys must not clash). */
  defaults: E;
  params: Param[];
  /** The lab's own topics, shown before the shared ones. */
  topics: { id: string; label: string; groups: string[] }[];
  /** Hold-V entries for the lab's enemies (called when V is held, so they can list things made later). */
  selectables?: SelectEntry[];
  actions?: { label: string; onClick: () => void; active?: () => boolean }[];
  /** Extra things for the Report (e.g. wave number). */
  report?: () => Record<string, unknown>;
}

export interface CombatLab<E extends object> {
  app: App;
  V: BaseValues & E;
  field: DuneField;
  bf: Battlefield;
  toon: ToonLook;
  player: MechUnit;
  /** Set by the lab: where the demo should shoot (the nearest live enemy), or null. */
  nearestEnemy: () => THREE.Vector3 | null;
  /** The lab's per-frame work, after the player has moved and before the effects draw. */
  onFrame: (fn: (dt: number) => void) => void;
  /** Extra HUD line. */
  hud: (key: string, text: string) => void;
  /** Load another Rampart (bandit mechs). */
  loadRampart: () => Promise<RampartBody>;
}

export async function combatLab<E extends object>(o: CombatLabOptions<E>): Promise<CombatLab<E>> {
  const app = await createApp(document.getElementById("view")!);
  const { scene, camera, params } = app;
  const canvas = app.renderer.domElement;
  const V = { ...BASE_DEFAULTS, ...o.defaults } as BaseValues & E;
  const DEFAULTS = { ...V };

  const toon = new ToonLook(V);
  const field = new DuneField(V);
  if (params.has("flat")) { field.v = { ...V, height: 0, swell: 0, bumps: 0 }; field.update(); }
  const streamer = new TerrainStreamer(field, V);
  scene.add(streamer.group);
  const look = new DesertLook(scene, app.renderer, V);
  const bf = new Battlefield(field, V, camera);
  scene.add(bf.group);

  const body = await RampartBody.load(toon);
  Object.assign(V, LEG_TYPES.rampart.values, body.legValues());
  Object.assign(DEFAULTS, LEG_TYPES.rampart.values, body.legValues());
  scene.add(body.root);
  const player = new MechUnit(bf, V, body, toon, 1, 0, true);
  bf.targets.push(player);

  const iso = new IsoCamera(camera, canvas, V);
  const keys = new Keys();
  let auto = !params.has("manual");
  let mouse: { x: number; y: number } | null = null;
  let mouseDown = false;
  canvas.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") { mouse = { x: e.clientX, y: e.clientY }; auto = false; } });
  canvas.addEventListener("pointerdown", (e) => { if (e.button === 0 && e.pointerType === "mouse") { mouseDown = true; auto = false; } });
  addEventListener("pointerup", () => { mouseDown = false; });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  const shapeKeys = new Set([...TERRAIN_PARAMS.map((p) => p.key), "chunkSize", "segments"]);
  let selector: Selector | null = null;
  let picking = false;
  const panel = tweakPanel({
    id: o.id,
    title: o.title,
    params: [...o.params, ...BASE_PARAMS],
    values: V,
    defaults: DEFAULTS,
    actions: [{ label: "Demo", onClick: () => { auto = !auto; }, active: () => auto }, ...(o.actions ?? [])],
    topics: [
      ...o.topics,
      { id: "mech", label: "Your mech", groups: ["Mech health", "Torso & guns", "Minigun", "Move"] },
      { id: "legs", label: "Legs", groups: ["Move", "Gait", "Legs", "Feet", "Terrain"] },
      { id: "hits", label: "Hits and dust", groups: ["Minigun hits", "Minigun FX", "Dust", "Dust: look", "Dust: sources", "Sand marks", "Sound"] },
      { id: "dunes", label: "Dunes", groups: ["Dunes", "Shape", "Sand surface", "Streaming"] },
      { id: "light", label: "Light", groups: ["Look", "Cel look"] },
      { id: "camera", label: "Camera", groups: ["Camera"] },
    ],
    onFocus: () => { if (!picking) selector?.clear(); },
    onChange: (k) => { if (shapeKeys.has(k)) { field.update(); streamer.rebuildAll(); } },
  });
  const regions = body.regions();
  selector = new Selector(app, {
    items: [
      { topic: "legs", label: "Legs", objects: () => regions.legs },
      { topic: "mech", label: "Your mech", objects: () => [...regions.hull, ...regions.gunLeft, ...regions.gunRight] },
      ...(o.selectables ?? []),
    ],
    ground: { topic: "dunes", label: "Dunes", field },
    sky: { topic: "light", label: "Light and sky" },
    onPick: (topic) => { picking = true; panel.focus(topic); picking = false; },
  });
  const sel = selector;
  installReport(app, o.id.replace(/-lab$/, ""), V, () => ({ selected: sel.selection, topic: panel.focused, hull: Math.round(player.health), ...(o.report?.() ?? {}) }));
  Object.assign(V, body.legValues());
  panel.refresh();

  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.75, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffb347, depthTest: false, transparent: true, opacity: 0.9, toneMapped: false }),
  );
  reticle.renderOrder = 10;
  scene.add(reticle);
  const hurtEl = document.createElement("div");
  hurtEl.className = "hurt";
  document.body.appendChild(hurtEl);

  field.update();
  player.reset(0, 0, 0);
  streamer.fill(0, 0);
  const follow = player.sim.pelvis.clone();
  iso.snap(follow);
  if (params.has("zoom")) iso.setDistance(Number(params.get("zoom")));
  const stick = new THREE.Vector3(), aimPt = new THREE.Vector3();
  let clock = 0;
  const frames: ((dt: number) => void)[] = [];

  const lab: CombatLab<E> = {
    app, V, field, bf, toon, player,
    nearestEnemy: () => null,
    onFrame: (fn) => frames.push(fn),
    hud: (k, t) => app.hud.set(k, t),
    loadRampart: () => RampartBody.load(toon),
  };

  /** Demo: slow loops, aim at the nearest enemy, fire when it's in range. */
  function demo(t: number): { cmd: MoveCommand; aim: Aim | null; trigger: boolean } {
    const a = t * 0.12;
    const cmd = { x: Math.sin(a), z: Math.cos(a), sprint: false };
    const e = lab.nearestEnemy();
    if (!e) return { cmd, aim: null, trigger: false };
    return { cmd, aim: { x: e.x, y: e.y, z: e.z }, trigger: e.distanceTo(player.sim.pos) < V.range + 5 };
  }

  const fixedDt = params.has("dt") ? Number(params.get("dt")) : 0;
  app.onTick((rawDt) => {
    const dt = fixedDt || rawDt;
    clock += dt;
    keys.move(camera, stick);
    if (keys.has("KeyR") || (auto && player.upper.guns[0].ammo < 100)) player.upper.resupply();
    if (stick.lengthSq() > 0 || keys.has("KeyF")) auto = false;
    let cmd: MoveCommand = { x: 0, z: 0, sprint: false };
    let aim: Aim | null = null;
    let trigger = false;
    if (auto) ({ cmd, aim, trigger } = demo(clock));
    else {
      if (stick.lengthSq() > 0) cmd = { x: stick.x, z: stick.z, sprint: keys.sprint };
      if (mouse && screenToGround(mouse.x, mouse.y, canvas, camera, field, aimPt)) aim = { x: aimPt.x, y: aimPt.y + 1, z: aimPt.z };
      trigger = mouseDown || keys.has("KeyF");
    }
    if (sel.active) trigger = false;

    player.step(dt, cmd, aim, trigger);
    if (!player.alive && player.deadFor > V.respawn) player.reset(player.sim.pos.x, player.sim.pos.z, player.sim.heading);
    for (const f of frames) f(dt);
    hurtEl.style.opacity = String(Math.min(0.9, player.hurt / 60));

    reticle.visible = !!aim;
    if (aim) {
      reticle.position.set(aim.x, field.height(aim.x, aim.z) + 0.06, aim.z);
      (reticle.material as THREE.MeshBasicMaterial).color.setHex(player.upper.onTarget ? 0xffb347 : 0x9a958c);
    }

    follow.lerp(new THREE.Vector3(player.sim.pelvis.x, player.sim.pelvis.y - 1.2, player.sim.pelvis.z), Math.min(1, rawDt * 6));
    iso.update(follow, rawDt);
    toon.update(camera, canvas.clientHeight);
    streamer.update(player.sim.pos.x, player.sim.pos.z);
    const camDist = camera.position.distanceTo(follow);
    look.update(follow, camDist + V.radius * V.chunkSize, Math.max(1, camDist / 40));
    bf.update(dt, camera, look);

    const hull = Math.max(0, Math.round(player.health));
    const bar = "█".repeat(Math.round((hull / player.maxHealth) * 20)).padEnd(20, "·");
    app.hud.set("hull", `hull ${bar} ${hull}/${player.maxHealth}${player.alive ? "" : ` · destroyed, rebuilt in ${Math.max(0, V.respawn - player.deadFor).toFixed(1)} s`}${auto ? " · demo" : ""}`);
    app.hud.set("guns", `ammo L ${player.upper.guns[0].ammo} R ${player.upper.guns[1].ammo} · dust ${bf.dust.alive}${bf.sfx.running ? "" : " · click for sound"}`);
  });
  return lab;
}
