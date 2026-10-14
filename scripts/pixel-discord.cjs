// Draws the pixel-art (20x20) icons the Discord bot needs that the site doesn't
// already have, into public/pins/discord/. Same engine and style as
// pixel-ui.cjs. Original artwork. Run: node scripts/pixel-discord.cjs
// Which emoji maps to which icon (these or the site's public/pins/ui set) is
// listed in scripts/discord-emoji-map.cjs.
const fs = require('fs');
const path = require('path');
const { sprite } = require('./pixel-sprite.cjs');

const out = path.join(__dirname, '..', 'public', 'pins', 'discord');
fs.mkdirSync(out, { recursive: true });

const PAL = { L: '#c9c0aa', l: '#8f8670', u: '#2d6a3a', k: '#e5e7eb', e: '#c27c48', E: '#7a4420', h: '#fde68a' };
const C = 10;
const bmp = (px, x0, y0, rows, c) =>
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => ch === 'X' && px(x0 + dx, y0 + dy, c)));
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

// A status light: a glossy round dot.
const dot =
  (hi, lo) =>
  ({ disc, px }) => {
    disc(C, C, 6.6, shade(hi, lo, 22));
    px(7, 7, 'W');
    px(8, 7, 'W');
    px(7, 8, 'W');
  };

const DIGITS = {
  4: ['X..X', 'X..X', 'XXXX', '...X', '...X', '...X'],
  5: ['XXXX', 'X...', 'XXX.', '...X', '...X', 'XXX.'],
};
// 4th / 5th place: a plain steel disc with the number, no ribbon.
const placeDisc =
  (n) =>
  ({ disc, px }) => {
    disc(C, C, 7.4, shade('S', 's', 21));
    disc(C, C, 5.6, 'k');
    bmp(px, 8, 7, DIGITS[n], 'N');
  };

const icons = {
  // Rewards and gifts: a red box with a gold ribbon and bow.
  gift: ({ rect, px }) => {
    rect(3, 9, 16, 18, 'R');
    rect(10, 9, 16, 18, 'r');
    rect(2, 6, 17, 8, 'R');
    rect(10, 6, 17, 8, 'r');
    rect(9, 6, 10, 18, 'Y');
    paint(px, 5, 2, ['.YY....YY.', 'Y..Y..Y..Y', '.YYYYYYYY.']);
  },
  // Prices down: falling candlesticks (the mirror of the site's trade icon).
  chart_down: ({ rect }) => {
    for (const [x, a, b, w0, w1, c] of [
      [2, 2, 7, 1, 9, 'g'],
      [6, 6, 10, 4, 12, 'R'],
      [10, 9, 13, 7, 15, 'R'],
      [14, 11, 15, 9, 17, 'R'],
    ]) {
      rect(x + 1, w0, x + 1, w1, c === 'g' ? 'G' : 'r');
      rect(x, a, x + 2, b, c);
    }
  },
  // Stats and reports: a bar chart on a card.
  chart: ({ rect }) => {
    rect(1, 2, 18, 17, 'W');
    rect(1, 15, 18, 17, 'S');
    rect(3, 10, 5, 14, 'B');
    rect(7, 6, 9, 14, 'g');
    rect(11, 8, 13, 14, 'Y');
    rect(15, 4, 17, 14, 'R');
  },
  // Links: two steel chain links.
  link: ({ disc }) => {
    const ring = (cx, cy) => {
      disc(cx, cy, 4.6, shade('S', 's', cx + cy + 1));
      disc(cx, cy, 2.4, null);
    };
    ring(7, 13);
    ring(13, 7);
  },
  dot_green: dot('g', 'G'),
  dot_red: dot('R', 'r'),
  dot_yellow: dot('Y', 'y'),
  dot_grey: dot('S', 's'),
  // Hot / bonus: a flame.
  fire: ({ disc, px }) => {
    disc(C, 13, 5.8, 'R');
    fillPoly(
      px,
      [
        [4.6, 12],
        [9, 1],
        [11, 6],
        [13.5, 3.5],
        [15.4, 12],
      ],
      'R',
    );
    disc(C, 14.5, 3.6, 'y');
    fillPoly(
      px,
      [
        [6.6, 14],
        [10, 6.5],
        [13.4, 14],
      ],
      'y',
    );
    disc(C, 15.5, 2, 'Y');
  },
  // Portfolio: a leather briefcase.
  briefcase: ({ rect }) => {
    rect(7, 3, 12, 4, 'E');
    rect(7, 5, 7, 6, 'E');
    rect(12, 5, 12, 6, 'E');
    rect(2, 6, 17, 17, 'e');
    rect(11, 6, 17, 17, 'E');
    rect(2, 10, 17, 11, 'E');
    rect(9, 9, 10, 12, 'Y');
  },
  // Celebrations: a party popper with confetti.
  party: ({ px }) => {
    fillPoly(
      px,
      [
        [1.5, 18.5],
        [6, 6.5],
        [13.5, 14],
      ],
      (x, y) => ((x + 20 - y) % 4 < 2 ? 'Y' : 'R'),
    );
    for (const [x, y, c] of [
      [10, 3, 'B'],
      [14, 2, 'q'],
      [17, 5, 'g'],
      [12, 7, 'Y'],
      [16, 9, 'R'],
      [18, 13, 'B'],
      [8, 1, 'g'],
    ]) {
      px(x, y, c);
      px(x + 1, y, c);
    }
  },
  // No change: a flat bar.
  flat: ({ rect }) => {
    rect(3, 8, 16, 11, 'S');
    rect(3, 10, 16, 11, 's');
  },
  // ETFs: a woven basket.
  basket: ({ rect, disc, px }) => {
    disc(C, 9, 6.4, 'E', (x, y) => y <= 9);
    disc(C, 9, 4.6, null, (x, y) => y <= 9);
    rect(2, 9, 17, 11, 'E');
    rect(3, 12, 16, 17, 'e');
    for (let y = 12; y <= 17; y++) for (let x = 3; x <= 16; x++) if ((x + y) % 3 === 0) px(x, y, 'E');
  },
  // The shop: a pink shopping bag.
  shop: ({ rect, disc }) => {
    disc(C, 7, 4, 'T', (x, y) => y <= 7);
    disc(C, 7, 2.6, null, (x, y) => y <= 7);
    rect(3, 7, 16, 18, 'q');
    rect(11, 7, 16, 18, 'Q');
    rect(3, 7, 16, 8, 'P');
  },
  // Moderation look-ups: a magnifying glass.
  inspect: ({ disc, line }) => {
    disc(8, 8, 6, 'S');
    disc(8, 8, 4.2, 'c');
    disc(7, 7, 1.4, 'W');
    for (const o of [0, 1]) line(12 + o, 13, 17 + o, 18, 'E');
    line(12, 12, 17, 17, 'e');
  },
  // Bans: an upright judge's gavel.
  hammer: ({ rect, px }) => {
    rect(2, 3, 17, 8, 'S');
    rect(2, 7, 17, 8, 's');
    rect(1, 4, 1, 7, 's');
    rect(18, 4, 18, 7, 's');
    rect(6, 3, 6, 8, 's');
    rect(13, 3, 13, 8, 's');
    rect(9, 9, 10, 18, 'e');
    rect(10, 9, 10, 18, 'E');
    px(9, 18, 'E');
  },
  // Legendary: a gold star.
  star: ({ px }) => {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 3.9 : 9.4;
      pts.push([C + r * Math.cos(a), 10.6 + r * Math.sin(a)]);
    }
    fillPoly(px, pts, (x) => (x >= C ? 'y' : 'Y'));
  },
  // Most active: a lightning bolt.
  bolt: ({ px }) => {
    paint(px, 4, 1, [
      '......YYYY',
      '.....YYYY.',
      '....YYYY..',
      '...YYYY...',
      '..YYYY....',
      '.YYYYYYYY.',
      'YYYYYYYYy.',
      '....YYYy..',
      '...YYYy...',
      '..YYYy....',
      '.YYYy.....',
      'YYYy......',
      'YYy.......',
      'Yy........',
    ]);
  },
  // Crew rankings: two crossed swords.
  swords: ({ line, rect }) => {
    for (const flip of [false, true]) {
      const X = (x) => (flip ? 19 - x : x);
      line(X(2), 2, X(12), 12, 'S');
      line(X(3), 2, X(13), 12, 'W');
      line(X(2), 3, X(12), 13, 's');
      line(X(11), 15, X(15), 11, 'Y');
      line(X(14), 15, X(17), 18, 'E');
      line(X(15), 15, X(18), 18, 'e');
    }
    rect(9, 9, 10, 10, 'S');
  },
  // Luck: a four-leaf clover.
  clover: ({ disc, line }) => {
    for (const [x, y] of [
      [7, 6],
      [13, 6],
      [7, 12],
      [13, 12],
    ])
      disc(x, y, 3.4, shade('g', 'G', x + y + 1));
    disc(C, 9, 1.4, 'G');
    line(11, 12, 15, 18, 'G');
  },
  // Jackpot: a slot machine showing three sevens.
  slot: ({ rect, px, disc }) => {
    rect(1, 4, 16, 18, 'R');
    rect(9, 4, 16, 18, 'r');
    rect(1, 3, 16, 4, 'Y');
    rect(3, 7, 15, 12, 'W');
    for (const x of [4, 8, 12]) bmp(px, x, 8, ['XXX', '..X', '.X.', '.X.'], 'R');
    rect(3, 14, 14, 16, 'N');
    rect(18, 6, 18, 12, 'S');
    disc(18, 5, 1.4, 'Y');
  },
  // Crashes and liquidations: an explosion burst.
  boom: ({ px }) => {
    paint(px, 1, 1, [
      '..R.....R......R..',
      '..RR...RRR....RR..',
      '...RRR.RyRR..RR...',
      '...RyyRRyyRRRyR...',
      'RRRRyyyyyyyyyyRR..',
      '.RRyyyYYYYYyyyRRRR',
      '..RyyYYYYYYYYyyR..',
      '..RyyYYWWWWYYyyR..',
      'RRRyyYYWWWWYYyyRRR',
      '..RyyYYWWWWYYyyR..',
      '..RyyYYYYYYYYyyR..',
      '.RRyyyYYYYYyyyRR..',
      'RRRRyyyyyyyyyyRRRR',
      '...RyRRyyRRyyRR...',
      '..RR..RRyRR..RRR..',
      '.RR....RRR.....RR.',
      '........R.........',
    ]);
  },
  // A mission not done yet: an empty box.
  todo: ({ rect }) => {
    rect(3, 3, 16, 16, 'S');
    rect(5, 5, 14, 14, null);
    rect(3, 15, 16, 16, 's');
    rect(15, 3, 16, 16, 's');
  },
  rank4: placeDisc(4),
  rank5: placeDisc(5),
};

for (const [name, draw] of Object.entries(icons)) fs.writeFileSync(path.join(out, name + '.svg'), sprite(draw, PAL));
console.log('wrote', Object.keys(icons).length);
