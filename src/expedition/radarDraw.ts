// The radar scope (drawing, docs/proposal-expedition.md): a round scope on a small 2D canvas over the game, turned so
// up on the scope is up on the screen. A sweep goes round; contacts are painted as it passes and fade until it comes
// back (robots fade out entirely; POIs, the convoy's knowledge, stay faintly). Heat blobs for swarms, static for the
// unknown areas, the route ahead dashed, the convoy's cars and its range edge, the mech in the middle, and the arrow
// home: on the rim when the return point is out of range (pulsing when fuel is short), a ring on it when in range.
import type { RadarPicture, RadarValues } from "./radar";

interface Painted { x: number; z: number; glow: number; kind: "poi" | "robot"; tier: number; size: number; stripped?: boolean }

const TAU = Math.PI * 2;
const INK = "#9fe3d0";
const AMBER = "#ffb347";
const RED = "#ff5a3c";

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
    const S = Math.round(v.radarSize);
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
        this.painted.set(b.id, { x: b.x, z: b.z, glow: b.kind === "poi" ? 0.01 : 0, kind: b.kind, tier: b.tier, size: b.size, stripped: b.stripped });
      }
      const q = this.painted.get(b.id)!;
      q.stripped = b.stripped;
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
      const pulse = b.awake ? 0.75 + 0.25 * Math.sin(this.time * 6) : 1;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const a = (0.4 + 0.5 * b.heat) * pulse;
      g.addColorStop(0, `rgba(255, ${Math.round(150 - 90 * b.heat)}, 40, ${a})`);
      g.addColorStop(0.55, `rgba(255, ${Math.round(110 - 70 * b.heat)}, 30, ${a * 0.45})`);
      g.addColorStop(1, "rgba(255, 60, 20, 0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
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
    // The convoy's cars.
    ctx.fillStyle = INK;
    for (const car of pic.convoy) {
      const [x, y] = at(car.x, car.z);
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(Math.sin(upYaw - car.heading), Math.cos(upYaw - car.heading)));
      const l = Math.max(6, car.length * scale), w = Math.max(3, car.width * scale);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.7)"; ctx.lineWidth = 1;
      ctx.strokeRect(-w / 2, -l / 2, w, l);
      ctx.fillRect(-w / 2, -l / 2, w, l);
      ctx.restore();
    }
    // Blips.
    for (const p of this.painted.values()) {
      const [x, y] = at(p.x, p.z);
      if (p.kind === "robot") {
        if (p.glow <= 0) continue;
        ctx.fillStyle = `rgba(255, 90, 60, ${Math.min(1, p.glow * 1.2)})`;
        ctx.beginPath(); ctx.arc(x, y, 1.6 + p.size * 0.9, 0, TAU); ctx.fill();
      } else {
        const a = 0.4 + 0.6 * Math.max(0, p.glow), s = p.tier >= 2 ? 5 : 3.5;
        ctx.globalAlpha = a;
        ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath();
        if (p.stripped) { ctx.strokeStyle = "#8a8578"; ctx.lineWidth = 1; ctx.stroke(); }
        else { ctx.fillStyle = p.tier >= 2 ? "#ffd27a" : AMBER; ctx.fill(); }
        ctx.globalAlpha = 1;
      }
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
      ctx.save(); ctx.translate(c, c); ctx.rotate(a);
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
        const tip = R + 4, base = R - 12;
        ctx.beginPath(); ctx.moveTo(0, -tip); ctx.lineTo(8, -base); ctx.lineTo(0, -base + 4); ctx.lineTo(-8, -base); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = 1;
        // Distance by the arrow.
        const lx = c + Math.sin(a) * (R - 24), ly = c - Math.cos(a) * (R - 24);
        ctx.font = "600 11px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillText(dist(pic.home.dist), lx + 1, ly + 1);
        ctx.fillStyle = hc; ctx.fillText(dist(pic.home.dist), lx, ly);
      }
    }
    // Label on a plate at the bottom of the scope.
    const label = `${pic.mode === "convoy" ? "CONVOY RADAR" : "MECH RADAR"} · ${dist(range)}`;
    ctx.font = "600 10px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const lw = ctx.measureText(label).width + 12;
    ctx.fillStyle = "rgba(6, 16, 16, 0.92)"; ctx.strokeStyle = "rgba(159, 227, 208, 0.65)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(c - lw / 2, S - 17, lw, 15, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "rgba(159, 227, 208, 0.95)";
    ctx.fillText(label, c, S - 9.5);
  }
}

function dist(m: number) { return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`; }
