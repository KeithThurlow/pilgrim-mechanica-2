# Handoff: the convoy plough (Keith 2026-10-26)

Branch `worktree-agent-a59bf7a148657f0e1`, pushed to `wip/plough`. Delete this note when the work merges.

## Done and working
- **The road is the plough's** (`src/convoy/route.ts`): `ConvoyRoute.blade` = `s + bladeOffset + ploughGap` (pure function
  of the convoy clock). `at()` cuts only behind the V-shaped cut edge (`bladeSweep`, eased over `bladeRamp`); ahead
  the dunes are untouched. Along-route distance off the road comes from the lines square to the route at each vertex
  (`nearest()`), so it is smooth on both sides of bends (the plain nearest-point s tore the berms). `corridor()` = the
  road to be (POIs/camps keep off it, `src/expedition/loop.ts`). `jump(s)` sets the clock. `onChange` now gets small
  patch boxes as the blade advances (`patch()`: every `ploughPatchEvery` m, 16 m pieces across the road). The old
  fixed `routeBerm` is gone. Replans never truncate under the blade (`keepAhead`).
- **The wake** (`src/convoy/wake.ts`): per 2 m station, signed cut per side from the raw ground
  (`DuneField.sample(x, z, out, raw=true)`, new; the sample also carries `swell`/`bumps`); smeared over `bermCarry`,
  clamped, outside-of-curve share, seeded lumps; berm (1-u²)² with W = `bermSpread`·H (area conserved). Lazy caches,
  `forget()` on replan, `clear()` on slider change.
- **The plough sim** (`src/convoy/plough.ts`), owned by `Convoy` (`platform.ts`: `convoy.plough`, `convoy.jump(s)`):
  pose on the road, `rate` (m³/s per side), `gapAt` (base + blade wings), `ahead`, `pushOut` (the mech).
- **Drawing**: `ploughBody.ts` (stand-in: tread pods via `TrackBody`, hull, cab, stacks, push arms, ribbed V blade,
  rebuilt when width/sweep change), `ploughFx.ts` (tip spill clumps, rolling cloud, plume, ruts and ridge furrows;
  scales with `rate / ploughFullLoad`).
- **Escorts** (`escort.ts`): keep clear of the plough (`Obstacle.gapAt`); a scout ahead of the blade speeds up; the two
  scouts now flank the plough's base (they bogged down on raw dunes ahead and were run over).
- **Convoy lab**: `?watch=plough`, `?crest[=m]` (blade that far short of the biggest cut found ahead; negative = past
  it, `?crest=-30` shows the walls behind), topic "Plough and wake", patching budget 1.5 ms/frame (min one box),
  HUD line `plough:`, selector item.
- **Checks**: `convoy-check` 1b (ahead = plain dunes exactly, behind = floor exactly, berm volume = sand moved, 40 m
  windows within 30% (7% seen), wake cut = cut read off the heights, correlation 0.98, same clock same ground
  (driven vs jumped), no cliffs past 75° unless the dune was already, berm faces ≤ 45° (39°), mech walks over a 5.5 m
  berm), escorts ≥ 1 m off the plough (4.4). `crater-check` jumps its clock to 200 so its road exists. All
  `tools/*-check.ts` passed at commit 626a51a; convoy and crater re-run after the default change below.
- Docs: state.md (Plough and wake row, Convoy row, Changes), decisions.md, asset-list C3.

## Values chosen
`ploughGap` 12, `bladeSweep` 24°, `bladeRamp` 4, `bermGrow` 8, `bermSpread` 2.2 (35° faces), `bermOut` 8 (3 tipped
escorts at 26 m out), `bermCurve` 0.6, `bermLumps` 0.35, `bermCarry` 6, `ploughPatchEvery` 3; FX `ploughFullLoad` 160,
`ploughSpill` 40, `ploughPlume` 14, `ploughIdleDust` 0.15, `ploughRidges` 9, `ploughChurnEvery` 1.6. Constants:
`PLOUGH_REACH` 22, base 17 × 15 m, blade 4.2 m tall, station 2 m, `BERM_W_MAX` 22.

## Left, in order
1. Shots: done from the convoy lab (webgl, `?set=radius:3`, 800-960 px; the box is very slow). The blade and the dune
   piling against its point read well; the berms read only as soft bulges from the game camera (about 5-6 m high,
   25 m wide on this terrain: the biggest cut found in 3 km was 152 m² both sides, as the floor fills troughs). If
   Keith wants walls: lower `bermSpread` (steeper than repose), less fill (`routeLift`), or count only the cut.
   FX barely seen in shots (load near 0 at the moments shot); not verified visually at full load.
2. Add the lab flags to CLAUDE.md (`?watch=plough`, `?crest[=m]`) and the new files to its Layout (not done: agents
   may not edit CLAUDE.md).
3. Patch cost: one box minimum per frame can be ~1000 vertices (7 ms on this box); split boxes along the route too if
   it shows on Keith's PC.
4. Road far behind: stays flat (no healing), as asked.

## Known bugs / rough
- Berm can sit on a cut face up to ~71° combined slope (still under the terrain's 75°).
- Escort `escortScoutAhead` now only sets the trailers (label changed).
- `?crest` threshold (260 m²) is rarely reached; it takes the best of 30 × 100 m windows (about 0.1 s).

## How to test
`npx tsc --noEmit -p . --preserveSymlinks`; `npx tsx tools/convoy-check.ts` (section "plough and wake"),
`tools/crater-check.ts`, all `tools/*-check.ts`. Lab: `/labs/convoy/?watch=plough&crest&manual`,
`?watch=0&crest=-45&zoom=70` (road and berms behind), `?watch=plough&crest=8&zoom=45&set=camPitch:25,camNearPitch:20,camYaw:200`
(low view at the blade).
