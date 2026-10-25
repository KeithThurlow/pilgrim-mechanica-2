// Rampart variants (Keith 2026-10-24: seven built in parallel by mech-modeler agents). Each is a model at
// public/models/mechs/<id>.glb with the Rampart's parts and joint empties (tools/blender/mechs/variants/<id>/,
// notes in docs/mechs/<id>/), picked with ?mech=<id> in any lab. This table holds what the model can't say:
// where the game's back kit (two ammo drums and the stand-in power pack) hangs, and its paint.
// Walk and feet live in LEG_TYPES under the same id when a variant's legs differ from the Rampart's.

export interface MechVariant {
  id: string;
  name: string;
  brand: string;
  /** Back kit origin in the hull (waist) frame, metres; the Rampart's is [0, 0.25, -1.12]. */
  backAt?: [number, number, number];
  /** Back kit paint: the drums' tint, the pack's body and its cells (the Rampart's olive and khaki by default). */
  drumTint?: number;
  packBody?: number;
  packCells?: number;
}

export const RAMPART_BACK: [number, number, number] = [0, 0.25, -1.12];

export const MECH_VARIANTS: Record<string, MechVariant> = {
  // Shorter, narrower torso: the kit comes in and down to its back (rear 0.30 m further forward, back roof 0.27 lower).
  "rampart-stilt": { id: "rampart-stilt", name: "Rampart Stilt", brand: "Suzaku Dynamics", backAt: [0, -0.02, -0.82] },
  "rampart-turret": {
    id: "rampart-turret", name: "Rampart Turret", brand: "Stratford-Aegis",
    drumTint: 0x7a8085, packBody: 0xa7abae, packCells: 0x4d5257,
  },
  "rampart-railgun": {
    id: "rampart-railgun", name: "Rampart Railgun", brand: "Novus-Lux",
    drumTint: 0x7f879a, packBody: 0xc4c8d2, packCells: 0x56607a,
  },
  // Squatter hull: the kit drops with its back roof (0.20 m lower).
  "rampart-siege": {
    id: "rampart-siege", name: "Rampart Siege", brand: "Valhalla Munitions", backAt: [0, 0.05, -1.12],
    drumTint: 0x6d7275, packBody: 0x83888b, packCells: 0x4b5054,
  },
  // Cab torso 0.35 m shallower than the Rampart's hull: the kit comes in to its back; Goliath charcoal and yellow.
  "rampart-salvager": {
    id: "rampart-salvager", name: "Rampart Salvager", brand: "Goliath Earthworks", backAt: [0, 0.1, -0.87],
    drumTint: 0xc99a2e, packBody: 0x55575a, packCells: 0xd9a51f,
  },
  "rampart-rocket": { id: "rampart-rocket", name: "Rampart Rocket", brand: "Akiyama Motors" },
  "rampart-wildcat": { id: "rampart-wildcat", name: "Rampart Wildcat", brand: "Wildcat / Scrap-Crafted" },
};
