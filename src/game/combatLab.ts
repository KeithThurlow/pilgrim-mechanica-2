// The shell every combat lab shares: streamed dunes and desert light, the battlefield (dust, marks, gun effects,
// sound), the player's Rampart on twin-stick controls (WASD legs, mouse aim, left button fires, R resupplies), the
// pilot (hold F to hop out and back in; the enemies pick him through lab.foot.quarry when he's nearer), the
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
import { WALKER_DEFAULTS, WALKER_PARAMS } from "../mech/walkerTuning";
import { UPPER_DEFAULTS, UPPER_PARAMS, type Aim, type Trigger } from "../mech/upper";
import type { MoveCommand } from "../mech/walker";
import { LEG_TYPES } from "../mech/legTypes";
import { RampartBody, mechLegType } from "../mech/rampart";
import { ToonLook, TOON_DEFAULTS, TOON_PARAMS } from "../look/toon";
import { DENT_DEFAULTS, DENT_PARAMS } from "../fx/dents";
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
import { TARGET_DEFAULTS, TARGET_PARAMS, enemiesOf, type TargetCandidate, type Lock } from "./targeting";
import type { Filter } from "./register";
import { mechOwner } from "./registerOwners";
import { WEAPON_DEFAULTS, WEAPON_PARAMS, WEAPON_TOPIC } from "../weapons/tuning";
import { SHOT_DEFAULTS, SHOT_PARAMS } from "./shots";
import type { Arsenal } from "../weapons/arsenal";
import { MouseButtons, SoftAim, CameraShake, fitArsenal } from "./playerAim";
import type { Costs } from "../core/costs";
import { Walkable } from "../world/walkable";
import { OnFoot, ON_FOOT_DEFAULTS, ON_FOOT_PARAMS, PILOT_TOPIC } from "../pilot/onFoot";
import type { Prey } from "../pilot/quarry";

export const BASE_DEFAULTS = {
  ...WALKER_DEFAULTS, ...UPPER_DEFAULTS, ...MINIGUN_FX_DEFAULTS, ...SFX_DEFAULTS, ...TOON_DEFAULTS, ...ISO_DEFAULTS,
  ...TERRAIN_DEFAULTS, ...STREAM_DEFAULTS, ...LOOK_DEFAULTS, ...DUST_DEFAULTS, ...DENT_DEFAULTS, ...MECH_DEFAULTS,
  ...DEATH_DEFAULTS, ...TARGET_DEFAULTS, ...SHELL_FX_DEFAULTS, ...WATER_FX_DEFAULTS, ...BIOME_DEFAULTS, ...ROCK_DEFAULTS, ...SHALLOWS_DEFAULTS, ...CRATER_DEFAULTS, ...WEAPON_DEFAULTS, ...SHOT_DEFAULTS, ...ON_FOOT_DEFAULTS, biomeOnly: 0, radius: 4, shadowBox: 40,
};
export type BaseValues = typeof BASE_DEFAULTS;
const BASE_PARAMS: Param[] = [...ON_FOOT_PARAMS, ...WEAPON_PARAMS, ...SHOT_PARAMS, ...TARGET_PARAMS, ...DEATH_PARAMS, ...MECH_PARAMS, ...WALKER_PARAMS, ...UPPER_PARAMS, ...MINIGUN_FX_PARAMS, ...DUST_PARAMS, ...SHELL_FX_PARAMS, ...WATER_FX_PARAMS, ...DENT_PARAMS, ...BIOME_PARAMS, ...ROCK_PARAMS, ...SHALLOWS_PARAMS, ...SFX_PARAMS, ...TOON_PARAMS, ...ISO_PARAMS, ...TERRAIN_PARAMS, ...CRATER_PARAMS, ...STREAM_PARAMS, ...LOOK_PARAMS];

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
  /** Who the player's guns take: a register filter (hittable, not the player's team). A lab adds its enemies as owners
   *  of bf.register (src/game/register.ts); the shell rebuilds it once a tick, before the soft lock. */
  enemies: Filter;
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
  /** The pilot: hold F to hop out and back in (src/pilot/onFoot.ts). */
  foot: OnFoot;
  /** Who an enemy group whose middle is at (x, z) goes for: the mech, or the pilot on foot when he's nearer. */
  prey: (x: number, z: number) => Prey;
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
  // Ground marks as dents on a fine patch (Keith 2026-10-25).
  bf.useDents(app.renderer, streamer);
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
  bf.fx.own = player.sim.pos; // the effects budget keeps the local player's at full
  // The register: the player's mech first (owner 1), then whatever the lab adds.
  bf.register.add(mechOwner("player", () => [player]));
  const enemies = enemiesOf(player.team);
  // The weapons that aren't miniguns (nothing until a loadout fits one), camera shake, blasts (src/game/playerAim.ts).
  const shaker = new CameraShake();
  const shake = shaker.add;
  const { arsenal, draw: arsenalDraw } = fitArsenal(bf, player, V, toon, scene, enemies, shaker);

  const iso = new IsoCamera(camera, canvas, V);
  const keys = new Keys();
  // The pilot: hold F to hop out (the mech kneels where it stands), walk the sand, hold F by the mech to get back in.
  const walkable = new Walkable(field);
  const foot = await OnFoot.create(V, walkable, player, iso, bf, scene);
  let auto = !params.has("manual") && !params.has("onfoot");
  // Left click fires the left side's weapon, right click the right side's (Keith 2026-10-25); both can be held. F no
  // longer fires both: it's hold to hop out of the mech and back in (Keith 2026-10-26).
  const buttons = new MouseButtons(canvas, () => { auto = false; });
  // Space: dash the way WASD points (Keith 2026-10-24), on charges; keep holding to carry on into the sprint (Keith 2026-10-26).
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
      { id: "mech", label: "Your mech", groups: ["Targeting", "Rounds", "Dash", "Sprint kit", "Mech health", "Torso & guns", "Sensor head", "Minigun", "Move"] },
      { ...WEAPON_TOPIC, groups: [...WEAPON_TOPIC.groups, "Protocols"] },
      { id: "legs", label: "Legs", groups: ["Move", "Sprint", "Gait", "Air", "Landing", "Legs", "Feet", "Terrain"] },
      { id: "deaths", label: "Deaths", groups: ["Death physics"] },
      PILOT_TOPIC,
      { id: "hits", label: "Hits and dust", groups: ["Water effects", "Telegraphs", "Minigun hits", "Minigun FX", "Effects", "Dust", "Dust: look", "Dust: sources", "Ground dents", "Sound"] },
      { id: "dunes", label: "Dunes", groups: ["Dunes", "Shape", "Craters", "Sand surface", "Ground dents", "Ground dents: surfaces", "Streaming"] },
      { id: "biomes", label: "Biomes", groups: ["Biome map", "Rocky ground", "Shallows"] },
      { id: "light", label: "Light", groups: ["Look", "Cel look"] },
      { id: "camera", label: "Camera", groups: ["Camera"] },
      { id: "perf", label: "Performance", groups: ["Performance"] },
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
      { topic: "pilot", label: "Pilot", objects: () => foot.body.meshes() },
      { topic: "legs", label: "Legs", objects: () => regions.legs },
      { topic: "weapons", label: "Weapons", objects: () => arsenal.meshes() },
      { topic: "mech", label: "Your mech", objects: () => [...regions.hull, ...regions.gunLeft, ...regions.gunRight] },
      { topic: "mech", label: "Sensor head", objects: () => regions.sensor },
      ...(o.selectables ?? []),
    ],
    ground: { topic: "dunes", label: "Dunes", field },
    sky: { topic: "light", label: "Light and sky" },
    onPick: (topic) => { picking = true; panel.focus(topic); picking = false; },
  });
  const sel = selector;
  installReport(app, o.id.replace(/-lab$/, ""), V, () => ({ selected: sel.selection, topic: panel.focused, hull: Math.round(player.health), pilot: `${foot.mount.state}${foot.sim.alive ? "" : " (dead)"}`, ...(o.report?.() ?? {}) }));
  Object.assign(V, body.legValues());
  panel.refresh();

  const softAim = new SoftAim(scene, camera, canvas, field);
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
  // ?onfoot: start on foot beside the mech.
  if (params.has("onfoot")) foot.startOut();
  const follow = foot.focus(new THREE.Vector3()) ?? player.sim.pelvis.clone();
  iso.snap(follow);
  if (params.has("zoom")) iso.setDistance(Number(params.get("zoom")));
  const stick = new THREE.Vector3();
  let clock = 0;
  const frames: ((dt: number) => void)[] = [];

  const lab: CombatLab<E> = {
    app, V, field, bf, toon, player, deaths,
    enemies,
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
    foot,
    prey: (x, z) => foot.quarry.pick(x, z),
  };

  // For headless debugging and tests: the lab on the page (window.__lab).
  (globalThis as unknown as { __lab: unknown }).__lab = lab;
  let lastDemo: { aim: Aim | null; trigger: Trigger } = { aim: null, trigger: false };
  (lab as unknown as { demoState: () => unknown }).demoState = () => lastDemo;

  /** Demo: slow loops, aim at the nearest enemy, fire when it's in range. */
  function demo(t: number): { cmd: MoveCommand; aim: Aim | null; trigger: boolean } {
    const a = t * 0.12;
    const cmd = { x: Math.sin(a), z: Math.cos(a), sprint: false };
    const p = player.sim.pos, reg = bf.register;
    const e = reg.nearest(p.x, p.z, Infinity, enemies);
    if (e < 0) return { cmd, aim: null, trigger: false };
    const bd = Math.hypot(reg.x[e] - p.x, reg.z[e] - p.z);
    return { cmd, aim: { x: reg.x[e] + reg.vx[e] * V.lockLead, y: reg.y[e], z: reg.z[e] + reg.vz[e] * V.lockLead }, trigger: bd < V.range + 5 };
  }
  let lock: Lock | null = null;

  const fixedDt = params.has("dt") ? Number(params.get("dt")) : 0;
  /** ?holdf=seconds: F held from the start (headless shots of getting out). */
  const holdF = Number(params.get("holdf") ?? 0);
  app.onTick((rawDt) => {
    const dt = fixedDt || rawDt;
    const cst = lab.costs;
    cst?.begin();
    bf.costs = cst;
    clock += dt;
    // Everything that can be hit, where it ended last frame (what's drawn): once a tick, before the soft lock.
    bf.register.rebuild();
    cst?.mark("register");
    keys.move(camera, stick);
    if (keys.has("KeyR") || (auto && player.upper.guns[0].ammo < 100)) player.upper.resupply();
    const fHeld = keys.has("KeyF") || clock < holdF;
    if (stick.lengthSq() > 0 || fHeld) auto = false;
    const driving = foot.driving;
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
    else if (auto) { ({ cmd, aim, trigger } = demo(clock)); lastDemo = { aim, trigger }; cursor = aim; }
    else if (driving) {
      if (stick.lengthSq() > 0) cmd = { x: stick.x, z: stick.z, sprint: keys.sprint };
      // Soft lock: the guns take the enemy under the cursor ray, else the one nearest the line of fire, led by its
      // motion; the rounds fly straight at the target itself (shotAt).
      ({ cursor, aim, shotAt, lock } = softAim.pick(buttons.mouse, bf.register, enemies, player.sim.pos, V));
      trigger = [buttons.left, buttons.right];
      held = [keys.has("Digit1"), keys.has("Digit2"), keys.has("Digit3"), keys.has("Digit4")];
      if (held.some(Boolean)) auto = false;
    }
    if (sel.active) { trigger = false; held = [false, false, false, false]; }
    player.keys = held;
    player.cursor = cursor ? (player.cursor ?? new THREE.Vector3()).set(cursor.x, field.height(cursor.x, cursor.z), cursor.z) : null;
    player.lock = lock?.target ?? demoLock;

    if (dashPressed && driving) {
      dashPressed = false;
      // With no keys held, dash the way the legs face.
      if (stick.lengthSq() > 0.01) player.tryDash(stick.x, stick.z);
      else player.tryDash(Math.sin(player.sim.heading), Math.cos(player.sim.heading));
    }
    // The demo sidesteps now and then, to show the dash off.
    if (auto && !o.demo && clock % 7 < dt && clock > 3) player.tryDash(Math.cos(player.sim.heading), -Math.sin(player.sim.heading));
    dashPressed = false;
    player.dashHold = spaceDown && !auto && driving;
    cst?.mark("input + lock");
    player.step(dt, cmd, aim, trigger, shotAt ?? aim);
    if (!player.alive && player.deadFor > V.respawn) player.reset(player.sim.pos.x, player.sim.pos.z, player.sim.heading);
    // The pilot: hold F to get out (anywhere the mech stands, not mid-dash) and back in; WASD walks him on foot.
    foot.update(dt, { hold: fHeld && !auto, stick, run: keys.sprint, blockOut: player.dash.active ? "mid-dash" : player.bound.on ? "mid-sprint" : null });
    // Lab only: a killed pilot is back in the mech after the rebuild time.
    if (!foot.sim.alive && foot.deadFor > V.respawn) foot.reset();
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

    // The reticle (only while driving), and brackets round the lock's centre of mass, facing the camera.
    softAim.draw(driving ? cursor : null, lock?.target ?? null, player.upper.onTarget);

    const want = foot.focus(new THREE.Vector3()) ?? new THREE.Vector3(player.sim.pelvis.x, player.sim.pelvis.y - 1.2, player.sim.pelvis.z);
    follow.lerp(want, Math.min(1, rawDt * 6));
    // The camera leads the mech at speed (not the pilot on foot).
    const ps = player.sim;
    iso.update(follow, rawDt, foot.driving ? { x: ps.vel.x + ps.skid.x, z: ps.vel.z + ps.skid.z } : undefined);
    shaker.apply(camera, rawDt, V.shakeDecay);
    toon.update(camera, canvas.clientHeight);
    cst?.mark("camera");
    streamer.update(follow.x, follow.z);
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
    app.hud.set("pilot", foot.driving ? "" : `pilot: ${foot.mount.state}${foot.sim.alive ? "" : `, killed (back in the mech in ${Math.max(0, V.respawn - foot.deadFor).toFixed(1)} s)`} · health ${Math.round(foot.sim.health)}/${V.pilotHealth} · ${foot.toMech.toFixed(1)} m from the mech`);
    app.hud.set("hull", `hull ${bar} ${hull}/${player.maxHealth}${player.alive ? "" : ` · destroyed, rebuilt in ${Math.max(0, V.respawn - player.deadFor).toFixed(1)} s`}${auto ? " · demo" : ""}`);
    app.hud.set("deaths", `bodies ${deaths.dead.length} (${deaths.liveCount} moving)${craters.count ? ` · craters ${craters.count} (last fit ${craters.stats.addMs.toFixed(1)} ms, chunk patch ${patchMs.toFixed(1)} ms, ${patchN} patches)` : ""}`);
    const dashDots = "●".repeat(player.dash.charges) + "○".repeat(Math.max(0, Math.round(V.dashCharges) - player.dash.charges))
      + (V.boostFuel > 0 ? ` booster ${"▮".repeat(Math.round(10 * player.dash.fuel / V.boostFuel)).padEnd(10, "▯")}` : "");
    if (cst) app.hud.set("costs", cst.end());
    const fl = bf.fx.last;
    app.hud.set("fx", bf.fx.on ? `effects budget: ${fl.asked} asked · ${fl.full} yours at full · ${fl.thinned} thinned · ${fl.merged} hits merged · ${fl.spawned} dust puffs · pressure ${fl.pressure.toFixed(2)}` : "effects budget off");
    const sprint = player.bound.on ? ` · sprint ${player.sim.speed.toFixed(1)} m/s` : " · hold Space to sprint";
    app.hud.set("guns", `dash ${dashDots} (Space)${sprint} · ammo L ${player.upper.guns[0].ammo} R ${player.upper.guns[1].ammo} · dust ${bf.dust.alive}${bf.sfx.running ? "" : " · click for sound"}`);
  });
  return lab;
}
