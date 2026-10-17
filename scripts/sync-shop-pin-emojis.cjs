'use strict';

// Uploads the shop pins (public/pins/shop) as APPLICATION emojis named
// pin_<id>, so bot posts (shop announcements from the admin Discord tab) can
// show them. Prints the markup to paste into a message.
//
//   node scripts/sync-shop-pin-emojis.cjs             # show what's uploaded
//   node scripts/sync-shop-pin-emojis.cjs --upload    # upload missing ones
//   node scripts/sync-shop-pin-emojis.cjs --replace shiba --upload
//                                                     # re-upload redrawn pins
//   node scripts/sync-shop-pin-emojis.cjs --preview DIR   # write the PNGs only
//
// Same conversion and reasoning as sync-pixel-emojis.cjs. Nothing deployed
// reads these, so no deploy is needed.

const fs = require('fs');
const path = require('path');
const { readBotToken, discord, getApp } = require('./discord-api.cjs');
const { svgGrid, gridToPng } = require('./sync-pixel-emojis.cjs');

const PIN_DIR = path.join(__dirname, '..', 'public', 'pins', 'shop');

const listAppEmojis = async (token, appId) =>
  ((await discord(token, `/applications/${appId}/emojis`)) || {}).items || [];

async function main() {
  const upload = process.argv.includes('--upload');
  const replaceArg = process.argv[process.argv.indexOf('--replace') + 1];
  const replace = new Set(process.argv.includes('--replace') ? replaceArg.split(',') : []);
  const pins = fs
    .readdirSync(PIN_DIR)
    .filter((f) => f.endsWith('.svg'))
    .map((f) => f.slice(0, -4))
    .sort();
  const png = (pin) => gridToPng(svgGrid(path.join(PIN_DIR, `${pin}.svg`)));

  if (process.argv.includes('--preview')) {
    const dir = process.argv[process.argv.indexOf('--preview') + 1];
    fs.mkdirSync(dir, { recursive: true });
    for (const pin of pins) fs.writeFileSync(path.join(dir, `${pin}.png`), png(pin));
    console.log(`Wrote ${pins.length} PNGs to ${dir}`);
    return;
  }

  const token = readBotToken();
  const app = await getApp(token);
  console.log(`App: ${app.name} (${app.id})`);
  let appEmojis = await listAppEmojis(token, app.id);

  if (upload) {
    for (const pin of pins) {
      const name = `pin_${pin}`;
      const existing = appEmojis.find((e) => e.name === name);
      if (existing && replace.has(pin)) {
        await discord(token, `/applications/${app.id}/emojis/${existing.id}`, { method: 'DELETE' });
        console.log(`  - ${name} deleted for re-upload`);
      } else if (existing) {
        continue;
      }
      await discord(token, `/applications/${app.id}/emojis`, {
        method: 'POST',
        body: JSON.stringify({ name, image: `data:image/png;base64,${png(pin).toString('base64')}` }),
      });
      console.log(`  + ${name} uploaded`);
    }
    appEmojis = await listAppEmojis(token, app.id);
  }

  for (const pin of pins) {
    const e = appEmojis.find((x) => x.name === `pin_${pin}`);
    console.log(`${pin}: ${e ? `<:${e.name}:${e.id}>` : 'missing (run with --upload)'}`);
  }
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
