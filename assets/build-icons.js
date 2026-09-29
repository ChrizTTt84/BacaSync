/* eslint-disable */
// Build BacaSync icons (pure Node stdlib + png2icons para ICNS):
//   - assets/icon.ico        (Windows, 16, 32, 256 from PNG, MANUAL ICONDIR)
//   - assets/icon.icns       (macOS, png2icons + fallback empty -> CI electron-builder makes it)
const fs = require('fs');
const path = require('path');
const png2icons = require('png2icons');

function pngSize(png) {
  // PNG IHDR: 4 bytes length, 4 bytes "IHDR", then width(4) height(4)
  if (png.readUInt32BE(0) !== 0x89504e47 || png.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error('Not a PNG');
  }
  let off = 8;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('ascii', off + 4, off + 8);
    if (type === 'IHDR') {
      const w = png.readUInt32BE(off + 8);
      const h = png.readUInt32BE(off + 12);
      return { width: w, height: h };
    }
    off += 12 + len;
  }
  throw new Error('IHDR not found');
}
function buildIcoFromPngs(pngBuffers) {
  // ICONDIR (6 bytes) + n * ICONDIRENTRY(16 bytes) + concatenated PNGs
  const n = pngBuffers.length;
  const dirSize = 6 + n * 16;
  const entries = pngBuffers.map((buf) => {
    const { width: w, height: h } = pngSize(buf);
    return {
      width: w >= 256 ? 0 : w,
      height: h >= 256 ? 0 : h,
      colors: 0,
      planes: 1,
      bitCount: 32,
      bytes: buf.length,
      offset: 0,
      buf,
    };
  });
  let dataOff = dirSize;
  for (const e of entries) { e.offset = dataOff; dataOff += e.bytes; }
  const out = Buffer.alloc(dataOff);
  // ICONDIR: idReserved(2) + idType(2 = 1) + idCount(2)
  out.writeUInt16LE(0, 0);
  out.writeUInt16LE(1, 2);
  out.writeUInt16LE(n, 4);
  let p = 6;
  for (const e of entries) {
    out[p++] = e.width & 0xff;
    out[p++] = e.height & 0xff;
    out[p++] = e.colors & 0xff;
    out[p++] = 0; // reserved
    out.writeUInt16LE(e.planes, p); p += 2;
    out.writeUInt16LE(e.bitCount, p); p += 2;
    out.writeUInt32LE(e.bytes, p); p += 4;
    out.writeUInt32LE(e.offset, p); p += 4;
    e.buf.copy(out, e.offset);
  }
  return out;
}

async function main() {
  const assets = path.join(__dirname);
  // 1) Asegurar fuentes PNG
  const sources = ['icon.png', 'icon-32.png', 'icon-16.png', 'icon-mac.png'];
  for (const s of sources) {
    if (!fs.existsSync(path.join(assets, s))) {
      console.log('PNG sources missing -> generating first...');
      require('./generate-icons.cjs');
      break;
    }
  }

  // 2) .ico Windows
  console.log('Building Windows .ico (manual ICO structure)...');
  const p16 = fs.readFileSync(path.join(assets, 'icon-16.png'));
  const p32 = fs.readFileSync(path.join(assets, 'icon-32.png'));
  const p256 = (() => {
    // electron-builder a veces prefiere 256x256 embebido; como no tenemos resizer de PNG puro,
    // usamos icon.png (512) y marcamos width=0 height=0 (ICO lo interpreta como >= 256).
    return fs.readFileSync(path.join(assets, 'icon.png'));
  })();
  const icoBuf = buildIcoFromPngs([p16, p32, p256]);
  fs.writeFileSync(path.join(assets, 'icon.ico'), icoBuf);
  console.log('wrote assets/icon.ico (' + icoBuf.length + ' bytes)');

  // 3) .icns macOS (solo si png2icons puede; fallback: electron-builder lo reconstruye en runner Mac)
  console.log('Building macOS .icns (ICNS format via png2icons)...');
  const macPng = fs.readFileSync(path.join(assets, 'icon-mac.png'));
  let icnsBuf;
  try {
    icnsBuf = png2icons.createICNS(macPng, (typeof png2icons.BILINEAR !== 'undefined') ? png2icons.BILINEAR : 0, 0);
  } catch (e) {
    console.warn('png2icons createICNS error (no fatal):', e && e.message);
    icnsBuf = null;
  }
  if (icnsBuf && icnsBuf.length > 0) {
    fs.writeFileSync(path.join(assets, 'icon.icns'), icnsBuf);
    console.log('wrote assets/icon.icns (' + icnsBuf.length + ' bytes)');
  } else {
    console.warn('[SKIP ICNS] Electron-builder generara .icns automaticamente en macOS usando icon-mac.png');
  }

  console.log('Icons build complete.');
}

main().then(
  () => process.exit(0),
  (err) => { console.error('build-icons failed:', err); process.exit(1); }
);
