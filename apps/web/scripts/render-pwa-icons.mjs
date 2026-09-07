#!/usr/bin/env node
// Rastrerar PWA-ikonerna (public/icons/*.png) från en HTML-mall med Sora
// (self-hosted, public/fonts) via headless Chromium. Ingen npm-dependency —
// Chromium hittas via CHROME_BIN eller Playwrights standardkatalog.
//
//   node apps/web/scripts/render-pwa-icons.mjs
//
// Ikonerna följer grafiska profilen (CLAUDE.md § 2): mörkblå #002c40 som
// bakgrund, vit wordmark-bokstav "m" i Sora. Maskable-varianten håller
// motivet inom den inre "safe zone" (80 %) så Android kan klippa fritt.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const outDir = join(webRoot, 'public', 'icons');
const fontFile = join(webRoot, 'public', 'fonts', 'sora-variable.woff2');
mkdirSync(outDir, { recursive: true });

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

const ICONS = [
  { file: 'icon-192.png', size: 192, safe: 0.72, radius: 0 },
  { file: 'icon-512.png', size: 512, safe: 0.72, radius: 0 },
  { file: 'icon-maskable-512.png', size: 512, safe: 0.56, radius: 0 },
  { file: 'apple-touch-icon.png', size: 180, safe: 0.72, radius: 0 }
];

function html({ size, safe }) {
  const fontSize = Math.round(size * safe);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"Sora";src:url("file://${fontFile}") format("woff2");font-weight:100 800}
html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden}
body{background:#002c40;display:grid;place-items:center}
.m{font-family:"Sora",system-ui,sans-serif;font-weight:700;font-size:${fontSize}px;line-height:1;color:#f2f2f2;letter-spacing:-0.04em;transform:translateY(-${Math.round(size*0.02)}px)}
</style></head><body><div class="m">m</div></body></html>`;
}

const chrome = findChrome();
for (const icon of ICONS) {
  const tmp = join(outDir, `.${icon.file}.html`);
  writeFileSync(tmp, html(icon));
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${icon.size},${icon.size}`,
      `--screenshot=${join(outDir, icon.file)}`,
      `file://${tmp}`
    ],
    { stdio: 'ignore' }
  );
  execFileSync('rm', ['-f', tmp]);
  console.log('✓', icon.file);
}
