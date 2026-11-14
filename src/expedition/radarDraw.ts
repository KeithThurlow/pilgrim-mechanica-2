// The radar scope (drawing, docs/proposal-expedition.md): a round scope on a small 2D canvas over the game, turned so
// up on the scope is up on the screen. A sweep goes round; contacts are painted as it passes and fade until it comes
// back (robots fade out entirely; POIs, the convoy's knowledge, stay faintly). Heat blobs for swarms, static for the
// unknown areas, the route ahead dashed, the convoy's cars and its range edge, the mech in the middle, and the arrow
// home: on the rim when the return point is out of range (pulsing when fuel is short), a ring on it when in range.
// Keith 2026-11-01: the scope about twice the size (radarSize), the convoy bright cyan with a ring and a label (a
// cyan bar on the rim when it's off the scope), mission targets bright green, bigger and ringed, distance always shown.
// Keith 2026-11-14 ("too many glowing icons, hard to read"): enemies only inside the mech's sensor range (a faint ring
// shows where that is on the convoy's scope), heat blobs and glows toned down (radarHeatAlpha, radarBloom), and the
// POIs as clear steady marks with a dark edge: small diamonds for tier 1, bigger gold ones for tier 2-4, a square with
// its name for the fortresses and hubs; grey when stripped.
import { POI_KINDS, type PoiKind } from "../world/pois";
import type { RadarPicture, RadarValues } from "./radar";

interface Painted { x: number; z: number; glow: number; kind: "poi" | "robot" | "pad"; tier: number; size: number; stripped?: boolean; faction?: number; label?: string }
/** Heat and contact colours per faction (0 robots: orange-red as before; 1 raiders: magenta). */
const FACTION_RGB = [[255, 90, 60], [255, 70, 170]] as const;

const TAU = Math.PI * 2;
const AMBER = "#ffb347";
const RED = "#ff5a3c";
/** The convoy (Keith 2026-11-01: "really hard to see where the convoy is"): bright cyan cars, a ring and a rim marker. */
const CONVOY = "#3fe6ff";

export class RadarDraw {
  readonly canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private painted = new Map<string, Painted>();
  private sweep = 0;
  private noise: HTMLCanvasElement;
  private time = 0;
  private px = 0;

  constructor(public v: RadarValues) {
    this.ctx = this.canvas.getContext("2d")!;
    Object.assign(this.canvas.style, { display: "block", pointerEvents: "none" } as CSSStyleDeclaration);
    // Static for the unknown areas: a tile of grey speckle, drawn shifted every frame.
    this.noise = document.createElement("canvas");
    this.noise.width = this.noise.height = 96;
    const n = this.noise.getContext("2d")!, img = n.createImageData(96, 96);
    for (let i = 0; i < 96 * 96; i++) {
      const g = Math.random() < 0.5 ? 40 + Math.random() * 60 : 120 + Math.random() * 110;
      img.data[i * 4] = g; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = g * 0.95; img.data[i * 4 + 3] = 255;
    }
    n.putImageData(img, 0, 0);
  }

  /**
   * Draw a frame. range: the range on show now (m, mid-zoom between the two); upYaw: the world heading that is up on
   * the screen (the camera's facing); heading: the mech's; warn: 0 ok, 1 amber, 2 red.
   */
  draw(dt: number, pic: RadarPicture, range: number, upYaw: number, heading: number, warn: 0 | 1 | 2) {
    const v = this.v, dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    // Never more than ~40% of the screen's short side (Keith 2026-11-07: on his phone the 520 px scope filled it).
    const S = Math.round(Math.min(v.radarSize, (document.documentElement.classList.contains("touch") ? 0.3 : 0.4) * Math.min(innerWidth, innerHeight)));
    if (this.px !== S * dpr) {
      this.px = S * dpr;
      this.canvas.width = this.canvas.height = this.px;
      this.canvas.style.width = this.canvas.style.height = `${S}px`;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    this.time += dt;
    const c = S / 2, R = c - 6, scale = R / Math.max(1, range);
    // Marks and text grow with the scope, but slower than it (the scope was drawn at 240 px).
    const k = Math.max(1, Math.sqrt(S / 240));
    const font = (px: number) => `600 ${Math.round(px * k)}px system-ui, sans-serif`;
    const sy = Math.sin(upYaw), cy = Math.cos(upYaw);
    // World offset to the scope: up along the camera's facing, right to its right.
    const at = (dx: number, dz: number): [number, number] => {
      const up = dx * sy + dz * cy, right = -dx * cy + dz * sy;
      return [c + right * scale, c - up * scale];
    };

    // The sweep: blips are painted as it passes over them.
    const prev = this.sweep;
    this.sweep = (this.sweep + (dt / Math.max(0.2, v.radarSweep)) * TAU) % TAU;
    const passed = (a: number) => {
      const d = (a - prev + TAU) % TAU, span = (this.sweep - prev + TAU) % TAU;
      return d <= span;
    };
    const live = new Set<string>();
    for (const b of pic.blips) {
      live.add(b.id);
      const [x, y] = at(b.x, b.z);
      const a = (Math.atan2(x - c, c - y) + TAU) % TAU;
      const p = this.painted.get(b.id);
      if (!p) {
        // POIs (the convoy's charts) show at once, faint; robots wait for the sweep.
        this.painted.set(b.id, { x: b.x, z: b.z, glow: b.kind === "robot" ? 0 : 0.01, kind: b.kind, tier: b.tier, size: b.size, stripped: b.stripped, faction: b.faction, label: b.label });
      }
      const q = this.painted.get(b.id)!;
      q.stripped = b.stripped; q.label = b.label;
      if (passed(a)) { q.x = b.x; q.z = b.z; q.glow = 1; }
    }
    const fade = dt / Math.max(0.05, v.radarSweep * v.radarGlow);
    for (const [id, p] of this.painted) {
      p.glow -= fade;
      if (p.glow <= 0 && (!live.has(id) || p.kind === "robot")) { if (!live.has(id)) this.painted.delete(id); else p.glow = 0; }
    }

    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, R, 0, TAU); ctx.clip();
    // Scope face.
    const face = ctx.createRadialGradient(c, c, 0, c, c, R);
    face.addColorStop(0, "rgba(14, 34, 32, 0.92)"); face.addColorStop(1, "rgba(6, 16, 16, 0.94)");
    ctx.fillStyle = face; ctx.fillRect(0, 0, S, S);
    // Range rings and cross.
    ctx.strokeStyle = "rgba(159, 227, 208, 0.13)"; ctx.lineWidth = 1;
    for (const k of [1 / 3, 2 / 3]) { ctx.beginPath(); ctx.arc(c, c, R * k, 0, TAU); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(c - R, c); ctx.lineTo(c + R, c); ctx.moveTo(c, c - R); ctx.lineTo(c, c + R); ctx.stroke();

    // Unknown areas: static, nothing known.
    for (const f of pic.fog) {
      const [x, y] = at(f.x, f.z), r = f.r * scale;
      if (r < 2) continue;
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip();
      ctx.globalAlpha = 0.32;
      const ox = Math.floor(Math.random() * 96), oy = Math.floor(Math.random() * 96);
      for (let yy = y - r - oy; yy < y + r; yy += 96) for (let xx = x - r - ox; xx < x + r; xx += 96) ctx.drawImage(this.noise, xx, yy);
      ctx.restore();
      ctx.setLineDash([3, 4]); ctx.strokeStyle = "rgba(200, 200, 190, 0.35)";
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      if (r > 12) { ctx.fillStyle = "rgba(220, 220, 210, 0.6)"; ctx.font = `600 ${Math.min(14, r * 0.5)}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("?", x, y); }
    }
    // Swarms: heat blobs, a rough guess of danger.
    for (const b of pic.blobs) {
      const [x, y] = at(b.x, b.z), r = Math.max(7, b.r * scale);
      const pulse = b.awake ? 0.85 + 0.15 * Math.sin(this.time * 4) : 1;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const a = (0.4 + 0.5 * b.heat) * pulse * v.radarHeatAlpha;
      if (b.faction === 1) {
        // Raiders: magenta heat, hotter toward white-pink.
        g.addColorStop(0, `rgba(255, ${Math.round(90 + 60 * b.heat)}, 200, ${a})`);
        g.addColorStop(0.55, `rgba(230, 60, 170, ${a * 0.45})`);
        g.addColorStop(1, "rgba(200, 40, 160, 0)");
      } else {
        g.addColorStop(0, `rgba(255, ${Math.round(150 - 90 * b.heat)}, 40, ${a})`);
        g.addColorStop(0.55, `rgba(255, ${Math.round(110 - 70 * b.heat)}, 30, ${a * 0.45})`);
        g.addColorStop(1, "rgba(255, 60, 20, 0)");
      }
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      // Two factions at each other's throats: a white flicker ring (a fight we are not watching).
      if (b.fighting) {
        const f = 0.35 + 0.65 * Math.abs(Math.sin(this.time * 17 + x * 0.3) * Math.sin(this.time * 7.3 + y));
        ctx.strokeStyle = `rgba(255, 245, 210, ${f})`; ctx.lineWidth = 1.5; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.arc(x, y, r * (0.55 + 0.25 * f), 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // Depth rings: bands of rising danger either side of the road, faint (each ring adds a layer).
    if (pic.band && pic.band.pts.length > 1) {
      ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "rgba(255, 120, 70, 0.045)";
      for (const r of pic.band.rings) {
        ctx.lineWidth = Math.max(2, 2 * r * scale);
        ctx.beginPath();
        pic.band.pts.forEach((p, i) => { const [x, y] = at(p.x, p.z); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        ctx.stroke();
      }
      ctx.lineCap = "butt";
    }
    // The route ahead.
    if (pic.route.length > 1) {
      ctx.setLineDash([5, 5]); ctx.strokeStyle = "rgba(159, 227, 208, 0.55)"; ctx.lineWidth = 1.5;
      ctx.beginPath();
      pic.route.forEach((p, i) => { const [x, y] = at(p.x, p.z); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke(); ctx.setLineDash([]);
    }
    // The convoy's range edge.
    if (pic.edge) {
      const [x, y] = at(pic.edge.x, pic.edge.z);
      ctx.setLineDash([2, 5]); ctx.strokeStyle = "rgba(159, 227, 208, 0.4)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, pic.edge.r * scale, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    // How far the mech's sensors see enemies: a faint ring when it sits inside the scope.
    if (pic.sense && pic.sense * scale < R - 6) {
      ctx.strokeStyle = "rgba(255, 150, 110, 0.28)"; ctx.lineWidth = 1; ctx.setLineDash([1, 4]);
      ctx.beginPath(); ctx.arc(c, c, pic.sense * scale, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    // Home: a ring on the point when it's in range.
    const pulse = warn ? 0.6 + 0.4 * Math.sin(this.time * (warn === 2 ? 12 : 7)) : 1;
    const hc = warn === 2 ? RED : AMBER;
    if (pic.home) {
      const [x, y] = at(pic.home.x, pic.home.z);
      if (Math.hypot(x - c, y - c) < R - 10) {
        ctx.globalAlpha = pulse; ctx.strokeStyle = hc; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 1.5, 0, TAU); ctx.fillStyle = hc; ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    // The convoy's cars: bright, outlined, glowing; a slow ring and a label on the nearest so it reads at a glance.
    if (pic.convoy.length) {
      ctx.save();
      ctx.shadowColor = CONVOY; ctx.shadowBlur = 8 * k * v.radarBloom;
      ctx.fillStyle = CONVOY;
      for (const car of pic.convoy) {
        const [x, y] = at(car.x, car.z);
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(Math.sin(upYaw - car.heading), Math.cos(upYaw - car.heading)));
        const l = Math.max(7 * k, car.length * scale), w = Math.max(4 * k, car.width * scale);
        ctx.fillRect(-w / 2, -l / 2, w, l);
        ctx.restore();
      }
      ctx.restore();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.75)"; ctx.lineWidth = 1;
      for (const car of pic.convoy) {
        const [x, y] = at(car.x, car.z);
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(Math.sin(upYaw - car.heading), Math.cos(upYaw - car.heading)));
        const l = Math.max(7 * k, car.length * scale), w = Math.max(4 * k, car.width * scale);
        ctx.strokeRect(-w / 2, -l / 2, w, l);
        ctx.restore();
      }
      if (pic.convoyAt) {
        const [x, y] = at(pic.convoyAt.x, pic.convoyAt.z);
        const ring = (12 + 3 * Math.sin(this.time * 2.5)) * k;
        ctx.strokeStyle = "rgba(63, 230, 255, 0.55)"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, ring, 0, TAU); ctx.stroke();
        ctx.font = font(11); ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillText("CONVOY", x + ring + 4 + 1, y + 1);
        ctx.fillStyle = CONVOY; ctx.fillText("CONVOY", x + ring + 4, y);
      }
    }
    // Blips (POIs gathered and drawn after, on top).
    const pois: Painted[] = [];
    for (const p of this.painted.values()) {
      const [x, y] = at(p.x, p.z);
      if (p.kind === "robot") {
        if (p.glow <= 0) continue;
        const rgb = FACTION_RGB[p.faction ?? 0] ?? FACTION_RGB[0];
        ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.min(1, p.glow * 1.2)})`;
        ctx.beginPath(); ctx.arc(x, y, 1.6 + p.size * 0.9, 0, TAU); ctx.fill();
      } else if (p.kind === "pad") {
        // An extraction pad: a pale blue ring with a dot (a pulsing ring while a call is on it), the price beside it up close.
        ctx.globalAlpha = 0.55 + 0.45 * Math.max(0, p.glow);
        ctx.strokeStyle = "#8fd0ff"; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(x, y, 4.5, 0, TAU); ctx.stroke();
        ctx.fillStyle = "#8fd0ff"; ctx.beginPath(); ctx.arc(x, y, 1.6, 0, TAU); ctx.fill();
        if (p.stripped) { ctx.strokeStyle = "#ffffff"; ctx.beginPath(); ctx.arc(x, y, 7 + 2 * Math.sin(this.time * 6), 0, TAU); ctx.stroke(); }
        if (p.label) { ctx.font = "600 10px system-ui, sans-serif"; ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillText(p.label, x + 8, y + 4); ctx.fillStyle = "#cfeaff"; ctx.fillText(p.label, x + 7, y + 3); }
        ctx.globalAlpha = 1;
      } else pois.push(p);
    }
    // POIs on top of everything but the sweep: steady (the convoy's charts), a dark edge so they read on any heat.
    const ps = k * v.radarPoiSize;
    for (const p of pois) {
      const [x, y] = at(p.x, p.z);
      ctx.globalAlpha = 0.85 + 0.15 * Math.max(0, p.glow);
      ctx.lineWidth = 1.2; ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
      if (p.tier >= 5) {
        // A fortress or a hub: a square with a notch, and its name.
        const s = 5.5 * ps;
        ctx.fillStyle = p.stripped ? "#8a8578" : "#ff9a5a";
        ctx.fillRect(x - s, y - s, s * 2, s * 2); ctx.strokeRect(x - s, y - s, s * 2, s * 2);
        ctx.fillStyle = "rgba(0, 0, 0, 0.55)"; ctx.fillRect(x - s * 0.4, y - s * 0.4, s * 0.8, s * 0.8);
        const name = (POI_KINDS[p.label as PoiKind]?.label ?? "").toUpperCase();
        if (name) {
          ctx.font = font(9); ctx.textAlign = "center"; ctx.textBaseline = "top";
          ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillText(name, x + 1, y + s + 3);
          ctx.fillStyle = "#ffd2b0"; ctx.fillText(name, x, y + s + 2);
        }
      } else {
        const s = (p.tier >= 2 ? 5.5 : 4) * ps;
        ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath();
        if (p.stripped) { ctx.fillStyle = "rgba(60, 58, 52, 0.9)"; ctx.fill(); ctx.strokeStyle = "#8a8578"; ctx.stroke(); }
        else { ctx.fillStyle = p.tier >= 2 ? "#ffd27a" : AMBER; ctx.fill(); ctx.stroke(); }
      }
      ctx.globalAlpha = 1;
    }
    // The sweep wedge.
    const sw = this.sweep - Math.PI / 2;
    for (let k = 0; k < 12; k++) {
      ctx.fillStyle = `rgba(159, 227, 208, ${0.10 * (1 - k / 12)})`;
      ctx.beginPath(); ctx.moveTo(c, c); ctx.arc(c, c, R, sw - (k + 1) * 0.045, sw - k * 0.045); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = "rgba(159, 227, 208, 0.7)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + Math.cos(sw) * R, c + Math.sin(sw) * R); ctx.stroke();
    // The mech.
    {
      const a = Math.atan2(Math.sin(upYaw - heading), Math.cos(upYaw - heading));
      ctx.save(); ctx.translate(c, c); ctx.rotate(a); ctx.scale(k, k);
      ctx.fillStyle = "#f4f1ea"; ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.2, 4.5); ctx.lineTo(0, 2.4); ctx.lineTo(-4.2, 4.5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    // Rim, the arrow home on it, and the label.
    ctx.strokeStyle = "rgba(159, 227, 208, 0.65)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(c, c, R, 0, TAU); ctx.stroke();
    if (pic.home) {
      const [x, y] = at(pic.home.x, pic.home.z);
      const out = Math.hypot(x - c, y - c) >= R - 10;
      if (out || pic.mode === "mech") {
        const a = Math.atan2(x - c, c - y);
        ctx.save(); ctx.translate(c, c); ctx.rotate(a);
        ctx.globalAlpha = pulse;
        ctx.fillStyle = hc; ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 1;
        const tip = R + 4, base = R - 12 * k;
        ctx.beginPath(); ctx.moveTo(0, -tip); ctx.lineTo(8 * k, -base); ctx.lineTo(0, -base + 4 * k); ctx.lineTo(-8 * k, -base); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = 1;
        // Distance by the arrow.
        const lx = c + Math.sin(a) * (R - 24 * k), ly = c - Math.cos(a) * (R - 24 * k);
        ctx.font = font(11); ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillText(dist(pic.home.dist), lx + 1, ly + 1);
        ctx.fillStyle = hc; ctx.fillText(dist(pic.home.dist), lx, ly);
      }
    }
    // The convoy off the scope: a cyan bar on the rim the way it lies, with its distance.
    if (pic.convoyAt) {
      const [x, y] = at(pic.convoyAt.x, pic.convoyAt.z);
      if (Math.hypot(x - c, y - c) >= R - 8) {
        const a = Math.atan2(x - c, c - y);
        ctx.save(); ctx.translate(c, c); ctx.rotate(a);
        ctx.shadowColor = CONVOY; ctx.shadowBlur = 8 * k * v.radarBloom;
        ctx.fillStyle = CONVOY; ctx.fillRect(-9 * k, -R - 3, 18 * k, 6 * k);
        ctx.shadowBlur = 0; ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.lineWidth = 1; ctx.strokeRect(-9 * k, -R - 3, 18 * k, 6 * k);
        ctx.restore();
        const lx = c + Math.sin(a) * (R - 20 * k), ly = c - Math.cos(a) * (R - 20 * k);
        ctx.font = font(10); ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(0,0,0,0.65)"; ctx.fillText(`CONVOY ${dist(pic.convoyAt.dist)}`, lx + 1, ly + 1);
        ctx.fillStyle = CONVOY; ctx.fillText(`CONVOY ${dist(pic.convoyAt.dist)}`, lx, ly);
      }
    }
    // The seeker: a blue diamond on the target, or on the rim pointing at it, with its distance. Mission targets
    // (contracts, high value targets) in bright green, bigger, with a pulsing ring and their distance always shown.
    const diamond = (tx: number, tz: number, d: number, colour: string, size: number, mission = false) => {
      const [x, y] = at(tx, tz);
      const a = Math.atan2(x - c, c - y), out = Math.hypot(x - c, y - c) >= R - 8;
      const px = out ? c + Math.sin(a) * (R - 4) : x, py = out ? c - Math.cos(a) * (R - 4) : y;
      if (mission) {
        const ring = size * (1.9 + 0.6 * ((this.time * 1.4) % 1));
        ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.globalAlpha = 1 - ((this.time * 1.4) % 1) * 0.8;
        ctx.beginPath(); ctx.arc(px, py, ring, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
      }
      ctx.save(); ctx.translate(px, py); ctx.rotate(Math.PI / 4);
      if (mission) { ctx.shadowColor = colour; ctx.shadowBlur = 10 * k * v.radarBloom; }
      ctx.fillStyle = colour; ctx.strokeStyle = "rgba(0,0,0,0.75)"; ctx.lineWidth = 1.2;
      ctx.fillRect(-size, -size, size * 2, size * 2); ctx.shadowBlur = 0; ctx.strokeRect(-size, -size, size * 2, size * 2);
      ctx.restore();
      if (out || mission) {
        const lx = out ? c + Math.sin(a) * (R - 22 * k) : px, ly = out ? c - Math.cos(a) * (R - 22 * k) : py + size * 2.6;
        ctx.font = font(mission ? 11 : 10); ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(0,0,0,0.65)"; ctx.fillText(dist(d), lx + 1, ly + 1);
        ctx.fillStyle = colour; ctx.fillText(dist(d), lx, ly);
      }
    };
    if (pic.seek) diamond(pic.seek.x, pic.seek.z, pic.seek.dist, "#9fd8ff", 4.5 * k);
    for (const q of pic.quests ?? []) diamond(q.x, q.z, q.dist, q.color, (q.kind === "hvt" ? 7.5 : 6) * k, true);
    // Label on a plate at the bottom of the scope.
    const label = `${pic.mode === "convoy" ? "CONVOY RADAR" : "MECH RADAR"} · ${dist(range)}`;
    ctx.font = font(10); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const lw = ctx.measureText(label).width + 12;
    ctx.fillStyle = "rgba(6, 16, 16, 0.92)"; ctx.strokeStyle = "rgba(159, 227, 208, 0.65)"; ctx.lineWidth = 1;
    const lh = 15 * k;
    ctx.beginPath(); ctx.roundRect(c - lw / 2, S - lh - 2, lw, lh, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "rgba(159, 227, 208, 0.95)";
    ctx.fillText(label, c, S - 2 - lh / 2);
  }
}

function dist(m: number) { return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`; }
