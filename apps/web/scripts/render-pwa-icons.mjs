#!/usr/bin/env node
// Rastrerar favicon + PWA-ikoner (public/icons/*.png, public/favicon.ico)
// och den vita wordmark-PNG:n (public/brand/movexum-wordmark-dark.png) från
// Sora (self-hosted, public/fonts) via headless Chromium. Ingen
// npm-dependency — Chromium hittas via CHROME_BIN eller Playwrights
// standardkatalog.
//
//   node apps/web/scripts/render-pwa-icons.mjs
//
// Motivet är Movexums wordmark i vitt (#ffffff) på SVART (#000000) — samma
// resurs som brand-wordmarken (CLAUDE.md § 2.1, § 35). Rastreringen sker på
// en <canvas> i 4× upplösning som skalas ned (mjuk kantutjämning även i
// 16/32 px), och PNG:n plockas ut via --dump-dom som en data-URL.
// Maskable-varianten håller motivet inom Androids inre "safe zone".
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const iconDir = join(webRoot, 'public', 'icons');
const brandDir = join(webRoot, 'public', 'brand');
const fontFile = join(webRoot, 'public', 'fonts', 'sora-variable.woff2');
mkdirSync(iconDir, { recursive: true });
mkdirSync(brandDir, { recursive: true });

const BG = '#000000';
const FG = '#ffffff';
const TEXT = 'movexum';

function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (existsSync(base)) {
    for (const d of readdirSync(base)) {
      if (!d.startsWith('chromium-')) continue;
      const bin = join(base, d, 'chrome-linux', 'chrome');
      if (existsSync(bin)) return bin;
    }
  }
  for (const c of ['google-chrome', 'chromium', 'chromium-browser']) {
    try {
      return execFileSync('which', [c]).toString().trim();
    } catch {}
  }
  throw new Error('Hittar ingen Chromium — sätt CHROME_BIN');
}

// `safe` = andel av bredden som wordmarken får fylla. Kvadratiska ikoner
// centrerar wordmarken vertikalt; små storlekar får fylla mer så att
// bokstäverna förblir läsbara.
const JOBS = [
  { out: join(iconDir, 'icon-192.png'), w: 192, h: 192, safe: 0.86, bg: BG },
  { out: join(iconDir, 'icon-512.png'), w: 512, h: 512, safe: 0.86, bg: BG },
  { out: join(iconDir, 'icon-maskable-512.png'), w: 512, h: 512, safe: 0.62, bg: BG },
  { out: join(iconDir, 'apple-touch-icon.png'), w: 180, h: 180, safe: 0.86, bg: BG },
  { out: join(iconDir, 'favicon-48.png'), w: 48, h: 48, safe: 0.94, bg: BG },
  { out: join(iconDir, 'favicon-32.png'), w: 32, h: 32, safe: 0.94, bg: BG },
  { out: join(iconDir, 'favicon-16.png'), w: 16, h: 16, safe: 0.96, bg: BG },
  // Transparent wordmark för dokument-renderarna (public/brand/README.md).
  { out: join(brandDir, 'movexum-wordmark-dark.png'), w: 1200, h: 280, safe: 0.96, bg: null }
];

function html(job) {
  const scale = 4;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"Sora";src:url("file://${fontFile}") format("woff2");font-weight:100 800}
</style></head><body><script>
(async () => {
  const W = ${job.w}, H = ${job.h}, S = ${scale};
  await document.fonts.load('800 100px "Sora"');
  const big = document.createElement('canvas');
  big.width = W * S; big.height = H * S;
  const ctx = big.getContext('2d');
  if (${job.bg ? `'${job.bg}'` : 'null'}) { ctx.fillStyle = '${job.bg ?? ''}'; ctx.fillRect(0, 0, big.width, big.height); }
  // Hitta font-size så att texten blir safe × W bred.
  let fs = 100;
  ctx.font = '800 ' + fs + 'px "Sora"';
  ctx.letterSpacing = '-0.02em';
  const m = ctx.measureText(${JSON.stringify(TEXT)});
  fs = fs * (W * S * ${job.safe}) / m.width;
  ctx.font = '800 ' + fs + 'px "Sora"';
  ctx.letterSpacing = '-0.02em';
  ctx.fillStyle = '${FG}';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const m2 = ctx.measureText(${JSON.stringify(TEXT)});
  // Centrera på x-höjden (alla bokstäver är gemener utan staplar utom ingen —
  // "movexum" saknar uppstaplar/nedstaplar) → mitten = baseline - ascent/2.
  const asc = m2.actualBoundingBoxAscent, desc = m2.actualBoundingBoxDescent;
  const y = big.height / 2 + (asc - desc) / 2;
  ctx.fillText(${JSON.stringify(TEXT)}, big.width / 2 + (m2.actualBoundingBoxLeft - m2.actualBoundingBoxRight) / 2, y);
  const small = document.createElement('canvas');
  small.width = W; small.height = H;
  const sctx = small.getContext('2d');
  sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'high';
  // Trappstegsvis nedskalning ger jämnare kanter i 16/32 px.
  let cur = big;
  while (cur.width / 2 > W) {
    const c = document.createElement('canvas');
    c.width = cur.width / 2; c.height = cur.height / 2;
    const cc = c.getContext('2d');
    cc.imageSmoothingEnabled = true; cc.imageSmoothingQuality = 'high';
    cc.drawImage(cur, 0, 0, c.width, c.height);
    cur = c;
  }
  sctx.drawImage(cur, 0, 0, W, H);
  document.body.textContent = 'PNG:' + small.toDataURL('image/png') + ':END';
})();
</script></body></html>`;
}

function render(chrome, job) {
  const tmp = `${job.out}.html`;
  writeFileSync(tmp, html(job));
  const dom = execFileSync(
    chrome,
    ['--headless=new', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--virtual-time-budget=10000', '--dump-dom', `file://${tmp}`],
    { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }
  ).toString();
  execFileSync('rm', ['-f', tmp]);
  const mt = dom.match(/PNG:data:image\/png;base64,([A-Za-z0-9+/=]+):END/);
  if (!mt) throw new Error('Ingen PNG i DOM-dumpen för ' + job.out);
  writeFileSync(job.out, Buffer.from(mt[1], 'base64'));
  console.log('✓', job.out.replace(webRoot + '/', ''));
}

// ICO-container med KLASSISKA BMP-poster (32-bit BGRA + AND-mask) — stöds av
// alla webbläsare och av Windows-skalet, till skillnad från PNG-i-ICO som
// äldre/vissa klienter ignorerar. PNG:n avkodas här utan npm-dep (zlib +
// PNG-filter 0–4, 8-bit RGB/RGBA, ej interlaced — exakt vad canvas ger).
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Inte en PNG');
  let pos = 8;
  let w = 0, h = 0, colorType = 0, bitDepth = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`PNG-variant stöds ej (depth ${bitDepth}, type ${colorType}, interlace ${interlace})`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      out[o] = line[x * bpp]; out[o + 1] = line[x * bpp + 1]; out[o + 2] = line[x * bpp + 2];
      out[o + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
    prev = line;
  }
  return { w, h, rgba: out };
}

function bmpIcoEntry({ w, h, rgba }) {
  const xorSize = w * h * 4;
  const andStride = Math.ceil(w / 32) * 4;
  const andSize = andStride * h;
  const buf = Buffer.alloc(40 + xorSize + andSize);
  buf.writeUInt32LE(40, 0); buf.writeInt32LE(w, 4); buf.writeInt32LE(h * 2, 8);
  buf.writeUInt16LE(1, 12); buf.writeUInt16LE(32, 14); buf.writeUInt32LE(0, 16);
  buf.writeUInt32LE(xorSize + andSize, 20);
  let o = 40;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      buf[o++] = rgba[i + 2]; buf[o++] = rgba[i + 1]; buf[o++] = rgba[i]; buf[o++] = rgba[i + 3];
    }
  }
  // AND-masken lämnas 0 (helt opak) — alfakanalen i BGRA styr transparens.
  return buf;
}

function writeIco(pngPaths, out) {
  const entries = pngPaths.map((p) => {
    const img = decodePng(readFileSync(p));
    return { data: bmpIcoEntry(img), w: img.w >= 256 ? 0 : img.w, h: img.h >= 256 ? 0 : img.h };
  });
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const dir = [];
  for (const e of entries) {
    const d = Buffer.alloc(16);
    d.writeUInt8(e.w, 0);
    d.writeUInt8(e.h, 1);
    d.writeUInt8(0, 2);
    d.writeUInt8(0, 3);
    d.writeUInt16LE(1, 4);
    d.writeUInt16LE(32, 6);
    d.writeUInt32LE(e.data.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += e.data.length;
    dir.push(d);
  }
  writeFileSync(out, Buffer.concat([header, ...dir, ...entries.map((e) => e.data)]));
  console.log('✓', out.replace(webRoot + '/', ''));
}

const chrome = findChrome();
for (const job of JOBS) render(chrome, job);
writeIco(
  ['favicon-16.png', 'favicon-32.png', 'favicon-48.png'].map((f) => join(iconDir, f)),
  join(webRoot, 'public', 'favicon.ico')
);
