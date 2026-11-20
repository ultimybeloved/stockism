// Draws the limited-time seasonal shop pins (20x20 pixel art) into
// public/pins/shop/. Original artwork. Run: node scripts/pixel-shop-seasonal.cjs
// The pins themselves (names, prices, sale window) live in src/crews.ts.
const fs = require('fs');
const path = require('path');
const { sprite } = require('./pixel-sprite.cjs');

const out = path.join(__dirname, '..', 'public', 'pins', 'shop');
fs.mkdirSync(out, { recursive: true });

const SEASON_PAL = {
  a: '#f0b860', // roast highlight
  A: '#c87533', // roast
  M: '#8a4416', // roast shadow
  h: '#f2d29b', // crust light
  H: '#d9a55a', // crust
  x: '#3d3a4b', // hat
  X: '#57536b', // hat highlight
  z: '#26242f', // hat band
  t: '#9fb3c8', // turkey head skin
  L: '#c9732b', // pumpkin dark
  e: '#e8e2cf', // cream shade
  o: '#fb9d4b', // pie top, pumpkin middle
};

// Fill every cell inside a tapered capsule from A to B (radius ra -> rb).
// colorAt(s, p): position along the axis (0 at A, 1 at B, unclamped) and
// distance across it (+ = right of travel).
const capsule = (px, [ax, ay], [bx, by], ra, rb, colorAt) => {
  const len = Math.hypot(bx - ax, by - ay);
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 20; x++) {
      const dx = x + 0.5 - ax;
      const dy = y + 0.5 - ay;
      const t = Math.max(0, Math.min(1, (dx * ux + dy * uy) / len));
      const r = ra + (rb - ra) * t;
      if (Math.hypot(x + 0.5 - (ax + ux * t * len), y + 0.5 - (ay + uy * t * len)) <= r)
        px(x, y, colorAt((dx * ux + dy * uy) / len, -dx * uy + dy * ux));
    }
};

const ellipse = (px, cx, cy, rx, ry, color) => {
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 20; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) px(x, y, color);
    }
};

const pins = {
  // Thanksgiving 2026: a live turkey with its tail fanned out.
  tg26_turkey: ({ px, disc, rect }) => {
    const fan = ['R', 'y', 'Y', 'y'];
    for (let y = 0; y <= 13; y++)
      for (let x = 0; x < 20; x++) {
        const dx = x + 0.5 - 10;
        const dy = y + 0.5 - 12;
        const r = Math.hypot(dx, dy);
        if (r > 9.2) continue;
        const sector = Math.floor(((Math.atan2(-dy, dx) + Math.PI) / Math.PI) * 9) % 4;
        if (r > 6.6) px(x, y, fan[sector]);
        else if (r > 5) px(x, y, sector % 2 ? 'n' : 'm');
      }
    disc(10, 13.5, 4.4, 'n');
    disc(10, 15, 2.8, 'm');
    rect(8, 10, 8, 12, 'm');
    rect(12, 11, 12, 13, 'm');
    // neck, head, beak, wattle
    rect(9, 7, 10, 10, 't');
    disc(10, 5.5, 2.3, 't');
    px(8, 5, 'K');
    px(11, 5, 'K');
    rect(9, 6, 10, 6, 'Y');
    rect(10, 7, 10, 9, 'R');
    px(11, 8, 'R');
    // feet
    rect(7, 18, 8, 18, 'y');
    rect(11, 18, 12, 18, 'y');
  },

  // A meaty drumstick: big bulb, short bone.
  tg26_drumstick: ({ px, disc, line }) => {
    line(11, 8, 14, 5, 'W');
    line(12, 8, 15, 5, 'W');
    line(12, 9, 15, 6, 'S');
    disc(15.3, 3.5, 1.5, 'W');
    disc(16.7, 4.9, 1.5, 'W');
    px(16, 6, 'S');
    px(17, 5, 'S');
    capsule(px, [7, 13], [12, 8], 5.4, 1.9, (s, p) => (p > 2.2 || (s === 0 && p > 1.2) ? 'M' : 'A'));
    disc(5.5, 11, 1.9, 'a');
    px(8, 9, 'a');
    px(9, 8, 'a');
  },

  // A pilgrim's tall hat with a gold buckle.
  tg26_pilgrim: ({ px, rect }) => {
    for (let y = 3; y <= 13; y++) {
      const w = 4 + Math.floor((y - 3) / 4);
      rect(10 - w, y, 9 + w, y, 'x');
      px(11 - w, y, 'X');
    }
    rect(5, 3, 14, 3, 'X');
    rect(4, 10, 15, 12, 'z');
    rect(8, 9, 11, 13, 'Y');
    rect(9, 10, 10, 12, 'z');
    px(11, 13, 'y');
    px(11, 9, 'y');
    rect(1, 14, 18, 15, 'x');
    rect(2, 16, 17, 16, 'x');
    rect(1, 14, 18, 14, 'X');
  },

  // A slice of pumpkin pie with whipped cream.
  tg26_pie: ({ px, rect, disc }) => {
    for (let x = 2; x <= 15; x++) {
      const t = (x - 2) / 13;
      const top = Math.round(11 - t * 5);
      const bot = Math.round(11 + t);
      rect(x, top, x, bot, 'o');
      rect(x, bot + 1, x, bot + 4, 'y');
      px(x, bot + 4, 'L');
      px(x, bot + 5, 'H');
    }
    rect(15, 5, 17, 17, 'H');
    rect(15, 5, 17, 5, 'h');
    for (let y = 7; y <= 16; y += 3) px(16, y, 'h');
    disc(9, 7.5, 2.1, 'W');
    rect(9, 4, 9, 5, 'W');
    px(10, 5, 'W');
    rect(8, 9, 10, 9, 'e');
  },

  // A plump lobed pumpkin with a curly vine.
  tg26_pumpkin: ({ px, rect, line }) => {
    ellipse(px, 4.6, 12.6, 3.2, 5.0, 'L');
    ellipse(px, 15.4, 12.6, 3.2, 5.0, 'L');
    ellipse(px, 7.4, 12.4, 3.3, 5.8, 'y');
    ellipse(px, 12.6, 12.4, 3.3, 5.8, 'y');
    ellipse(px, 10, 12.2, 2.6, 6.2, 'o');
    rect(9, 8, 9, 10, 'O');
    rect(6, 9, 6, 10, 'O');
    // stem, vine, leaf
    rect(9, 4, 10, 6, 'G');
    rect(10, 3, 11, 3, 'G');
    px(9, 4, 'g');
    line(12, 5, 14, 4, 'g');
    rect(15, 2, 15, 3, 'g');
    px(14, 2, 'g');
    rect(5, 4, 7, 5, 'g');
    px(4, 4, 'g');
    px(8, 5, 'g');
    px(6, 6, 'G');
  },

  // An upright corn cob with its husks peeling down.
  tg26_corn: ({ px, rect }) => {
    for (let y = 2; y <= 15; y++)
      for (let x = 7; x <= 12; x++) {
        if (y === 2 && (x === 7 || x === 12)) continue;
        const lx = (x - 7 + (Math.floor(y / 2) % 2)) % 2;
        const ly = y % 2;
        const kernel = lx === 1 && ly === 1 ? 'y' : lx === 0 && ly === 0 ? 'h' : 'Y';
        px(x, y, x === 12 ? 'y' : kernel);
      }
    for (let y = 8; y <= 18; y++) {
      const t = (y - 8) / 10;
      const a = Math.round(4 + t * 3.5);
      const b = Math.round(5 + t * 4.5);
      for (const mx of [(x) => x, (x) => 19 - x]) {
        rect(Math.min(mx(a), mx(b)), y, Math.max(mx(a), mx(b)), y, 'g');
        px(mx(b), y, 'G');
      }
    }
    rect(9, 18, 10, 18, 'G');
  },
};

for (const [name, draw] of Object.entries(pins))
  fs.writeFileSync(path.join(out, name + '.svg'), sprite(draw, SEASON_PAL));
console.log(`wrote ${Object.keys(pins).length} pins to public/pins/shop/`);
