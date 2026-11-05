# Handoff: sword, flamer, tank-tracks and metal-hit sounds (2026-11-05)

Branch: `wip/sword-flame-tank-sounds` (pushed). Keith's asks: thread "Add flamethrower, sword and tank sounds" and his
later note on bullets hitting metal (fortress containers). Nothing merged yet. `npm run check` and `npm test` pass on this branch.

## Blocker that ended the first thread
The source sounds are only on Keith's PC, in the old project's Pixabay folder (`C:\Users\thurl\Development\pilgrim-mechanica\`,
probably `Assets\pixabay sounds\`; not in the old repo on GitHub). Folder access said "device not connected to the bridge"
and the Remote Control card couldn't be clicked. New files there (names roughly): `[...]Flamethrower...`, `Blade on metal too
long`, `Tracks Moving, Bass and Noise and Tank`, `Blade Swipe` (a wind turbine sweep), `metal hit needs variations` (the hit
starts nearly 1 s in), and a ~260 MB YouTube capture with the smash at 1:47-1:48. Clip only ~1:40-1:55 of the video (as a
reference for the synthetic smash); don't put the video in the repo. ffmpeg is on the cloud container.

## Done (code)
- `src/audio/sampleCut.ts`: `loop` option, a seamless loop (reads past len, crossfades into the start, filters before the fold).
- `src/audio/samples.ts`: `SampleDef.loop` (Fade slider becomes "Loop crossfade"). `sampleBank.ts`: loops skip mix-under;
  the signature recuts once the procedural reference sound appears (flamers add theirs late).
- `src/audio/sfx.ts`: `soundVersion(name)` bumps on swap, so long loops restart on the recording.
- `src/weapons/weaponSound.ts`: procedural `swordSmash` (crack, crunch, thump, choked steel ring, debris) and `swordScrape`
  (fallback until the recording). `crunch()` helper.
- `src/weapons/sword.ts`: new group "Sword sound" (in WEAPON_TOPIC): swipe pitch per sword (Breaker 1, Buster 0.68, Short
  1.4), hits follow 0.5 of it, smash level 1, old slam under 0.55, scrape on metal 0.7, on flesh ×0.25, scrape delay 0.04 s.
- `src/weapons/arsenal.ts`: `swingPitch(side)` by base id, `hitSound()` = smash + old slam + scrape by PenMaterial.
- `src/convoy/convoySound.ts`: `ConvoySound`, a procedural 2 s `tankTracks` loop at the car nearest the listener, level by
  distance (full within 25 m, silent past 260 m) and speed, pitch by speed. Wired in `labs/convoy/main.ts` (topic Tracks
  and trail › Convoy sound).

## Left, in order
1. Get the files (folder tools in a fresh thread, or Keith commits them to a branch / uploads them).
2. Copy to `public/sounds/pixabay/` as `flamethrower`, `bladeonmetal`, `bladeswipe`, `tanktracks`, `metalhit` (.mp3, untouched;
   provenance row in `docs/assets.md`).
3. Add to `SAMPLES`: FlameRoar (`sound: "flameRoar"`, `loop: 0.25`), SwordScrape (`swordScrape`), SwordSwing (`swordSwing`,
   pitch about +3: Keith wants it sped up), TankTracks (`tankTracks`, `loop`), MetalHit (`metalHit`, Start near 0.9 s: find
   the onset numerically, spread 3+ semitones for variations). `tools/samples-check.ts` requires the ref sound's
   `addSound("x"` text in `weaponSound.ts`: extend it to also read `src/weapons/fire/fireGuns.ts`, `src/convoy/convoySound.ts`
   and `src/audio/sfx.ts` (metalHit is an Sfx kind via `add(`, not addSound: the bank's swapSound only covers addSound
   sounds, so metalHit needs a path: e.g. make the minigun/round hits play a new addSound `bulletMetal` and swap that).
4. Bullets on metal: check fortress containers/walls report surface "metal" so rounds play it (`src/expedition/fortresses.ts`,
   `src/game/sheetFire.ts` line ~193, `src/audio/minigunAudio.ts` hit()).
5. Analyse the smash clip (envelope, spectrum, decay rates, as the 2026-11-01 sword-hit entry in docs/decisions.md did) and
   retune `swordSmash` to it.
6. Flamer ignite: maybe cut `flameIgnite` from the flamethrower recording's onset too.
7. state.md (systems + Changes line), docs/decisions.md (tracks on the convoy: Claude's call, open for Keith; next fits are
   the crusher and excavators moving), sounds lab buttons for the new sounds, then `npm test`, separate PRs (swords;
   flamer + tracks + metal hit), squash-merge, "what to play and listen for" checklist.

## Test
Weapons lab `?left=sword` / `?w=` (pose lab names: sword, buster, shortsword) and hit robots; convoy lab, Tracks and trail ›
Convoy sound; sounds lab once the recordings are in.
