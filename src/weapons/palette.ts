// Paint sections and schemes for weapon models. Every face of a weapon (converted from the old kit, or built by
// src/weapons/kit/) belongs to one of the kit's eight paint sections; a scheme gives each section a colour, so a
// paint job is a swap of eight colours (a uniform change, no new geometry). Brand rows are the old kit's
// (tools/blender/brands/*.json there); the default "Rampart" scheme matches the mech's khaki, olive and dark steel.

export const SECTIONS = ["plating", "secondary", "dark", "mechanical", "trim", "lighting", "detail", "visor"] as const;
export type Section = (typeof SECTIONS)[number];
export const SECTION = Object.fromEntries(SECTIONS.map((s, i) => [s, i])) as Record<Section, number>;
/** Sections that glow: lamps at full strength, visors and lenses faintly (the kit's emission shares). */
export const GLOW_SHARE: Partial<Record<Section, number>> = { lighting: 1, visor: 0.35 };
/** Sections with bare metal (glints: lower roughness, some metalness). */
export const METAL_SHARE: Partial<Record<Section, number>> = { mechanical: 1, detail: 0.7 };

export interface Scheme { name: string; colors: Record<Section, number> }

export const SCHEMES: Scheme[] = [
  { name: "Rampart", colors: { plating: 0xb9a676, secondary: 0x737b4b, dark: 0x34322d, mechanical: 0x6b6862, trim: 0xe0d4ae, lighting: 0xffb347, detail: 0xc8c2b0, visor: 0x7fd0e0 } },
  { name: "Goliath Earthworks", colors: { plating: 0xe2a428, secondary: 0xd2692a, dark: 0x2b2825, mechanical: 0x6a6a66, trim: 0x1e1e1e, lighting: 0xffd27a, detail: 0xc9cbcb, visor: 0x7fb2c2 } },
  { name: "Stratford-Aegis", colors: { plating: 0x59626b, secondary: 0x8e979e, dark: 0x1f2226, mechanical: 0x5a5a58, trim: 0xd6d2c4, lighting: 0xff5a3c, detail: 0xb9bcb8, visor: 0xe8a33a } },
  { name: "Akiyama Motors", colors: { plating: 0xa89571, secondary: 0xb6a47f, dark: 0x3a332a, mechanical: 0x5d5f63, trim: 0x75654a, lighting: 0xffb347, detail: 0xc2b595, visor: 0x3e5a58 } },
  { name: "Novus-Lux", colors: { plating: 0xe4e8f0, secondary: 0x7d8fb8, dark: 0x2a3142, mechanical: 0x8d93a3, trim: 0x8e6cc0, lighting: 0x3fe6d8, detail: 0xf5f6fa, visor: 0x2bb8d0 } },
  { name: "Bandit red", colors: { plating: 0x9a3b24, secondary: 0x4a3a2c, dark: 0x2a2420, mechanical: 0x5e5a54, trim: 0xd8c9a0, lighting: 0xff6a2a, detail: 0xa8a090, visor: 0xffa040 } },
  { name: "Dune camo", colors: { plating: 0xcdb58a, secondary: 0x8f7650, dark: 0x3a3128, mechanical: 0x6c665c, trim: 0x2e2a24, lighting: 0xffc060, detail: 0xb8ad94, visor: 0x9fd8c8 } },
];

/** The scheme a brand's models were painted in (a weapon keeps its brand look unless repainted). */
export function brandScheme(brand: string) { return Math.max(0, SCHEMES.findIndex((s) => s.name === brand)); }
