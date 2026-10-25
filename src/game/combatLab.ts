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
import { UPPER_DEFAULTS, UPPER_PARAMS, type Aim, type Trigger } from "../mech/upper";
import type { MoveCommand } from "../mech/walker";
import { LEG_TYPES } from "../mech/legTypes";
import { RampartBody, mechLegType } from "../mech/rampart";
import { ToonLook, TOON_DEFAULTS, TOON_PARAMS } from "../look/toon";
import { MARK_DEFAULTS, MARK_PARAMS } from "../fx/sandMarks";
import { MINIGUN_FX_DEFAULTS, MINIGUN_FX_PARAMS } from "../fx/minigun";
import { DUST_DEFAULTS, DUST_PARAMS } from "../fx/dust";
import { SHELL_FX_DEFAULTS, SHELL_FX_PARAMS } from "../fx/shellsDraw";
import { WATER_FX_DEFAULTS, WATER_FX_PARAMS } from "../fx/water";
import { BIOME_DEFAULTS, BIOME_PARAMS } from "../world/biomes";
import { ROCK_DEFAULTS, ROCK_PARAMS } from "../world/rock";
import { SHALLOWS_DEFAULTS, SHALLOWS_PARAMS } from "../world/shallows";
import { CraterLayer, CRATER_DEFAULTS, CRATER_PARAMS, HARDNESS_KEYS } from "../world/craters";
import { SFX_DEFAULTS, SFX_PARAMS } from "../audio/sfx";
import { Battlefield } from "./battlefield";
import { MechUnit, MECH_DEFAULTS, MECH_PARAMS } from "./mechUnit";
import { DeathPhysics, DEATH_DEFAULTS, DEATH_PARAMS, initPhysics } from "../physics/deaths";
import { DeadDraw } from "../physics/deadDraw";
import { Targeting, TARGET_DEFAULTS, TARGET_PARAMS, type TargetCandidate } from "./targeting";
import { WEAPON_DEFAULTS, WEAPON_PARAMS, WEAPON_TOPIC } from "../weapons/tuning";
import { Arsenal } from "../weapons/arsenal";
import { ArsenalDraw } from "../weapons/arsenalDraw";
import type { Costs } from "../core/costs";

export const BASE_DEFAULTS = {
  ...WALKER_DEFAULTS, ...UPPER_DEFAULTS, ...MINIGUN_FX_DEFAULTS, ...SFX_DEFAULTS, ...TOON_DEFAULTS, ...ISO_DEFAULTS,
  ...TERRAIN_DEFAULTS, ...STREAM_DEFAULTS, ...LOOK_DEFAULTS, ...DUST_DEFAULTS, ...MARK_DEFAULTS, ...MECH_DEFAULTS,
  ...DEATH_DEFAULTS, ...TARGET_DEFAULTS, ...SHELL_FX_DEFAULTS, ...WATER_FX_DEFAULTS, ...BIOME_DEFAULTS, ...ROCK_DEFAULTS, ...SHALLOWS_DEFAULTS, ...CRATER_DEFAULTS, ...WEAPON_DEFAULTS, biomeOnly: 0, radius: 4, shadowBox: 40,
};
export type BaseValues = typeof BASE_DEFAULTS;
const BASE_PARAMS: Param[] = [...WEAPON_PARAMS, ...TARGET_PARAMS, ...DEATH_PARAMS, ...MECH_PARAMS, ...WALKER_PARAMS, ...UPPER_PARAMS, ...MINIGUN_FX_PARAMS, ...DUST_PARAMS, ...SHELL_FX_PARAMS, ...WATER_FX_PARAMS, ...MARK_PARAMS, ...BIOME_PARAMS, ...ROCK_PARAMS, ...SHALLOWS_PARAMS, ...SFX_PARAMS, ...TOON_PARAMS, ...ISO_PARAMS, ...TERRAIN_PARAMS, ...CRATER_PARAMS, ...STREAM_PARAMS, ...LOOK_PARAMS];

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
  /** Called with the dune field before any ground is streamed (e.g. to add ground modifiers). */
  setup?: (field: DuneField, values: BaseValues & E) => void;
  /** The lab's own demo: what the mech does while the demo runs (null: the shared demo this frame). No demo dashes. */
  demo?: (t: number, dt: number) => { cmd: MoveCommand; aim: Aim | null; trigger: Trigger; keys?: readonly boolean[]; lock?: TargetCandidate | null } | null;
  /** After any slider changes (after the shared handling, e.g. the dunes rebuilt). */
  onChange?: (key: string) => void;
}

export interface CombatLab<E extends object> {
  app: App;
  V: BaseValues & E;
  field: DuneField;
  bf: Battlefield;
  toon: ToonLook;
  player: MechUnit;
  /** Set by the lab: every live enemy the guns could take (centre of mass, radius, a stable key). */
  targets: () => TargetCandidate[];
  /** The lab's per-frame work, after the player has moved and before the effects draw. */
  onFrame: (fn: (dt: number) => void) => void;
  /** Extra HUD line. */
  hud: (key: string, text: string) => void;
  /** Death physics: ragdolls and wrecks (Rapier). */
  deaths: DeathPhysics;
  /** Load another Rampart (bandit mechs). */
  loadRampart: () => Promise<RampartBody>;
  /** The terrain chunks (rebuildArea after the ground changes). */
  streamer: TerrainStreamer;
  /** Blast craters in the ground (bf.dent adds one). */
  craters: CraterLayer;
  /** Is the demo driving? */
  demoOn: () => boolean;
  /** Show the values again after the lab changed them (e.g. a loadout fitted). */
  refresh: () => void;
  /** The player's weapons other than the miniguns (src/weapons): fitted through the loadout. */
  arsenal: Arsenal;
  /** Shake the camera (decays by itself). */
  shake: (k: number) => void;
  /** Set by a lab to split the frame into stages (src/core/costs.ts): the shell marks its own; a lab's onFrame marks
   * what it adds. The averaged line shows in the HUD. */
  costs: Costs | null;
}

export async function combatLab<E extends object>(o: CombatLabOptions<E>): Promise<CombatLab<E>> {
  const app = await createApp(document.getElementById("view")!);
  const { scene, camera, params } = app;
  const canvas = app.renderer.domElement;
  const V = { ...BASE_DEFAULTS, ...o.defaults } as BaseValues & E;
  // ?biome=mix|desert|rocky|shallows (desert by default).
  { const b = new URLSearchParams(location.search).get("biome"); if (b) (V as { biomeOnly: number }).biomeOnly = ({ mix: -1, desert: 0, rocky: 1, shallows: 2 } as Record<string, number>)[b] ?? 0; }
  const DEFAULTS = { ...V };

  const toon = new ToonLook(V);
  const field = new DuneField(V);
  if (params.has("flat")) { field.v = { ...V, height: 0, swell: 0, bumps: 0 }; field.update(); }
  o.setup?.(field, V);
  const streamer = new TerrainStreamer(field, V);
  scene.add(streamer.group);
  const look = new DesertLook(scene, app.renderer, V);
  const bf = new Battlefield(field, V, camera);
  scene.add(bf.group);
  await initPhysics();
  const deaths = new DeathPhysics(V, field);
  // Blast craters as real ground: a layer in the height function; the chunks under a new one are patched in place.
  const craters = new CraterLayer(V, field);
  field.dents = craters;
  bf.craters = craters;
  let patchMs = 0, patchN = 0;
  const groundChanged = (x0: number, z0: number, x1: number, z1: number) => {
    const t0 = performance.now();
    streamer.patchArea(x0, z0, x1, z1);
    patchMs = performance.now() - t0; patchN++;
    deaths.groundChanged();
  };
  bf.onGround = groundChanged;
  const deadDraw = new DeadDraw(deaths);
  scene.add(deadDraw.group);

  const body = await RampartBody.load(toon);
  Object.assign(V, LEG_TYPES[mechLegType()].values, body.legValues());
  Object.assign(DEFAULTS, LEG_TYPES[mechLegType()].values, body.legValues());
  scene.add(body.root);
  const player = new MechUnit(bf, V, body, toon, 1, 0, true);
  bf.targets.push(player);
  // The weapons that aren't miniguns: nothing until a loadout fits one (src/game/loadoutApply.ts).
  const arsenal = new Arsenal(bf, player, V, toon, () => lab.targets());
  player.weapons = arsenal;
  const arsenalDraw = new ArsenalDraw(arsenal, field);
  scene.add(arsenalDraw.group);
  // Camera shake: rail shots and launches ask for it; every blast near the mech shakes by its size and distance.
  let shakeK = 0;
  const shake = (k: number) => { shakeK = Math.max(shakeK, k); };
  arsenal.onShake = shake;
  bf.onBlast = (at, radius) => {
    bf.sfx.playSound("blast", at, Math.min(1.2, 0.5 + radius / 6), 0.85 + Math.random() * 0.2);
    const d = Math.hypot(at.x - player.sim.pos.x, at.z - player.sim.pos.z);
    if (d < V.blastShakeReach) shake(V.blastShake * (radius / 2.5) * (1 - d / V.blastShakeReach));
  };

  const iso = new IsoCamera(camera, canvas, V);
  const keys = new Keys();
  let auto = !params.has("manual");
  let mouse: { x: number; y: number } | null = null;
  let mouseDown = false, rightDown = false;
  // Left click fires the left side's weapon, right click the right side's (Keith 2026-10-25); F fires both.
  // Read both buttons from the `buttons` bitmask on every pointer event: a browser sends pointerdown/up only for the
  // first button pressed and the last released, and a second button pressed while one is held arrives as a
  // pointermove, so tracking `button` on down/up lost the second gun (Keith 2026-10-25: couldn't hold both).
  // A button starts firing only when it goes down over the canvas (so dragging a slider onto the field doesn't fire);
  // a release counts anywhere.
  let lastButtons = 0;
  const readButtons = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const pressed = e.buttons & ~lastButtons;
    lastButtons = e.buttons;
    if (e.target === canvas) {
      if (pressed & 1) { mouseDown = true; auto = false; }
      if (pressed & 2) { rightDown = true; auto = false; }
    }
    if (!(e.buttons & 1)) mouseDown = false;
    if (!(e.buttons & 2)) rightDown = false;
  };
  canvas.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") { mouse = { x: e.clientX, y: e.clientY }; auto = false; } });
  addEventListener("pointerdown", readButtons);
  addEventListener("pointermove", readButtons);
  addEventListener("pointerup", readButtons);
  addEventListener("blur", () => { mouseDown = false; rightDown = false; lastButtons = 0; });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  // Space: dash the way WASD points (Keith 2026-10-24), on charges.
  let dashPressed = false, spaceDown = false;
  addEventListener("keydown", (e) => {
    if (e.code !== "Space" || e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    dashPressed = true;
    spaceDown = true;
    auto = false;
  });
  addEventListener("keyup", (e) => { if (e.code === "Space") spaceDown = false; });
  addEventListener("blur", () => { spaceDown = false; });

  const shapeKeys = new Set([...TERRAIN_PARAMS, ...BIOME_PARAMS, ...ROCK_PARAMS, ...SHALLOWS_PARAMS].filter((p) => p.onRelease).map((p) => p.key).concat(["chunkSize", "segments"]));
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
      { id: "mech", label: "Your mech", groups: ["Targeting", "Rounds", "Dash", "Mech health", "Torso & guns", "Minigun", "Move"] },
      WEAPON_TOPIC,
      { id: "legs", label: "Legs", groups: ["Move", "Gait", "Legs", "Feet", "Terrain"] },
      { id: "deaths", label: "Deaths", groups: ["Death physics"] },
      { id: "hits", label: "Hits and dust", groups: ["Water effects", "Telegraphs", "Minigun hits", "Minigun FX", "Dust", "Dust: look", "Dust: sources", "Sand marks", "Sound"] },
      { id: "dunes", label: "Dunes", groups: ["Dunes", "Shape", "Craters", "Sand surface", "Streaming"] },
      { id: "biomes", label: "Biomes", groups: ["Biome map", "Rocky ground", "Shallows"] },
      { id: "light", label: "Light", groups: ["Look", "Cel look"] },
      { id: "camera", label: "Camera", groups: ["Camera"] },
    ],
    onFocus: () => { if (!picking) selector?.clear(); },
    onChange: (k) => {
      if (shapeKeys.has(k)) { field.update(); craters.invalidate(); streamer.rebuildAll(); }
      else if (HARDNESS_KEYS.includes(k)) { const b = craters.invalidate(); if (b) groundChanged(b[0], b[1], b[2], b[3]); }
      o.onChange?.(k);
    },
  });
  const regions = body.regions();
  selector = new Selector(app, {
    items: [
      { topic: "legs", label: "Legs", objects: () => regions.legs },
      { topic: "weapons", label: "Weapons", objects: () => arsenal.meshes() },
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
  const lockMat = new THREE.LineBasicMaterial({ color: 0xff6a3d, depthTest: false, transparent: true, toneMapped: false });
  const lockMark = new THREE.LineSegments(lockBrackets(), lockMat);
  lockMark.renderOrder = 11;
  scene.add(lockMark);
  const hurtEl = document.createElement("div");
  hurtEl.className = "hurt";
  document.body.appendChild(hurtEl);

  field.update();
  player.reset(0, 0, 0);
  // The hub's biome picker wins over a saved slider.
  { const b = new URLSearchParams(location.search).get("biome"); if (b) { (V as { biomeOnly: number }).biomeOnly = ({ mix: -1, desert: 0, rocky: 1, shallows: 2 } as Record<string, number>)[b] ?? 0; field.update(); } }
  streamer.fill(0, 0);
  // ?craters=N: N blasts round the start (one right under the mech), to see craters without waiting for a fight.
  if (params.has("craters")) {
    const n = Math.max(1, Number(params.get("craters")) || 6);
    for (let i = 0; i < n; i++) {
      const a = i * 2.4, r = i === 0 ? 0 : 7 + i * 2.2, x = Math.sin(a) * r, z = Math.cos(a) * r, size = i === 0 ? 5 : 3 + (i % 3) * 1.5;
      if (bf.dent(x, z, size)) bf.marks.crater(x, z, 4 * size / 3);
    }
    player.reset(0, 0, 0);
  }
  const follow = player.sim.pelvis.clone();
  iso.snap(follow);
  if (params.has("zoom")) iso.setDistance(Number(params.get("zoom")));
  const stick = new THREE.Vector3(), aimPt = new THREE.Vector3();
  let clock = 0;
  const frames: ((dt: number) => void)[] = [];

  const lab: CombatLab<E> = {
    app, V, field, bf, toon, player, deaths,
    targets: () => [],
    onFrame: (fn) => frames.push(fn),
    hud: (k, t) => app.hud.set(k, t),
    loadRampart: () => RampartBody.load(toon),
    streamer,
    craters,
    demoOn: () => auto,
    refresh: () => panel.refresh(),
    arsenal,
    shake,
    costs: null,
  };

  // For headless debugging and tests: the lab on the page (window.__lab).
  (globalThis as unknown as { __lab: unknown }).__lab = lab;
  let lastDemo: { aim: Aim | null; trigger: Trigger } = { aim: null, trigger: false };
  (lab as unknown as { demoState: () => unknown }).demoState = () => lastDemo;

  /** Demo: slow loops, aim at the nearest enemy, fire when it's in range. */
  function demo(t: number, cands: TargetCandidate[]): { cmd: MoveCommand; aim: Aim | null; trigger: boolean } {
    const a = t * 0.12;
    const cmd = { x: Math.sin(a), z: Math.cos(a), sprint: false };
    const p = player.sim.pos;
    let e: TargetCandidate | null = null, bd = Infinity;
    for (const c of cands) { const d = Math.hypot(c.x - p.x, c.z - p.z); if (d < bd) { bd = d; e = c; } }
    if (!e) return { cmd, aim: null, trigger: false };
    return { cmd, aim: { x: e.x + (e.vx ?? 0) * V.lockLead, y: e.y, z: e.z + (e.vz ?? 0) * V.lockLead }, trigger: bd < V.range + 5 };
  }
  const targeting = new Targeting();
  const ndc = new THREE.Vector2(), caster = new THREE.Raycaster();
  let lock: ReturnType<Targeting["pick"]> = null;

  const fixedDt = params.has("dt") ? Number(params.get("dt")) : 0;
  app.onTick((rawDt) => {
    const dt = fixedDt || rawDt;
    const cst = lab.costs;
    cst?.begin();
    bf.costs = cst;
    clock += dt;
    keys.move(camera, stick);
    if (keys.has("KeyR") || (auto && player.upper.guns[0].ammo < 100)) player.upper.resupply();
    if (stick.lengthSq() > 0 || keys.has("KeyF")) auto = false;
    let cmd: MoveCommand = { x: 0, z: 0, sprint: false };
    let aim: Aim | null = null;
    let trigger: Trigger = false;
    let cursor: Aim | null = null;
    let shotAt: Aim | null = null;
    // Shoulder weapon keys 1-4: hold to paint, release to fire.
    let held: [boolean, boolean, boolean, boolean] = [false, false, false, false];
    let demoLock: TargetCandidate | null = null;
    lock = null;
    const own = auto && o.demo ? o.demo(clock, dt) : null;
    if (own) { ({ cmd, aim, trigger } = own); held = [0, 1, 2, 3].map((i) => !!own.keys?.[i]) as typeof held; demoLock = own.lock ?? null; lastDemo = { aim, trigger }; cursor = aim; }
    else if (auto) { ({ cmd, aim, trigger } = demo(clock, lab.targets())); lastDemo = { aim, trigger }; cursor = aim; }
    else {
      if (stick.lengthSq() > 0) cmd = { x: stick.x, z: stick.z, sprint: keys.sprint };
      if (mouse && screenToGround(mouse.x, mouse.y, canvas, camera, field, aimPt)) {
        cursor = aim = { x: aimPt.x, y: aimPt.y + 1, z: aimPt.z };
        // Soft lock: the guns take the enemy under the cursor ray, else the one nearest the line of fire.
        const r = canvas.getBoundingClientRect();
        ndc.set(((mouse.x - r.left) / r.width) * 2 - 1, -((mouse.y - r.top) / r.height) * 2 + 1);
        caster.setFromCamera(ndc, camera);
        lock = targeting.pick(lab.targets(), { rayO: caster.ray.origin, rayD: caster.ray.direction, from: player.sim.pos, cursor: aimPt, range: V.range }, V);
        if (lock) {
          // Lead it: the arms trail their aim as they track, so swing them to where it will be by then. The rounds
          // fly from the muzzle straight at the target itself (shotAt), so they don't land ahead of it.
          const t = lock.target, L = V.lockLead;
          shotAt = { x: t.x, y: t.y, z: t.z };
          aim = { x: t.x + (t.vx ?? 0) * L, y: t.y, z: t.z + (t.vz ?? 0) * L };
        }
      }
      const both = keys.has("KeyF");
      trigger = [mouseDown || both, rightDown || both];
      held = [keys.has("Digit1"), keys.has("Digit2"), keys.has("Digit3"), keys.has("Digit4")];
      if (held.some(Boolean)) auto = false;
    }
    if (sel.active) { trigger = false; held = [false, false, false, false]; }
    player.keys = held;
    player.cursor = cursor ? (player.cursor ?? new THREE.Vector3()).set(cursor.x, field.height(cursor.x, cursor.z), cursor.z) : null;
    player.lock = lock?.target ?? demoLock;

    if (dashPressed) {
      dashPressed = false;
      // With no keys held, dash the way the legs face.
      if (stick.lengthSq() > 0.01) player.tryDash(stick.x, stick.z);
      else player.tryDash(Math.sin(player.sim.heading), Math.cos(player.sim.heading));
    }
    // The demo sidesteps now and then, to show the dash off.
    if (auto && !o.demo && clock % 7 < dt && clock > 3) player.tryDash(Math.cos(player.sim.heading), -Math.sin(player.sim.heading));
    player.dashHold = spaceDown && !auto;
    cst?.mark("input + lock");
    player.step(dt, cmd, aim, trigger, shotAt ?? aim);
    if (!player.alive && player.deadFor > V.respawn) player.reset(player.sim.pos.x, player.sim.pos.z, player.sim.heading);
    cst?.mark("mech + weapons");
    for (const f of frames) f(dt);
    cst?.mark("lab");
    craters.update(dt, groundChanged);
    cst?.mark("craters");
    deaths.follow(player.sim.pos.x, player.sim.pos.z);
    deaths.step(dt);
    cst?.mark("deaths physics");
    deadDraw.update();
    cst?.mark("deaths draw");
    hurtEl.style.opacity = String(Math.min(0.9, player.hurt / 60));

    reticle.visible = !!cursor;
    if (cursor) {
      reticle.position.set(cursor.x, field.height(cursor.x, cursor.z) + 0.06, cursor.z);
      (reticle.material as THREE.MeshBasicMaterial).color.setHex(player.upper.onTarget && !lock ? 0xffb347 : 0x9a958c);
    }
    // The lock: brackets round the target's centre of mass, facing the camera.
    lockMark.visible = !!lock;
    if (lock) {
      const t = lock.target;
      lockMark.position.set(t.x, t.y, t.z);
      lockMark.quaternion.copy(camera.quaternion);
      lockMark.scale.setScalar(Math.max(1, t.r * 1.3));
      lockMat.color.setHex(player.upper.onTarget ? 0xff6a3d : 0xb0a89a);
    }

    follow.lerp(new THREE.Vector3(player.sim.pelvis.x, player.sim.pelvis.y - 1.2, player.sim.pelvis.z), Math.min(1, rawDt * 6));
    iso.update(follow, rawDt);
    if (shakeK > 1e-3) {
      camera.position.x += (Math.random() - 0.5) * shakeK;
      camera.position.y += (Math.random() - 0.5) * shakeK * 0.6;
      camera.position.z += (Math.random() - 0.5) * shakeK;
      shakeK *= Math.exp(-rawDt * V.shakeDecay);
    }
    toon.update(camera, canvas.clientHeight);
    cst?.mark("camera");
    streamer.update(player.sim.pos.x, player.sim.pos.z);
    cst?.mark("terrain streaming");
    const camDist = camera.position.distanceTo(follow);
    look.update(follow, camDist + V.radius * V.chunkSize, Math.max(1, camDist / 40));
    cst?.mark("light");
    bf.update(dt, camera, look);
    arsenalDraw.update();
    cst?.mark("weapons draw");
    app.hud.set("weapons", arsenal.controls().join(" · "));
    const ds = bf.dentStats;
    app.hud.set("dents", ds.dug ? `blast dents: ${bf.dentQueue.length} queued · last frame ${ds.frameMs.toFixed(1)} ms (${ds.frameDents} dug) · worst ${ds.worstMs.toFixed(1)} ms · one dent ${ds.lastMs.toFixed(1)} ms · ${ds.dug} dug, ${ds.merged} merged` : "");

    const hull = Math.max(0, Math.round(player.health));
    const bar = "█".repeat(Math.round((hull / player.maxHealth) * 20)).padEnd(20, "·");
    app.hud.set("hull", `hull ${bar} ${hull}/${player.maxHealth}${player.alive ? "" : ` · destroyed, rebuilt in ${Math.max(0, V.respawn - player.deadFor).toFixed(1)} s`}${auto ? " · demo" : ""}`);
    app.hud.set("deaths", `bodies ${deaths.dead.length} (${deaths.liveCount} moving)${craters.count ? ` · craters ${craters.count} (last fit ${craters.stats.addMs.toFixed(1)} ms, chunk patch ${patchMs.toFixed(1)} ms, ${patchN} patches)` : ""}`);
    const dashDots = "●".repeat(player.dash.charges) + "○".repeat(Math.max(0, Math.round(V.dashCharges) - player.dash.charges))
      + (V.boostFuel > 0 ? ` boost ${"▮".repeat(Math.round(10 * player.dash.fuel / V.boostFuel)).padEnd(10, "▯")} (hold Space)` : "");
    if (cst) app.hud.set("costs", cst.end());
    app.hud.set("guns", `dash ${dashDots} (Space) · ammo L ${player.upper.guns[0].ammo} R ${player.upper.guns[1].ammo} · dust ${bf.dust.alive}${bf.sfx.running ? "" : " · click for sound"}`);
  });
  return lab;
}

/** Four corner brackets on a unit square (the lock mark). */
function lockBrackets() {
  const a = 1, b = 0.45, pts: number[] = [];
  for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    pts.push(sx * a, sy * a, 0, sx * (a - b), sy * a, 0, sx * a, sy * a, 0, sx * a, sy * (a - b), 0);
  }
  return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
}
