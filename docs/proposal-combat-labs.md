# Proposal: combat labs (Keith 2026-10-24: go ahead, war band first)

Keith 2026-10-24: labs to explore combat, giving the player a sense of power in the mech and a sense of threat.
Looks stay stand-ins (boxes and simple shapes) until the feel is right. Nothing here is built yet (rule 9).

## What Keith asked for

1. **Convoy escort**: our own vehicles (Mad Max style, like the truck in the reference video
   `art-refs/particles/m2-res_1080p.mp4`) driving alongside the convoy, kicking up dust, and maybe friendly mechs
   walking beside the main base.
2. **War bands**: when out adventuring, raider vehicles swarm the mech, circling it: slightly futuristic pickups
   with machine guns on the back, bigger trucks with bigger guns. Some bandits bring mechs of their own.
3. **Bandits on foot**: a classic swarm the mech mows down in swathes while they shoot back.
4. **Hostile robots**: quadrupeds swarming across the land; mostly small, some large.

## Shared pieces (built once, used by every lab)

- `src/combat/` **unit pool**: structure-of-arrays positions, velocities, health, team, kind; instanced meshes per
  kind (rule: data-oriented arrays and instanced meshes for swarms). Ground from `DuneField.height`, like everything.
- **Hits on units**: the minigun's rounds already ray-cast; add a hit test against units (a cheap grid of unit
  positions), damage, death (a stand-in break-apart plus dust from the dust system), knockback for small units.
- **Return fire**: enemy shots as visible tracers using the minigun FX pool, hitting the mech (a health bar on the
  HUD to start).
- **Frame time**: every lab shows the unit count next to frame time, so we see the cost of a swarm (rule 4).

## Labs

### 1. `labs/convoy-escort/`: vehicles alongside the convoy
- A **vehicle sim** (`src/vehicles/car.ts`, pure maths): bicycle-model steering on the height function, suspension
  springs per wheel (four ground samples), skidding with a slip angle, the body pitching and rolling. Wheels feed
  the dust system (`dust.kick` per wheel by slip and speed), and tyre ruts go to `sandMarks`. This is the truck in
  the reference video.
- AI: hold a station beside a moving point (the convoy) with some weaving; a few vehicles; one or two friendly
  mechs walking alongside (the walker sim, steered by a station-keeping driver instead of WASD).
- Key values (sliders): top speed 22 m/s, grip, drift, suspension stiffness and damping, dust per wheel.

### 2. `labs/warband/`: raider vehicles swarming the mech
- The same vehicle sim; **AI**: circle the mech at a range band (12-30 m), break in for gun runs, flee when hurt.
  Gunner on the back aims with a turn rate and spread (Dota-style arcs, as in the old game).
- Kinds: technical (pickup, MG), gun truck (heavier gun, slower), raider mech (the walker sim, stand-in body,
  arm gun).
- Values: circle radius, how many attack at once (attack tokens, from the old game), their accuracy, health.

### 3. `labs/bandit-swarm/`: bandits on foot
- Hundreds of instanced stand-in figures with flocking (separation, seek, cover-hugging later), shooting with
  low accuracy from range; morale (break and run when the swarm is thinned, from the old game's infantry rules).
- The power fantasy: rounds knock them down, the dust and marks show the churn, stomping near them throws them.
- Values: spawn rate, numbers on screen (target 300+), speed, accuracy, morale threshold.

### 4. `labs/robot-swarm/`: hostile quadrupeds
- Small quadruped robots (cheap procedural legs: four feet on a simple trot, no IK beyond two bones) in large
  numbers, and a few big ones on a slower walk; they flow over the dunes toward the mech and leap at it.
- Values: numbers, sizes (small 1 m, large 4-6 m), speed, leap range, armour.

### 5. `labs/convoy-cranes/`: deploy and pick-up (Keith 2026-10-24)
- A fleet of 6-7 large platform vehicles (the biggest on tracks, the mech bays and gantries on it), each with
  cranes. Stay within a crane's range and it picks the mech up and sets it on a platform (back into the village).
  To head out, walk onto a deploy zone and a crane lowers the mech beside the moving convoy; the mech has to start
  walking at once to keep pace, then WASD control comes back.
- The convoy can travel in any direction (no pathing yet), over reasonably steep ground; flattening the sand in
  front of it is fine (long term Keith would like the convoy to visibly flatten the terrain ahead: a cool effect).
- Builds on the vehicle sim (lab 1/2) and the walker; crane sim: a slewing boom with a hoist line and a cradle
  that grips the mech's hull, with the mech's legs going limp while carried.

## Suggested order

Warband first (it reuses the vehicle sim that the convoy escort needs, and tests return fire and the mech's guns
against fast movers), then the bandit swarm (numbers and the power fantasy), then robots, then the convoy escort.
Keith to choose.

## Answers (Keith 2026-10-24)

- The mech takes damage.
- No salvage drops yet: combat and gameplay fun first, salvage later (Keith has ideas for that part of the loop).
- Bandit mechs: red versions of the Rampart for now.
