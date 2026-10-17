// Draws the pixel-art (20x20) icons the admin panel needs that the site and the
// bot don't already have, into public/pins/admin/. Same engine and style as
// pixel-ui.cjs and pixel-discord.cjs. Original artwork.
// Run: node scripts/pixel-admin.cjs
const fs = require('fs');
const path = require('path');
const { sprite } = require('./pixel-sprite.cjs');

const out = path.join(__dirname, '..', 'public', 'pins', 'admin');
fs.mkdirSync(out, { recursive: true });

const PAL = { L: '#c9c0aa', l: '#8f8670', k: '#e5e7eb', e: '#c27c48', E: '#7a4420', h: '#fde68a' };
const C = 10;
const paint = (px, x0, y0, rows) =>
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => ch !== '.' && px(x0 + dx, y0 + dy, ch)));
// Fill every cell whose centre is inside the polygon (even-odd rule).
const fillPoly = (px, pts, c) => {
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 20; x++) {
      const X = x + 0.5;
      const Y = y + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > Y !== yj > Y && X < ((xj - xi) * (Y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) px(x, y, typeof c === 'function' ? c(x, y) : c);
    }
};
// Shade the lower-right of a shape with its dark tone, like the site icons.
const shade = (hi, lo, t) => (x, y) => (x + y > t ? lo : hi);

const icons = {
  // Create something new: a green plus.
  plus: ({ rect }) => {
    rect(8, 2, 11, 17, 'g');
    rect(2, 8, 17, 11, 'g');
    rect(10, 2, 11, 17, 'G');
    rect(2, 10, 17, 11, 'G');
    rect(8, 8, 9, 9, 'g');
  },
  // Cancelled / blocked: a red ring with a slash.
  blocked: ({ disc, px }) => {
    disc(C, C, 8, 'R');
    disc(C, C, 5.6, null);
    for (let y = 0; y < 20; y++)
      for (let x = 0; x < 20; x++) if (Math.abs(x - y) <= 1.2 && x > 3 && x < 16) px(x, y, 'R');
  },
  // Discord messages: a speech bubble with three dots.
  chat: ({ rect, px }) => {
    rect(2, 3, 17, 13, 'W');
    rect(3, 2, 16, 14, 'W');
    rect(3, 12, 16, 14, 'S');
    rect(17, 4, 17, 12, 'S');
    paint(px, 4, 15, ['SSS', 'SS.', 'S..']);
    for (const x of [5, 9, 13]) {
      px(x, 8, 'b');
      px(x + 1, 8, 'b');
      px(x, 9, 'b');
      px(x + 1, 9, 'b');
    }
  },
  // Backups: a floppy disk.
  save: ({ rect }) => {
    rect(2, 2, 17, 17, 'b');
    rect(15, 2, 17, 4, null);
    rect(15, 3, 16, 4, 'b');
    rect(5, 2, 13, 7, 'S');
    rect(10, 3, 12, 6, 'N');
    rect(4, 10, 15, 17, 'W');
    rect(6, 12, 13, 12, 'S');
    rect(6, 14, 13, 14, 'S');
  },
  // Delete: a grey bin with a lid.
  trash: ({ rect, px }) => {
    rect(8, 1, 11, 2, 's');
    rect(3, 3, 16, 5, 'S');
    rect(3, 5, 16, 5, 's');
    rect(4, 6, 15, 18, 'S');
    rect(11, 6, 15, 18, 's');
    for (const x of [6, 9, 12]) rect(x, 8, x, 16, x < 11 ? 's' : 'N');
    px(4, 18, 's');
  },
  // Stock splits: open scissors.
  scissors: ({ disc, line }) => {
    disc(5, 15, 3.4, 'R');
    disc(5, 15, 1.6, null);
    disc(15, 15, 3.4, 'R');
    disc(15, 15, 1.6, null);
    for (const o of [0, 1]) {
      line(7 + o, 12, 14 + o, 1, 'S');
      line(12 - o, 12, 5 - o, 1, 'S');
    }
    line(8, 12, 14, 2, 's');
  },
  // Tips: a lit bulb.
  bulb: ({ disc, rect, px }) => {
    disc(C, 8, 6.4, shade('Y', 'y', 20));
    disc(8, 6, 1.4, 'W');
    rect(7, 13, 12, 14, 'Y');
    rect(7, 15, 12, 15, 'S');
    rect(7, 16, 12, 16, 's');
    rect(8, 17, 11, 18, 'S');
    px(10, 17, 's');
  },
  // Bankrupt players: a cracked, empty piggy bank.
  bankrupt: ({ disc, rect, px }) => {
    disc(9, 11, 6.6, shade('q', 'Q', 22), (x, y) => y <= 16);
    rect(4, 16, 5, 18, 'Q');
    rect(12, 16, 13, 18, 'Q');
    rect(15, 9, 17, 12, 'q');
    rect(17, 9, 17, 12, 'Q');
    px(16, 10, 'm');
    px(16, 11, 'm');
    paint(px, 5, 3, ['QQ', 'QQQ']);
    rect(7, 5, 10, 5, 'N');
    px(12, 9, 'N');
    // The crack: a bold zigzag down its side, with a branch.
    for (const [x, y] of [
      [9, 6],
      [8, 7],
      [9, 7],
      [7, 8],
      [8, 8],
      [8, 9],
      [9, 9],
      [9, 10],
      [10, 10],
      [10, 11],
      [11, 11],
      [9, 12],
      [10, 12],
      [8, 13],
      [9, 13],
      [8, 14],
      [11, 10],
      [12, 9],
      [13, 9],
    ])
      px(x, y, 'K');
  },
  // Clean-ups: a broom.
  broom: ({ line, px }) => {
    for (const o of [0, 1]) line(15 + o, 1, 9 + o, 10, 'e');
    line(16, 1, 10, 10, 'E');
    fillPoly(
      px,
      [
        [6, 9],
        [12, 11.5],
        [10.5, 19],
        [1, 15],
      ],
      (x, y) => ((x + y) % 3 === 0 ? 'y' : 'Y'),
    );
    line(6, 10, 11.5, 12.5, 'R');
  },
  // Bots: a friendly robot head.
  robot: ({ rect, px }) => {
    px(9, 1, 'R');
    px(10, 1, 'R');
    rect(9, 2, 10, 3, 'S');
    rect(3, 4, 16, 15, 'S');
    rect(10, 4, 16, 15, 's');
    rect(1, 8, 2, 11, 's');
    rect(17, 8, 18, 11, 's');
    rect(5, 7, 7, 9, 'c');
    rect(12, 7, 14, 9, 'c');
    rect(6, 12, 13, 13, 'N');
    for (const x of [7, 9, 11]) px(x, 12, 'W');
    rect(6, 16, 13, 18, 'S');
    rect(10, 16, 13, 18, 's');
  },
  // Settings: a steel gear.
  gear: ({ disc, rect }) => {
    rect(8, 1, 11, 18, 'S');
    rect(1, 8, 18, 11, 'S');
    disc(C, C, 7.2, 'S');
    for (const [x, y] of [
      [3, 3],
      [14, 3],
      [3, 14],
      [14, 14],
    ])
      rect(x, y, x + 2, y + 2, 'S');
    disc(C, C, 7.2, shade('S', 's', 21), (x, y) => x + y > 21);
    disc(C, C, 3, null);
  },
  // New connection: a globe.
  globe: ({ disc, line, px }) => {
    disc(C, C, 8, shade('B', 'b', 22));
    for (const [x, y] of [
      [6, 5],
      [7, 5],
      [5, 6],
      [6, 6],
      [7, 6],
      [8, 6],
      [6, 7],
      [7, 7],
      [7, 8],
      [12, 9],
      [13, 9],
      [12, 10],
      [13, 10],
      [14, 10],
      [12, 11],
      [13, 11],
      [12, 12],
      [11, 13],
      [12, 13],
    ])
      px(x, y, 'g');
    line(2, 10, 17, 10, 'c');
    line(10, 2, 10, 17, 'c');
  },
  // Duplicate names: a name tag.
  nametag: ({ rect }) => {
    rect(1, 4, 18, 15, 'R');
    rect(1, 4, 18, 6, 'r');
    rect(3, 8, 16, 14, 'W');
    rect(5, 10, 14, 10, 's');
    rect(5, 12, 11, 12, 's');
  },
  // Watching: an eye.
  eye: ({ disc, px }) => {
    disc(C, 18, 11, 'W', (x, y) => y >= 4 && y <= 10);
    disc(C, 2, 11, 'W', (x, y) => y >= 10 && y <= 16);
    disc(C, C, 4, 'B');
    disc(C, C, 2, 'N');
    px(8, 8, 'W');
  },
  // A tracked address: a red map pin.
  mappin: ({ disc, px }) => {
    disc(C, 8, 6, shade('R', 'r', 19));
    fillPoly(
      px,
      [
        [5, 11],
        [15, 11],
        [10, 19],
      ],
      (x) => (x < 11 ? 'R' : 'r'),
    );
    disc(C, 8, 2.4, 'W');
  },
};

for (const [name, draw] of Object.entries(icons)) {
  fs.writeFileSync(path.join(out, `${name}.svg`), sprite(draw, PAL));
}
console.log(`Wrote ${Object.keys(icons).length} icons to ${path.relative(process.cwd(), out)}`);
