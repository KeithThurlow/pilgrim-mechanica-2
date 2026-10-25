# Proposal: the pilot on foot (approved by Keith 2026-10-26)

Keith 2026-10-25:
- Get out of the mech with F (or by holding F), both while exploring and at the convoy.
- In the field, hop out to get into something small.
- At the convoy, roam around and walk across the platforms and the footbridges between them, which "really sells"
  the moving village.
- Canopies and the like might come from the sister project's village look. Keith wants to find better references
  before we commit to visual changes.

## From the sister project (ideas, not code)

- One button mounts and dismounts anywhere; a parked mech stays where it was left.
- Holding F on foot calls the empty mech to you; it walks over, as loud as driving it.
- On foot you are small, quiet and fragile. You scout, sneak through gaps the mech can't fit, and steal.
- Mounted, you are powerful but loud and big.
- A destroyed mech ejects the pilot. Dying on foot loses everything carried.
- Keep the pilot side deliberately thin.

## What I'd build

1. **F (tap) to get out or in.**
   - Out: the mech kneels, the cockpit opens, and the pilot climbs down beside it, about 2 s.
   - In: within a few metres of your mech, F climbs back in.
   - **Hold F** on foot calls the mech to you, with the AI walking it over. It's loud. This comes after the basics.
2. **The pilot:**
   - Vanguard as the stand-in. We already have him baked for the bandits. The pilot gets his own clips: idle,
     walk, run, crouch, climb.
   - Driven by a small capsule controller: WASD, turning toward movement.
   - The mouse aims a sidearm later, nothing at first.
   - The camera zooms in to about 15 m on foot and back out when you mount.
3. **Walking surfaces:** the pilot walks on the true ground and on anything flagged walkable:
   - convoy decks and footbridges, which ride the moving convoy the same way the mech does on a deck;
   - stairs or ladders up the bridge towers;
   - later, inside POI wrecks.
   
   One `walkHeight(x, z, fromY)` query covers all of these, so the same code works on the sand and on a deck rolling
   along at 3 m/s.
4. **At the convoy:** park in a bay, press F, and the pilot climbs out onto the deck. Walk the deck, take the tower
   stairs up, cross the footbridges to the next car, come back and get in. Later the bay screen moves to a terminal
   by the bay that you walk up to.
5. **In the field:**
   - The parked mech stays put. Enemies can shoot it, and that rule is to be decided.
   - The pilot fits gaps the mech can't: small wrecks, a crawl hole into a crashed ship.
   - Bandits and robots notice and chase a pilot, who is very fragile.
6. **Dying:**
   - If the mech is destroyed while you're in it, you're thrown clear on foot. The cargo is lost per Keith's rule.
   - Die on foot and the expedition is over: you're back on the convoy with nothing carried.

## Files

- `src/pilot/`:
  - `pilot.ts` (pure: the capsule controller, walk/run/climb, the walkable query);
  - `pilotBody.ts` (Vanguard with its clips; a separate baked texture, or a skinned mesh for this single character);
  - `mount.ts` (getting out and in, kneeling, calling the mech).
- `src/world/walkable.ts`: the ground plus registered surfaces (decks, bridges, stairs) with their moving frames.
- **Lab:** the convoy lab gains the pilot. F in a bay gets you out, and a `?onfoot` flag starts on foot. The combat
  labs get F too, to hop out mid-fight.
- **Check `tools/pilot-check.ts`:**
  - the pilot never falls through a deck or bridge while the convoy moves and turns;
  - stairs climb;
  - mounting needs range;
  - the mech stays where it was left.

## Order

1. Getting out and in, the pilot walking on sand, and the camera zoom.
2. Convoy surfaces: decks, tower stairs and footbridges, all moving.
3. Calling the mech; enemies noticing the pilot; ejection.
4. Pilot gear (sidearm) later, kept thin.

## Questions for Keith

- **Tap F or hold F to get out?** I'd make tap F get out and in, and hold F call the mech (as in the old game).
- **Should enemies attack a parked mech?** I'd say yes, so leaving it is a risk.
- **Should the bay screen move to a terminal you walk to on foot?** I'd say yes, once on-foot exists. B stays as a
  shortcut in the labs.

## Answers (Keith 2026-10-26)

- **Hold F** to hop out, both out in the field (at wrecks) and back at the convoy. Hold F again by your mech to get
  back in (Claude's default; tell Keith).
- **On the convoy you're mostly on foot:** park, hop out, walk the decks and bridges.
- **Enemies attack a parked mech, and the pilot.** On foot you are very vulnerable.
- **Parking is too slow:** speed up the crouch when E parks the mech in a bay.
- **The bay screen becomes a terminal you walk up to** (B stays as a lab shortcut).

Conflict to settle: F also fires both guns in the combat labs. Both mouse buttons can now be held at once (Keith's
desktop change), so F leaves firing and becomes hop out and in (Claude's default). Calling the empty mech to you
needs another key later (not asked yet).
