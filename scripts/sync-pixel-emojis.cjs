'use strict';

// Uploads the pixel icons the Discord bot uses (scripts/discord-emoji-map.cjs)
// as APPLICATION emojis on the bot app, and writes their markup into
// functions/src/shared/constants/pixelEmojis.ts, which pxe() reads.
//
//   node scripts/sync-pixel-emojis.cjs                    # show what's uploaded
//   node scripts/sync-pixel-emojis.cjs --upload --write   # upload missing ones, write the IDs
//   node scripts/sync-pixel-emojis.cjs --replace hammer,gift --upload --write
//                                                         # re-upload redrawn icons
//
// Application emojis belong to the bot, not to a server: they render in every
// server the bot posts to and in DMs, and nothing a server admin does can break
// them (same reasoning as sync-crew-emojis.cjs). Each icon is a 20x20 SVG,
// scaled up 6x with no smoothing so it stays crisp at Discord's emoji sizes.
// Deploy functions after --write for the IDs to take effect.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { readBotToken, discord, getApp } = require('./discord-api.cjs');
const MAP = require('./discord-emoji-map.cjs');

const ROOT = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'functions', 'src', 'shared', 'constants', 'pixelEmojis.ts');
const GRID = 20;
const SCALE = 6;

const emojiName = (icon) => `px_${icon}`;

// ── 20x20 SVG -> 120x120 PNG ─────────────────────────────────────────────────
function svgGrid(file) {
  const src = fs.readFileSync(file, 'utf8');
  const grid = Array.from({ length: GRID }, () => Array(GRID).fill(null));
  for (const m of src.matchAll(/<rect x="(\d+)" y="(\d+)"[^>]*fill="#([0-9a-fA-F]{6})"/g)) {
    grid[Number(m[2])][Number(m[1])] = m[3];
  }
  return grid;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function gridToPng(grid) {
  const size = GRID * SCALE;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // no filter
    for (let x = 0; x < size; x++) {
      const hex = grid[Math.floor(y / SCALE)][Math.floor(x / SCALE)];
      if (!hex) continue;
      const o = row + 1 + x * 4;
      raw[o] = parseInt(hex.slice(0, 2), 16);
      raw[o + 1] = parseInt(hex.slice(2, 4), 16);
      raw[o + 2] = parseInt(hex.slice(4, 6), 16);
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const iconFile = ([dir, icon]) => path.join(ROOT, 'public', 'pins', dir, `${icon}.svg`);

// ── Discord ──────────────────────────────────────────────────────────────────
const listAppEmojis = async (token, appId) =>
  ((await discord(token, `/applications/${appId}/emojis`)) || {}).items || [];

async function main() {
  const upload = process.argv.includes('--upload');
  const write = process.argv.includes('--write');
  const replaceArg = process.argv[process.argv.indexOf('--replace') + 1];
  const replace = new Set(process.argv.includes('--replace') ? replaceArg.split(',') : []);

  // One upload per icon, even when several emojis share it.
  const icons = new Map();
  for (const entry of Object.values(MAP)) icons.set(entry[1], entry);

  // --preview DIR: write the PNGs that would be uploaded, touch nothing else.
  if (process.argv.includes('--preview')) {
    const dir = process.argv[process.argv.indexOf('--preview') + 1];
    fs.mkdirSync(dir, { recursive: true });
    for (const [icon, entry] of icons)
      fs.writeFileSync(path.join(dir, `${icon}.png`), gridToPng(svgGrid(iconFile(entry))));
    console.log(`Wrote ${icons.size} PNGs to ${dir}`);
    return;
  }

  const token = readBotToken();
  const app = await getApp(token);
  console.log(`App: ${app.name} (${app.id})`);
  let appEmojis = await listAppEmojis(token, app.id);

  if (upload) {
    for (const [icon, entry] of icons) {
      const name = emojiName(icon);
      const existing = appEmojis.find((e) => e.name === name);
      if (existing && replace.has(icon)) {
        await discord(token, `/applications/${app.id}/emojis/${existing.id}`, { method: 'DELETE' });
        console.log(`  - ${name} deleted for re-upload`);
      } else if (existing) {
        continue;
      }
      const png = gridToPng(svgGrid(iconFile(entry)));
      await discord(token, `/applications/${app.id}/emojis`, {
        method: 'POST',
        body: JSON.stringify({ name, image: `data:image/png;base64,${png.toString('base64')}` }),
      });
      console.log(`  + ${name} uploaded (${Math.round(png.length / 1024)} KB)`);
    }
    appEmojis = await listAppEmojis(token, app.id);
  }

  const resolved = {};
  const missing = [];
  for (const icon of [...icons.keys()].sort()) {
    const e = appEmojis.find((x) => x.name === emojiName(icon));
    if (e) resolved[icon] = `<:${e.name}:${e.id}>`;
    else missing.push(icon);
  }
  console.log(`${Object.keys(resolved).length} of ${icons.size} icons uploaded.`);
  if (missing.length) console.log(`Missing: ${missing.join(', ')} (run with --upload)`);

  if (write) {
    const body = Object.entries(resolved)
      .map(([icon, markup]) => `  ${icon}: '${markup}',`)
      .join('\n');
    fs.writeFileSync(
      OUT_PATH,
      `// GENERATED by scripts/sync-pixel-emojis.cjs: the bot's pixel emojis, uploaded\n` +
        `// as application emojis. Never edit by hand; re-run the script.\n` +
        `export const PIXEL_EMOJIS = {\n${body}\n} as const;\n\n` +
        `export type PixelEmoji = keyof typeof PIXEL_EMOJIS;\n`,
    );
    console.log(`Wrote ${path.relative(ROOT, OUT_PATH)} (deploy functions to take effect).`);
  }
}

// sync-ladder-emojis.cjs reuses the PNG conversion.
module.exports = { svgGrid, gridToPng };

if (require.main === module) {
  main().catch((err) => {
    console.error(`\n${err.message}`);
    process.exit(1);
  });
}
