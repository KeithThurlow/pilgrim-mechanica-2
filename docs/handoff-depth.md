# Handoff: depth (Keith 2026-10-28)

Branch wip/depth. All six steps built. Test: `npx tsx tools/expedition-check.ts`; lab: `?depth=1500` in the convoy lab.

## Values (old -> new)
- firstFight 40 -> 25 s; roamMin/Max 6/16 -> 8/20; raidFirst 90 -> 75 s.
- New, at danger 1 (x at the road = 1): campChanceFar 1.5, campSizeFar 2.5, campMidFar +0.3, campBigFar +0.12, roamPacksFar 2, roamSizeFar 2, raidFreqFar 2.5, raidSizeFar 2.5, raidMidFar +0.3, raidBigFar +0.12, packMidFar +0.3, packBigFar +0.1, raidDeepAt 0.5, raidDeepFirst 30 s, scrapFar 3.
- Danger: start 150 m, full 2000 m, cap 1.5. Rings 400/1000/2000.
- Heat: rise 0.025/s x spot value/25 x noise, hold 3 s, decay 0.012/s, noise x(1+1.0 heat), pack 0.35, raid 0.75, max 1.5, rearm below 0.5 x threshold; heat raid 10 robots from 240 m; pulled-in pack else appears 180 m off.

## Known rough edges
- Depth searches 2.5 km behind to 5 km ahead of the convoy head; places further than that read as farther than they are.
- The pulled pack hunts at 4 m/s, so a far pack takes a while to arrive.
- Camp radar guesses scale with the bigger camps (heat blobs saturate at blobHot).
- Not looked at in a browser (no screenshots by order): HUD meter and radar bands unchecked visually.

## Live depth (coordinator, Keith 2026-10-28)
`depthAt` (road, static) places camps and scrap. `convoyDepth(route,x,z,trainLen,clock)` is the distance to the train now; `DepthField.liveDepth/liveDanger` blend them by slider "Live depth from convoy" (depthLive, default 1 = from the convoy, 0 = road) and drive roaming packs, raids and the salvage heat answers. Later extraction fee/wait should use liveDepth too. HUD shows both distances.

## Checks
expedition and poi pass. convoy-check (hips 0.80 m off over the deck), loadout-check and slope-check fail in code I did not touch (unchanged by this work).
