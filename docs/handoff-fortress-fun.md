# Handoff: making the bandit fortress fun to raid (Keith 2026-11-05)

Keith's playtest: containers good; still reads as concentric rings; walls take long to blow down and it never felt
dangerous; bandits pop in from nowhere. Asks, in order (each its own PR, merged when `npm test` passes):

1. **Town layout** (done): organic village after the old project's organic towns
   (`KeithThurlow/pilgrim-mechanica`, `Assets/_Project/Combat/Runtime/World/Settlement/SettlementGenerator.Organic.cs`:
   spines from gates to the plaza, lanes, buildings along frontages, an outline). Here: `fortLayout` in
   `src/pois/fortress.ts` (polygon walls, main streets, back streets, lanes, shacks, back rows, compounds, cover),
   `src/world/poiPads.ts` (relief), `flowStep` in `src/pois/fortressGround.ts` (bandits round the shacks).
   Plans: `npx tsx tools/fortlayout-probe.ts --svg out.svg`.
2. **Spawner containers** (done: `src/pois/spawners.ts`, `spawnersDraw.ts`, waves in `fortresses.ts`): bandits come out of particular containers (doors swing open, a stream runs out), instead of
   appearing in a heap; the waves and alarms use them. Destroyable later?
3. **Lookout towers**: stacked containers standing up (3-4 high) with 1-2 bandits on top with grenades, rockets or guns;
   destructible (a target with health; the stack falls, the bandits with it).
4. **Walls and danger**: measure mech DPS vs gate health, make gates quicker (or walls breachable), make the raid
   dangerous (towers, rockets, crossfire).

## Values chosen (1)
Outer 118 m, middle 74 m (60%), keep 26 m, pad 140 m, relief 5 m; walls 8-11 / 6-9 / 5-7 sides, corners ±10%;
streets 10 m, lanes 7 m, 4 back streets and 6 compounds per yard, up to 220 shacks, 30% two high; middle gates barred
half the time (one always); bandits path past 28 m from the mech.

## Known rough edges
- Shacks are solid ground boxes: not destructible, the mech can't push through.
- Not seen rendered in a real browser (cloud box too slow); props on slopes may float or sink a little.
- Idle bandits walking back to posts still go straight (snag on shacks); only alert ones and gate routes use the flow.
