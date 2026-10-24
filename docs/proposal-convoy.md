# Proposal: the convoy, its cranes and its escort (waiting for Keith)

Keith 2026-10-24: the base is a convoy village that never stops rolling. A fleet of 6-7 large platform vehicles, the
biggest on tracks carrying the mech bays and gantries. Cranes on the platforms pick the mech up when it's in range and
set it on a platform (back in the village); to head out, walk onto a deploy zone and a crane lowers the mech beside the
moving convoy, which has to start walking at once to keep pace before full WASD control returns. Our own vehicles (the
reference video's truck) and friendly mechs travel alongside. The convoy can head in any direction (no pathing yet),
over reasonably steep ground; flattening the sand ahead of it is fine, and long term Keith would like to see the
convoy visibly flatten the terrain in front of it. Nothing here is built yet.

## Labs

1. `labs/convoy/`: the convoy rolling over the dunes, the ground it flattens, and escorts alongside.
2. `labs/cranes/`: deploy and pick-up with one platform and its crane, then on the full convoy.

## Files and data

- `src/convoy/route.ts` (pure): the convoy's heading over time (a slider-driven heading plus slow wander), its
  position as a function of time, and the **flattened corridor**: a stored polyline of where the convoy has been
  (plus the next ~150 m ahead). `DuneField.height` gains an optional modifier: within the corridor's half-width the
  dune height blends down to a smooth floor along the route (a wide smoothstep at the edges, ridges pushed out as low
  berms at the sides). Still a pure function of position, so feet, wheels and chunks all agree; only chunks the
  corridor touches are rebuilt as it extends.
- `src/convoy/platform.ts` (pure): each platform is a rigid body that follows the route at a formation offset
  (columns of two or three, gaps of 20-40 m), sampling the ground at its axles (wheels) or along its track length
  (tracked), with sprung pitch and roll like the cars. Kinds: the big tracked mech-bay platform (~40 x 16 m), mid
  wheeled platforms (~24 x 10 m: housing, workshop, fuel), small ones.
- `src/convoy/platformBody.ts`: stand-in decks, rails, tracks or big wheels, gantries, and deck markings for deploy
  zones; later modelled.
- `src/convoy/crane.ts` (pure): a slewing jib crane on a platform: slew angle and rate, luff (boom elevation), hoist
  length, and a cradle that grips the mech's hull at the back. States: idle → reach (slew and luff to the mech) →
  lower → grip (the mech's legs go limp: the walker sim blends to a hanging pose) → lift → swing over the deck → set
  down on a bay; deploy runs it backwards and releases the mech with the convoy's velocity, so the walker has to
  catch its own momentum (a few seconds of forced follow before WASD comes back).
- `src/convoy/escort.ts`: escort drivers (the war band's car sim) holding stations beside the moving convoy with some
  weaving; friendly mechs (the mech unit) walking alongside.

## Key values (all sliders)

- Convoy speed 3-6 m/s (the mech walks 4, sprints 6.5: deploying at speed is the drama), turn rate, formation gaps.
- Corridor half-width 30 m, edge blend 15 m, berm height 1 m; how far ahead it's flattened (150 m).
- Crane reach 18-26 m, slew 25°/s, hoist 2 m/s, pick-up range (the mech must stay inside it for 2 s to be offered a
  pick-up), the release speed match.
- Platform suspension, track sag.

## Open questions for Keith

- Pick-up: automatic when you stay in range, or a key press once in range?
- Is the convoy's direction steered by anyone yet, or a slider in the lab for now (Keith: the player doesn't steer it)?
- Should the flattened corridor stay flat behind the convoy (a road across the desert) or slowly fill back in?
