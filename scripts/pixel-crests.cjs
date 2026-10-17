// Draws the pixel-art (20x20) crew crests, crew head mark and Discord badge into
// public/pins/crests/. Hand-simplified redraws of each logo, not downscales.
// Run: node scripts/pixel-crests.cjs
const fs = require('fs');
const path = require('path');
const { sprite } = require('./pixel-sprite.cjs');

const out = path.join(__dirname, '..', 'public', 'pins', 'crests');
fs.mkdirSync(out, { recursive: true });

// Crew colours on top of the shared palette.
const CREW_PAL = {
  a: '#8a8a8a',
  A: '#4a4a4a',
  e: '#a91a2c',
  E: '#6e1020',
  u: '#1c2a52',
  h: '#c9cbb4',
  H: '#7b7d68',
  k: '#8e2034',
  f: '#f3c404',
  z: '#5865f2',
  x: '#000000',
  // Fist Gang's red fist: highlight, base, shade, crease, thumbnail.
  1: '#ff8a8f',
  2: '#e43b44',
  3: '#a22633',
  4: '#5c0f1c',
  5: '#f8c8b8',
};

// Grid centre: cells 0-19 measured at their middles, so the true centre is 10.
const C = 10;
// Paints a bitmap: one string per row, 'X' cells get colour c.
const bmp = (px, x0, y0, rows, c) =>
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => ch === 'X' && px(x0 + dx, y0 + dy, c)));

// Paints a multi-colour bitmap: each char is a palette letter, '.' is empty.
const paint = (px, x0, y0, rows) =>
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => ch !== '.' && px(x0 + dx, y0 + dy, ch)));

const crests = {
  allied: ({ rect, line, px }) => {
    // A ring of chain links around a big empty middle: four face-on links
    // (hollow) joined by four edge-on links on the diagonals.
    const T = [(x, y) => [x, y], (x, y) => [x, 19 - y], (x, y) => [y, x], (x, y) => [19 - y, x]];
    for (const t of T) {
      for (let y = 0; y <= 3; y++)
        for (let x = 7; x <= 12; x++) {
          const corner = (x === 7 || x === 12) && (y === 0 || y === 3);
          const hole = x >= 9 && x <= 10 && y >= 1 && y <= 2;
          if (!corner && !hole) px(...t(x, y), y === 0 ? 'W' : 'S');
        }
    }
    for (const [fx, fy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      const P = (x, y, c) => px(fx ? 19 - x : x, fy ? 19 - y : y, c);
      for (const [x, y] of [
        [13, 3],
        [14, 4],
        [15, 5],
        [16, 6],
        [13, 4],
        [14, 5],
        [15, 6],
      ])
        P(x, y, 'a');
      for (const [x, y] of [
        [14, 3],
        [15, 4],
        [16, 5],
      ])
        P(x, y, 'S');
    }
    void rect;
    void line;
  },
  // "BD" on a red diamond with a gold rim.
  big_deal: ({ px }) => {
    for (let y = 0; y < 20; y++)
      for (let x = 0; x < 20; x++) {
        const d = Math.abs(x + 0.5 - 10) + Math.abs(y + 0.5 - 10);
        if (d <= 9.6) px(x, y, d > 8.1 ? (y < 10 ? 'Y' : 'd') : 'e');
      }
    // Letters nearly the crest's full height so they read at name size, with
    // a dark drop under them to lift them off the red.
    const B = [
      'XXXXX.',
      'XXXXXX',
      'XX..XX',
      'XX..XX',
      'XX.XXX',
      'XXXXX.',
      'XXXXX.',
      'XX.XXX',
      'XX..XX',
      'XX..XX',
      'XXXXXX',
      'XXXXX.',
    ];
    const D = [
      'XXXXX.',
      'XXXXXX',
      'XX..XX',
      'XX..XX',
      'XX..XX',
      'XX..XX',
      'XX..XX',
      'XX..XX',
      'XX..XX',
      'XX..XX',
      'XXXXXX',
      'XXXXX.',
    ];
    bmp(px, 4, 5, B, 'E');
    bmp(px, 11, 5, D, 'E');
    bmp(px, 3, 4, B, 'W');
    bmp(px, 10, 4, D, 'W');
  },
  // A raised red fist in three-quarter view: the lit face shows the knuckles,
  // the shaded side has the thumb wrapped round. No circle.
  fist_gang: ({ px }) =>
    paint(px, 0, 0, [
      '....................',
      '......1112..........',
      '....11222221122.....',
      '...1222242222223....',
      '...1222242224222333.',
      '...1222242224223333.',
      '...1222242224223333.',
      '...4444444444443333.',
      '...1222122212223333.',
      '...1222222222223333.',
      '..45555333333333333.',
      '..4333333333333333..',
      '...33333333333333...',
      '....3222222223333...',
      '.....222222223333...',
      '.....122222223333...',
      '.....122222223333...',
      '.....122222223333...',
      '.....122222223333...',
      '.....122222223333...',
    ]),
  // A clawed paw print under a crown.
  god_dog: ({ disc, px }) => {
    disc(C, C, 8.6, 'u');
    disc(C, 14.2, 3.3, 'W');
    for (const [cx, cy] of [
      [4.9, 10.8],
      [7.9, 8.2],
      [12.1, 8.2],
      [15.1, 10.8],
    ])
      disc(cx, cy, 1.45, 'W');
    // Claws above each toe.
    for (const [x, y] of [
      [3, 9],
      [4, 8],
      [7, 6],
      [7, 5],
      [12, 6],
      [12, 5],
      [16, 9],
      [15, 8],
    ])
      px(x, y, 'S');
    // A three-point crown with red jewels.
    paint(px, 6, 0, ['Y..YY..Y', 'YY.YY.YY', 'YRYYYYRY', 'dddddddd']);
  },
  // A roof over an H.
  hostel: ({ rect }) => {
    for (let y = 1; y <= 8; y++) rect(10 - y - 1, y, 9 + y + 1, y, 'h');
    for (let y = 3; y <= 8; y++) rect(10 - y + 1, y, 9 + y - 1, y, 'N');
    rect(3, 9, 16, 18, 'h');
    rect(5, 9, 14, 17, 'N');
    rect(6, 10, 7, 17, 'h');
    rect(12, 10, 13, 17, 'h');
    rect(8, 12, 11, 13, 'h');
    rect(9, 5, 10, 6, 'h');
  },
  kitae_union: ({ disc, line, px }) => {
    disc(C, C, 8.6, 'k');
    // Traced from the original: handle tilted top-left, black blade sweeping
    // right with a curved edge and a bearded lower tip.
    line(6, 3, 10, 15, 'O');
    line(7, 3, 11, 15, 'n');
    paint(px, 5, 1, [
      '.....s...',
      '....NNs..',
      '...NNNNs.',
      'NNNNNNNs.',
      'NNNNNNNs.',
      '..NNNNNs.',
      '...NNNNNs',
      '.....NNNs',
      '.......Ns',
    ]);
  },
  secret_friends: ({ disc, line, px }) => {
    disc(C, C, 8.6, 'f');
    disc(C, C, 7.6, 'x');
    // A katana behind a raised "shh" finger.
    line(4, 11, 10, 5, 'S');
    line(5, 11, 10, 6, 'W');
    px(11, 4, 'W');
    for (const [x, y] of [
      [2, 11],
      [3, 12],
      [4, 13],
      [3, 11],
      [4, 12],
    ])
      px(x, y, 'Y');
    for (const [x, y] of [
      [2, 13],
      [3, 14],
      [2, 14],
    ])
      px(x, y, 'r');
    // Index finger up; the other three curl into stripes, thumb across the front.
    paint(px, 10, 3, [
      '..pp...',
      '..pO...',
      '..pO...',
      '..pO...',
      '..pOpp.',
      '.ppOppO',
      'pppnppO',
      'ppppnnO',
      'pppppnO',
      '.pppppO',
      '..pppO.',
      '..pppO.',
      '..pppO.',
    ]);
  },
  workers: ({ disc, px }) => {
    disc(C, C, 8.6, 'W');
    disc(C, C, 7.6, 'x');
    bmp(
      px,
      4,
      7,
      [
        'XX........XX',
        'XX........XX',
        'XX...XX...XX',
        'XX...XX...XX',
        '.XX.XXXX.XX.',
        '.XXXX..XXXX.',
        '..XXX..XXX..',
        '..XX....XX..',
      ],
      'W',
    );
  },
  // A white-tiger-striped dollar sign.
  wtjc: ({ rect, px }) => {
    rect(9, 1, 10, 18, 'W');
    rect(5, 3, 15, 5, 'W');
    rect(4, 4, 6, 9, 'W');
    rect(5, 9, 14, 11, 'W');
    rect(13, 10, 15, 15, 'W');
    rect(4, 14, 14, 16, 'W');
    px(4, 3, null);
    // Tiger stripes: dark wedges biting in from the outer edges.
    for (const [x, y] of [
      [12, 3],
      [13, 3],
      [13, 4],
      [4, 6],
      [5, 6],
      [4, 7],
      [14, 11],
      [15, 11],
      [15, 12],
      [6, 16],
      [7, 16],
      [7, 15],
    ])
      px(x, y, 'N');
  },
  // The sun rising over a winding river.
  yamazaki: ({ disc, rect, poly }) => {
    disc(C, C, 8.6, 'f');
    disc(C, C, 8.6, 'R', (x, y) => {
      if (y > 10) return false;
      const a = Math.atan2(y + 0.5 - 11, x + 0.5 - C);
      return Math.floor(((a + Math.PI) / Math.PI) * 9) % 2 === 1;
    });
    disc(C, 11, 3.8, 'N', (x, y) => y <= 10);
    disc(C, C, 8.6, 'd', (x, y) => y >= 12);
    rect(1, 11, 18, 11, 'N');
    // The river, widening as it winds toward the viewer.
    for (const [x0, y, x1] of [
      [9, 12, 10],
      [10, 13, 11],
      [9, 14, 11],
      [6, 15, 10],
      [5, 16, 8],
      [5, 17, 10],
      [7, 18, 13],
    ])
      rect(x0, y, x1, y, 'f');
    void poly;
  },
  // Discord's mascot face, simplified.
  discord: ({ disc, px, rect }) => {
    disc(C, C, 8.6, 'z');
    bmp(
      px,
      4,
      5,
      [
        '..XX....XX..',
        '.XXXXXXXXXX.',
        '.XXXXXXXXXX.',
        'XXXXXXXXXXXX',
        'XXXXXXXXXXXX',
        'XXXXXXXXXXXX',
        'XXXXXXXXXXXX',
        '.XXX....XXX.',
        '..X......X..',
      ],
      'W',
    );
    rect(7, 9, 8, 10, 'z');
    rect(11, 9, 12, 10, 'z');
  },
  // Crew head: a gold star over rank chevrons.
  crew_head: ({ px }) => {
    bmp(px, 6, 1, ['...XX...', '...XX...', 'XXXXXXXX', '.XXXXXX.', '..XXXX..', '.XX..XX.'], 'Y');
    for (const base of [10, 13, 16])
      for (let x = 2; x <= 17; x++) {
        const yy = base - Math.floor(Math.min(x - 2, 17 - x) / 2);
        px(x, yy, 'Y');
        px(x, yy + 1, 'd');
      }
  },
};
for (const [name, draw] of Object.entries(crests))
  fs.writeFileSync(path.join(out, name + '.svg'), sprite(draw, CREW_PAL));
console.log('wrote', Object.keys(crests).length);
