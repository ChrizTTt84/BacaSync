/* eslint-disable */
/**
 * Genera iconos BacaSync SIN dependencias nativas (no sharp, no canvas, no node-gyp).
 * Salidas:
 *   assets/icon.png          512x512 (origen)
 *   assets/icon-32.png       32x32   (tray windows fallback)
 *   assets/icon-16.png       16x16   (tray small)
 *   assets/icon-mac.png      1024x1024 (para ICNS posteriormente)
 *
 * El dibujo es super simple:
 *   - Fondo: gradiente radial (morado #6a55f7 -> azul #2a83ff)
 *   - Icono central: dos flechas blancas ↔️ formando un loop de sincronizacion (estilo favicon del navbar)
 *
 * Se implementa PNG + CRC + zlib manuales (solo para Node 18+, Buffers y zlib de Node stdlib).
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf, start, end) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = (crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
}
function writeChunk(buf, offset, type, data) {
  const len = data.length;
  buf.writeUInt32BE(len, offset); offset += 4;
  buf.write(type, offset, 'ascii'); offset += 4;
  data.copy(buf, offset); offset += len;
  const crcStart = offset - 4 - len;
  const crc = crc32(buf, crcStart, crcStart + 4 + len);
  buf.writeUInt32BE(crc, offset); offset += 4;
  return offset;
}
/**
 * Dibuja un icono de lado N x N.
 * Retorna un buffer PNG.
 */
function drawPng(size, drawOverlay) {
  const w = size, h = size;
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  // 1. Generar pixeles RGBA (fondo gradiente + overlay icono).
  const pixels = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      // Circulo "inset" para fondo con bordes redondeados (superficie esfera-ish)
      const rMax = Math.min(w, h) / 2 - 1;
      const dx = x - cx, dy = y - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      // Gradiente radial: centro morado brillante, fuera azul mas oscuro
      const t = Math.min(1, r / rMax);
      // colores paleta BacaSync del logo morado-azul:
      // start #7c6bff (morado claro) -> mid #3d7bff (azul) -> edge #1f5ce0 (azul oscuro)
      let R, G, B;
      if (t < 0.55) {
        const k = t / 0.55;
        R = Math.round(124 + (61 - 124) * k);
        G = Math.round(107 + (123 - 107) * k);
        B = Math.round(255 + (255 - 255) * k);
      } else {
        const k = (t - 0.55) / 0.45;
        R = Math.round(61 + (31 - 61) * k);
        G = Math.round(123 + (92 - 123) * k);
        B = Math.round(255 + (224 - 255) * k);
      }
      // Antialias border circle: alpha 0 fuera, fade edge 1px
      let A = 255;
      if (r > rMax) A = 0;
      else if (r > rMax - 1.5) A = Math.max(0, Math.round(255 * (rMax - r) / 1.5));
      // Agrega sombra suave en los bordes exteriores para efecto boton
      if (t > 0.82) {
        const k = (t - 0.82) / 0.18;
        const s = 1 - 0.35 * k;
        R = Math.round(R * s);
        G = Math.round(G * s);
        B = Math.round(B * s);
      }
      // Highlight superior sutil: mas brillante en zona arriba-izq
      const hlX = -0.45, hlY = -0.5;
      const hlDx = (x - cx) / rMax - hlX, hlDy = (y - cy) / rMax - hlY;
      const hlD = Math.sqrt(hlDx * hlDx + hlDy * hlDy);
      if (hlD < 0.35) {
        const hl = 0.22 * (1 - hlD / 0.35);
        R = Math.min(255, Math.round(R + hl * 255));
        G = Math.min(255, Math.round(G + hl * 255));
        B = Math.min(255, Math.round(B + hl * 255));
      }
      pixels[idx] = R;
      pixels[idx + 1] = G;
      pixels[idx + 2] = B;
      pixels[idx + 3] = A;
    }
  }
  // 2. Overlay (icono flechas blancas) -> llama drawOverlay con un ctx casero
  if (drawOverlay) drawOverlay(w, h, (fx, fy, r255, g255, b255, a255 = 255) => {
    const x = Math.round(fx), y = Math.round(fy);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const idx = (y * w + x) * 4;
    // alpha compositing (source-over)
    const sa = a255 / 255, da = pixels[idx + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa === 0) return;
    const or = (r255 * sa + pixels[idx] * da * (1 - sa)) / oa;
    const og = (g255 * sa + pixels[idx + 1] * da * (1 - sa)) / oa;
    const ob = (b255 * sa + pixels[idx + 2] * da * (1 - sa)) / oa;
    pixels[idx] = Math.round(or);
    pixels[idx + 1] = Math.round(og);
    pixels[idx + 2] = Math.round(ob);
    pixels[idx + 3] = Math.round(oa * 255);
  });
  // 3. Filtrado PNG (filter type 0 None por simplicidad; suficiente para iconos)
  const stride = 1 + w * 4;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter byte
    pixels.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  // 4. Ensamblar chunks
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const totalLen = 8 + (12 + ihdr.length) + (12 + compressed.length) + 12;
  const png = Buffer.alloc(totalLen);
  // signature
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].forEach((b, i) => png[i] = b);
  let off = 8;
  off = writeChunk(png, off, 'IHDR', ihdr);
  off = writeChunk(png, off, 'IDAT', compressed);
  off = writeChunk(png, off, 'IEND', Buffer.alloc(0));
  return png.slice(0, off);
}

/**
 * Overlay de las flechas sincronizacion (↔️ loop, dos flechas curvas blancas, como el logo del navbar).
 * px(x,y,r,g,b,a) escribe un pixel con alpha compositing (solo 1x1).
 * Usamos Bresenham + circulos para anti-alias sutil.
 */
function drawSyncIcon(size, w, h, px) {
  // Coordenadas normalizadas al tamano del icono.
  const scale = size / 512;
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  // grosor de linea
  const t = Math.max(1, Math.round(22 * scale));
  // flecha superior: arco curvado superior apuntando a la derecha (>)
  drawArcArrow(px, cx, cy, scale, {
    radius: 92,
    startDeg: 180 + 25, // empieza arriba-izq
    endDeg: 0 + 25,     // acaba arriba-der
    headX: cx + 118 * scale,
    headY: cy - 72 * scale,
    dirDeg: 20,         // direccion punta derecha
    color: [255, 255, 255, 255],
    t,
    w, h
  });
  // flecha inferior: arco curvado inferior apuntando a la izquierda (<)
  drawArcArrow(px, cx, cy, scale, {
    radius: 92,
    startDeg: 180 - 25, // empieza abajo-izq
    endDeg: 360 - 25,   // acaba abajo-der
    headX: cx - 118 * scale,
    headY: cy + 72 * scale,
    dirDeg: 180 - 20,   // direccion punta izquierda
    color: [255, 255, 255, 255],
    t,
    w, h
  });
  // Sombra ligera interior gris oscuro bajo las flechas
  drawArcArrow(px, cx, cy, scale, {
    radius: 95,
    startDeg: 180 + 27,
    endDeg: 0 + 27,
    headX: cx + 119 * scale,
    headY: cy - 69 * scale,
    dirDeg: 20,
    color: [25, 45, 110, 60],
    t: Math.max(1, Math.round(8 * scale)),
    w, h
  });
}

function drawArcArrow(px, cx, cy, scale, o) {
  // Bresenham arco
  const r = o.radius * scale;
  const step = 0.006;
  for (let a = (o.startDeg * Math.PI) / 180; a <= (o.endDeg * Math.PI) / 180; a += step) {
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    discFill(px, x, y, (o.t + 1) / 2, o.color);
  }
  // Punta flecha: triangulo
  const dirRad = (o.dirDeg * Math.PI) / 180;
  const back1 = dirRad + Math.PI * (180 - 32) / 180;
  const back2 = dirRad - Math.PI * (180 - 32) / 180;
  const arrowLen = (o.t * 1.9) + 10 * scale;
  const tip = [o.headX, o.headY];
  const b1 = [o.headX + Math.cos(back1) * arrowLen, o.headY + Math.sin(back1) * arrowLen];
  const b2 = [o.headX + Math.cos(back2) * arrowLen, o.headY + Math.sin(back2) * arrowLen];
  fillTriangle(px, tip, b1, b2, o.color);
}
function discFill(px, x0, y0, r, color) {
  const r2 = r * r;
  const xMin = Math.ceil(x0 - r), xMax = Math.floor(x0 + r);
  const yMin = Math.ceil(y0 - r), yMax = Math.floor(y0 + r);
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      const d2 = (x - x0) * (x - x0) + (y - y0) * (y - y0);
      if (d2 <= r2) {
        let a = color[3];
        if (d2 > r2 - r * 0.9) a = Math.max(0, Math.round(color[3] * (1 - (Math.sqrt(d2) - (r - 1.3)) / 1.3)));
        px(x, y, color[0], color[1], color[2], a);
      }
    }
  }
}
function fillTriangle(px, a, b, c, color) {
  const minX = Math.min(a[0], b[0], c[0]) - 1;
  const maxX = Math.max(a[0], b[0], c[0]) + 1;
  const minY = Math.min(a[1], b[1], c[1]) - 1;
  const maxY = Math.max(a[1], b[1], c[1]) + 1;
  // area doble signada
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (area === 0) return;
  for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
    for (let x = Math.ceil(minX); x <= Math.floor(maxX); x++) {
      const w0 = ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) / area;
      const w1 = ((c[0] - b[0]) * (y - b[1]) - (c[1] - b[1]) * (x - b[0])) / area;
      const w2 = 1 - w0 - w1;
      if (w0 >= -0.02 && w1 >= -0.02 && w2 >= -0.02) {
        let a255 = color[3];
        if (w0 < 0.05 || w1 < 0.05 || w2 < 0.05) a255 = Math.round(color[3] * 0.55);
        px(x, y, color[0], color[1], color[2], a255);
      }
    }
  }
}

// ==== RUN ====
const assetsDir = path.join(__dirname);
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
const sizes = [
  { key: 'icon-16', size: 16 },
  { key: 'icon-32', size: 32 },
  { key: 'icon',    size: 512 },
  { key: 'icon-mac', size: 1024 },
];
for (const s of sizes) {
  const buf = drawPng(s.size, (w, h, px) => drawSyncIcon(s.size, w, h, px));
  const out = path.join(assetsDir, s.key + '.png');
  fs.writeFileSync(out, buf);
  console.log('wrote', path.relative(process.cwd(), out), buf.length, 'bytes');
}

// Genera tambien un fallback Buffer JSON (icon-32 base64) para que main.ts pueda cargarlo desde codigo sin archivos en disco.
const b32 = fs.readFileSync(path.join(assetsDir, 'icon-32.png'));
const b16 = fs.readFileSync(path.join(assetsDir, 'icon-16.png'));
const json = JSON.stringify({
  base64_16: b16.toString('base64'),
  base64_32: b32.toString('base64'),
});
const fallbackContent = `/* eslint-disable */\nmodule.exports = ${json};\n`;
const js = path.join(assetsDir, 'icon-fallback.js');
const cjs = path.join(assetsDir, 'icon-fallback.cjs');
// Escribe ambos: .js es lo que GitHub Actions runner espera; .cjs por compatibilidad con builds antiguos.
fs.writeFileSync(js, fallbackContent);
console.log('wrote', path.relative(process.cwd(), js));
try { fs.writeFileSync(cjs, fallbackContent); } catch { /* ignore */ }
console.log('Done.');
