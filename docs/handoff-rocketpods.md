# Handoff: rocket pods (wip/rocketpods)

Keith 2026-10-31: rocket pods fire too often, should be clip-fed with a visible reload; rockets look like cruise
missiles; arm missiles should channel like the shoulder battery.

## Done
- Clip-fed rockets: hull `rpg-medium` clip 4, ripple 0.45 s, reload 8 s, damage 340 (sheet 146 -> 145 DPS); shoulder
  clip 3, reload 9 (90 -> 93). A part-used clip is swapped after `rocketTopUp` 2.5 s off the trigger. Tubes fire in
  order (`nextTube`, src/weapons/clip.ts). Clank out / clunk in sounds (`clipOut`, `clipIn`, weaponSound.ts).
- Models (src/weapons/build/rockets.ts, catalog ids `rocket-pod-hull`, `rocket-pod-shoulder`, `missile-pod-arm`): a clip
  of tubes with bright warhead tips (Missile_n) that go dark as they fire; on a reload the Clip drops, is gone, a full one
  rises (clipPose in clip.ts, driven by `WeaponModel.clip = mag` in modelSwap.ts).
- Slim rocket in flight: `rocket-thin` (code, 1 m, fins) scaled by `rocketLength` 1.25, flare `rocketFlare` 0.45.
- Arm `rpg-light` is now the **Arm missile pod**: hold to channel, a missile per 0.25 s (`podCooldown`) out of a clip
  of 8 (`podMag`, reload 6 s) at the lock / enemies within `podReach` 5 m in turn / a scatter; walk x0.7 while
  channelling (`podSlow`, `Arsenal.moveMul`, applied in mechUnit.step). Damage 0.4 x 340 = 136 (sheet 140 DPS).
- Check: tools/rocketclip-check.ts (in npm test). Balance sheet lists the arm pod.

## Left
- Nothing in code. Full npm test passes. Not seen rendered (no browser here): Keith to look at the clip models and the arm pod placement.

## Test
Robots lab `?barrage&time=22`, `?barrage=arms`; weapons lab `?right=rocketpod`, `?left=rpg`.
