// Minimal PNG read and write for the offline tools (8-bit greyscale, RGB, RGBA or palette, not interlaced).
import { deflateSync, inflateSync } from "node:zlib";

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b: Uint8Array) => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };

/** Decode to top-row-first RGBA. */
export function decodePng(buf: Uint8Array): { w: number; h: number; data: Uint8Array } {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  const idat: Buffer[] = [];
  let palette: Buffer | null = null, trns: Buffer | null = null;
  while (p < b.length) {
    const len = b.readUInt32BE(p), t = b.toString("latin1", p + 4, p + 8), d = b.subarray(p + 8, p + 8 + len);
    if (t === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; interlace = d[12]; }
    else if (t === "PLTE") palette = d;
    else if (t === "tRNS") trns = d;
    else if (t === "IDAT") idat.push(d);
    else if (t === "IEND") break;
    p += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error(`png: depth ${depth}, interlace ${interlace} not supported`);
  const ch = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  const raw = inflateSync(Buffer.concat(idat)), stride = w * ch;
  const px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[o + x - ch] : 0, up = y ? px[o - stride + x] : 0, c = x >= ch && y ? px[o - stride + x - ch] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      px[o + x] = v & 255;
    }
  }
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * ch, o = i * 4;
    if (type === 3 && palette) { const k = px[s]; out[o] = palette[k * 3]; out[o + 1] = palette[k * 3 + 1]; out[o + 2] = palette[k * 3 + 2]; out[o + 3] = trns && k < trns.length ? trns[k] : 255; }
    else if (ch <= 2) { out[o] = out[o + 1] = out[o + 2] = px[s]; out[o + 3] = ch === 2 ? px[s + 1] : 255; }
    else { out[o] = px[s]; out[o + 1] = px[s + 1]; out[o + 2] = px[s + 2]; out[o + 3] = ch === 4 ? px[s + 3] : 255; }
  }
  return { w, h, data: out };
}

/** Encode top-row-first RGBA. */
export function encodePng(w: number, h: number, rgba: Uint8Array): Buffer {
  const chunk = (t: string, d: Buffer) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t, "latin1"), d]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([l, td, c]);
  };
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
