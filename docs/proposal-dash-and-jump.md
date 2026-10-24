# Proposal: dash now, jump later (not built; waiting for Keith)

Keith 2026-10-24: combat should feel reasonably powerful; next abilities a dodge or dash, later a small jump or leap
unlocked by an item, which opens salvage behind walls you'd otherwise walk round.

## Dash (build first)

- **Feel:** a hydraulic shove, not a teleport. Space bursts the mech 9 m in the WASD direction over about 0.45 s
  (toward the aim if no keys). Both feet stay planted and skid, carving two furrows and throwing a sand spray; the
  hull leans into it and rocks back at the end; then normal stepping resumes.
- **Charges:** 2, each back after 3 s (the old game's dodge rule: `maxCharges`, `cooldown`, `minInterval`).
- **Impact:** small robots clinging on are shaken off. Bandits and small robots in the path are knocked aside and
  take a little damage. Incoming damage is cut by half during the burst, which is only a slider for now; no
  invulnerability frames.
- **Files:**
  - `src/mech/dash.ts`: pure. It holds the state, the charges and the velocity over time.
  - `walker.ts`: a small hook for "carried" motion. While skidding, the body moves by an outside velocity and the
    feet slide with it, instead of stepping.
  - `mechUnit.ts`: runs the dash and sends the shove to the swarms.
  - `fx`: furrows from `sandMarks`, spray from `dust`.
  - The walker lab and the combat labs get Space.
- **Sliders** ("Dash" group under Your mech): distance, time, charges, recharge, lean, skid furrow, shove radius and
  force, damage cut.
- **Check:** feet stay on the ground through a dash, no NaN, reach misses within the walk's limits, charges refill.

## Jump (later, unlocked by an item)

- **Feel:** about 0.3 s crouching to load, then a ballistic leap of about 6 m up and 15 m forward. The legs tuck in
  flight and reach for the ground before landing. The landing stomps: a dust ring, a crater, bandits and small robots
  knocked down within a few metres, and a camera kick.
- **Needs:** an airborne state in the walker (no stance, legs posed toward the predicted landing), landing
  absorption, and terrain or props that are worth jumping. The convoy's gaps and walls would be the first.
- **Item gate:** a flag on the mech's parts once salvage and items exist; in the labs it's simply on.

## Open questions for Keith

- Is Space right for the dash? Shift is sprint.
- Dash in the WASD direction (dodge-like) or toward the aim (charge-like)? I've defaulted to WASD.
