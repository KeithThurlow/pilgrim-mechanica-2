# The summoner archetype (Keith 2026-11-02)

Keith: "drones that can fly around the mech and target enemies ... little robots that walk around beside you and can
target enemies ... robots that have turrets on them as your own companions, a couple of those ... summon or send out
swarms of the little robots that can go out and scrap on your behalf ... anything else that would make sense."

A build that fights through its units rather than its own guns. Everything lives in `src/summon/` and is tried in
`labs/summoner/`; the glue (`summons.ts`) is one class any combat lab or the convoy lab can add.

## Batches (each its own PR, merged when `npm test` passes)

1. **Attack drones** (done): quadcopters orbit the mech, go for the target lock (Tab or the soft lock), else spread over
   the nearest foes, circle them and fire bursts; a leash keeps them near; shot down, rebuilt in the bay after a few
   seconds. `drones.ts` (pure sim), `dronesDraw.ts`, `summons.ts`, `tools/drones-check.ts`.
2. **Turret companions** (done, with batch 3): two weapon quads (the robots' rig and sim, a second `RobotSwarm` on the player's team, in
   the summoner's paint) walk beside the mech, hold range and shoot what you lock or what's near. Enemies near them
   turn on them.
3. **The scrap swarm** (done; salvage on the sand still to come): a pack of small scrappers you send out (a key, aimed at the cursor or the lock): they run out,
   bite what they reach, and come back; with nothing to fight they strip salvage on the sand for you.
4. **Items**: the summoner gear as loot (a drone bay pack, a kennel hull for the companions, a hive pack for the
   swarm, a relay sensor that widens their reach), so the archetype is a loadout, and it works in the convoy lab.

## More summoner pieces (to offer Keith)

- **Repair drone**: one drone that heals the mech or a companion instead of shooting (rides on the heal zones).
- **Decoy drone**: draws the robots' fire and the scrappers' leaps for a few seconds.
- **Bomber drones**: a key sends the drones on one dive each onto the lock, a small blast, then rebuilt.
- **Turret drop**: plant a static turret (the convoy's guard turret) at the cursor for a while.
- **Command pulse**: one key "attack my lock / fall back to me" for every summon at once.
- **Shared kills**: summons' kills count for contracts and loot like yours.
- **Summon Protocols**: sockets on summoner gear for more drones, faster rebuilds, ricochet on drone rounds.

## Open questions for Keith (defaults chosen so it works now)

- Drones: 4, 40 health, rebuilt after 6 s; orbit 6.5 m at 5.5 m up; pick foes within 34 m, never past 45 m; bursts of
  6 rounds at 6/s, 5 damage each (about 70 damage a second for all four; a minigun pair does more). Sliders in
  Summons › Drones.
- Drones go for the target lock first, the soft lock counts (whatever the guns are on). Should only a Tab lock steer
  them?
- Drones never attack a sleeping camp unless it's locked (so they don't start fights you didn't pick).
- The summoner's paint: warm sand plate, cyan eyes (so they read as yours beside the robots' white and red).
- No drone sound yet beyond their guns' crack.
- Companions: two weapon quads (minigun, then rockets), 1400 health, rebuilt after 25 s, at your flanks 7 m out and
  3 m back, holding 9-18 m off a foe; walk 7.5 m/s (the enemy quads walk 4.5) so they keep up with the mech. Minigun
  rounds 8 damage (pause 1.4 s), rockets 30 each (pause 2.5 s). No laser or rail companions yet (the beams burn on
  the robots' team only).
- Scrap swarm: 16 scrappers, 20 health, 11 m/s, 3 per bite, one rebuilt every 1.5 s. At home they trail you and bite
  anything within 12 m; Z throws them at your lock (they follow it) or the cursor, up to 70 m, they bite every foe
  within 16 m of the spot and come home once it's clear for 3 s or after 25 s; C calls them back.
- Enemy robots within 14 m of a companion or scrapper (and nearer it than you) turn on it, 60% of them. Only in the
  summoner lab for now; out in the field the fight director would do it.
- Keys: Z send, C recall (free in every lab). Should the swarm instead ride on key 3 (the pack's ability key)?
