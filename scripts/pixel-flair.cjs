// Draws the pixel-art (20x20) flair crew crests into public/pins/crests/flair/.
// Original motifs only, never a series logo.
// Run: node scripts/pixel-flair.cjs [outDir]
const fs = require('fs');
const path = require('path');
const { sprite } = require('./pixel-sprite.cjs');

const out = process.argv[2] || path.join(__dirname, '..', 'public', 'pins', 'crests', 'flair');
fs.mkdirSync(out, { recursive: true });

const FLAIR_PAL = {
  // Brass: highlight, base, shade. Red knuckles reuse the shape with C/R/r.
  L: '#ffe08a',
  M: '#e0a526',
  D: '#9c6b12',
  C: '#ff8a8a',
  // Flame core.
  F: '#fff275',
  // Soju bottle: body, shade, shine.
  g: '#3cb371',
  G: '#1f7a45',
  h: '#a8f0c0',
  // Bottle label paper.
  Z: '#f8e6c0',
  // Mexican flag green.
  P: '#006847',
  // J High navy and gold.
  u: '#1c2a52',
  U: '#2e4a8a',
  f: '#f3c404',
  // Exit sign green, door metal.
  e: '#1e9e4a',
  // Hostel khaki.
  k: '#c9cbb4',
  H: '#7b7d68',
  // Camo: olive, dark green, brown, khaki.
  o: '#6b7a3a',
  j: '#3b4a24',
  l: '#6e4a2a',
  J: '#b8a978',
  // Wood: light, base, shade.
  w: '#d9a066',
  A: '#b07a45',
  a: '#7a4f28',
  // Mesh mask: base, mesh.
  E: '#141418',
  x: '#3a3a46',
  // Plastic wrap shine.
  I: '#e8f6ff',
  // Deep red, cash greens.
  X: '#7a1020',
  i: '#8fca78',
  t: '#4a8a48',
};

const C = 10;
// Paints rows of palette letters; '.' is empty. Every row must be the same width.
const paint = (px, x0, y0, rows, map = {}) =>
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => ch !== '.' && px(x0 + dx, y0 + dy, map[ch] || ch)));

// A knuckle duster, 16 wide: four rings over a bar and a grip.
// Turns a bitmap a quarter turn: cw puts its top edge on the right.
const turn = (rows, cw) =>
  [...rows[0]].map((_, c) =>
    rows.map((_, r) => (cw ? rows[rows.length - 1 - r][c] : rows[r][rows[0].length - 1 - c])).join(''),
  );

// 天倆 on a round seal: ring, fill, and character colors.
const seal =
  (ring, fill, ink) =>
  ({ disc, px }) => {
    disc(C, C, 9.6, ring);
    disc(C, C, 8.1, fill);
    // prettier-ignore
    paint(px, 3, 5, [
      '.ZZZZZ.',
      '...Z...',
      'ZZZZZZZ',
      '...Z...',
      '...Z...',
      '..Z.Z..',
      '.Z...Z.',
      '.Z...Z.',
      'Z.....Z',
    ], { Z: ink });
    // prettier-ignore
    paint(px, 11, 5, [
      '.Z.....',
      'Z.ZZZZZ',
      'Z...Z..',
      'Z.ZZZZZ',
      'Z.Z.Z.Z',
      'Z.ZZ.ZZ',
      'Z.Z...Z',
      'Z.Z...Z',
      'Z.Z..ZZ',
      'Z......',
    ], { Z: ink });
  };

const KNUCKLE = [
  '.LL..LL..LL..LL.',
  'L..LL..LL..LL..M',
  'M..MM..MM..MM..M',
  'MMMMMMMMMMMMMMMM',
  '.DM..........MD.',
  '..DM........MD..',
  '...DMMMMMMMMD...',
  '....DDDDDDDD....',
];

// A shield 14 wide, 18 tall; the fill letter is decided per cell.
const shield = (px, x0, y0, edge, fill) => {
  const widths = [14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 12, 10, 8, 6, 4, 2];
  widths.forEach((w, dy) => {
    const xs = x0 + (14 - w) / 2;
    for (let dx = 0; dx < w; dx++) {
      const x = xs + dx;
      const rim = dy === 0 || dx === 0 || dx === w - 1 || dy === widths.length - 1;
      px(x, y0 + dy, rim ? edge : fill(x, y0 + dy));
    }
  });
};

const crests = {
  // Brass knuckles wrapped in flame.
  burn_knuckles: ({ px }) => {
    paint(px, 1, 1, [
      '.....R....R.......',
      '....RR...RR....R..',
      '.R..RyR..RyR..RR..',
      '.RR.RyR.RyyR..RyR.',
      '.RyRRyyRRyFyR.RyyR',
      'RyyRyFyRyFFyRRyFyR',
      'RyFyyFFyyFFyyyFFyR',
      'RyFFFFFFFFFFFFFFyR',
    ]);
    paint(px, 2, 9, KNUCKLE);
  },
  // A soju bottle and a karaoke mic.
  ansan_public: ({ px }) => {
    paint(px, 2, 1, [
      '...SS......SSSS.',
      '...Gg.....SsSsSS',
      '...Gg.....sSsSsS',
      '...Gg.....SsSsSS',
      '..GggG....sSsSsS',
      '.GghggG....SSSS.',
      '.GghggG.....NN..',
      '.GghggG....SSSS.',
      '.ZZZZZZ.....NN..',
      '.ZGZGZZ.....NN..',
      '.ZZGZGZ.....NN..',
      '.ZZZZZZ.....NN..',
      '.GghggG.....NN..',
      '.GghggG.....NN..',
      '.GghggG.....NN..',
      '.GggggG.....NN..',
      '..GGGG......NN..',
    ]);
  },
  // Black-ringed red seal, white characters.
  cheonliang: seal('E', 'R', 'W'),
  // Taejin's version under Goo's Secret Friends: red ring, black seal.
  cheonliang_sf: seal('R', 'E', 'W'),

  // A navy shield with a gold J.
  j_high: ({ px }) => {
    shield(px, 3, 1, 'f', (x, y) => (y <= 2 || x <= 4 ? 'U' : 'u'));
    paint(px, 7, 4, [
      '.ffffff',
      '.ffffff',
      '...ff..',
      '...ff..',
      '...ff..',
      '...ff..',
      '...ff..',
      'ff.ff..',
      'ff.ff..',
      '.ffff..',
    ]);
  },
  // Cell bars under an EXIT sign.
  back_door: ({ rect, px }) => {
    rect(2, 1, 17, 5, 'R');
    paint(
      px,
      3,
      2,
      ['WWW.W.W.W.WWW.', 'WW...W..W..W..', 'WWW.W.W.W..W..'].map((r) => r.padEnd(14, '.')),
    );
    rect(4, 7, 15, 18, 'N');
    rect(5, 8, 14, 18, 'E');
    for (const x of [5, 8, 11, 14]) {
      rect(x, 8, x, 18, 'S');
      rect(x + 1, 8, x + 1, 18, 's');
    }
    rect(5, 10, 15, 10, 'S');
    rect(5, 16, 15, 16, 'S');
  },
  // Two red knuckle dusters, turned on end, rings locked together.
  gangseo_union: ({ px }) => {
    const left = turn(KNUCKLE, true);
    const right = turn(KNUCKLE, false);
    paint(px, 9, 3, right, { L: 'R', M: 'r', D: 'X' });
    paint(px, 2, 1, left, { L: 'C', M: 'R', D: 'r' });
    // The back duster's rings pass over the front one's, so they lock.
    for (const y0 of [4, 12])
      paint(
        px,
        9,
        3 + y0,
        right.slice(y0, y0 + 2).map((r) => r.slice(0, 3) + '.....'),
        { L: 'R', M: 'r', D: 'X' },
      );
  },
  // A slab-serif lowercase h.
  hostel_a: ({ rect, px }) => {
    rect(3, 1, 7, 3, 'k');
    rect(5, 1, 8, 18, 'k');
    rect(9, 8, 13, 10, 'k');
    px(14, 9, 'k');
    rect(12, 9, 15, 18, 'k');
    rect(3, 16, 10, 18, 'k');
    rect(11, 16, 17, 18, 'k');
    rect(8, 4, 8, 15, 'H');
    rect(15, 11, 15, 15, 'H');
    rect(9, 10, 11, 10, 'H');
  },
  // A hood pulled low, one eye catching the light.
  runaway_fam: ({ disc, rect, px }) => {
    rect(3, 14, 16, 18, 's');
    rect(2, 16, 17, 18, 's');
    disc(C, 8.5, 7.2, 's');
    disc(C, 8.5, 7.2, 'S', (x, y) => x < 7 && y < 12);
    disc(C, 9.5, 4.8, 'N');
    disc(C, 10, 4.2, 'E');
    rect(8, 15, 8, 17, 'W');
    rect(11, 15, 11, 17, 'W');
    rect(12, 9, 12, 9, 'F');
    px(11, 9, 'y');
    px(13, 9, 'y');
    px(12, 8, 'y');
    px(12, 10, 'y');
  },
  // A drill-uniform camo shield.
  liberation_training_corps: ({ px }) => {
    const camo = (x, y) => {
      const v = Math.sin(x * 0.95 + y * 0.35) + Math.sin(y * 0.8 - x * 0.45) + 0.6 * Math.sin((x + y) * 1.7);
      return v > 1.1 ? 'W' : v > 0.1 ? 'S' : v > -0.8 ? 'x' : 'E';
    };
    shield(px, 3, 1, 'R', camo);
  },
  // Small coins pouring into a begging bowl.
  the_beggars: ({ px }) => {
    const coin = (x, y) => paint(px, x, y, ['LM', 'MD']);
    const edge = (x, y) => paint(px, x, y, ['M', 'D']);
    coin(14, 0);
    edge(12, 2);
    coin(10, 3);
    coin(12, 5);
    edge(9, 6);
    coin(10, 8);
    paint(px, 2, 10, [
      '...LMMDLM.LMD...',
      'wwwwwwwwwwwwwwww',
      'waaaaaaaaaaaaaaA',
      '.AAAAAAAAAAAAAa.',
      '..AAAAAAAAAAAa..',
      '...aAAAAAAAAa...',
      '....aaaaaaaa....',
      '.....aaaaaa.....',
    ]);
  },

  // A black mesh mask with three white lights.
  black_workers: ({ disc, rect, px }) => {
    for (let y = 0; y < 20; y++)
      for (let x = 0; x < 20; x++) {
        const inside = ((x + 0.5 - C) / 6.6) ** 2 + ((y + 0.5 - C) / 9) ** 2 <= 1;
        if (!inside) continue;
        rect(x, y, x, y, (x % 4 === 1 || y % 4 === 1) && (x + y) % 2 ? 'x' : 'E');
      }
    // Three white lights in a triangle.
    for (const [x, y] of [
      [9, 6],
      [6, 11],
      [12, 11],
    ]) {
      rect(x, y, x + 1, y + 1, 'W');
      px(x + 1, y + 1, 'S');
    }
    void disc;
  },
  // A gold police badge around a seal in the Mexican flag's colors.
  the_cartel: ({ disc, px }) => {
    const rows = [
      'MM............MM',
      'MMM...MMMM...MMM',
      'MMMMMMMMMMMMMMMM',
      'MMMMMMMMMMMMMMMM',
      'MMMMMMMMMMMMMMMM',
      'MMMMMMMMMMMMMMMM',
      'MMMMMMMMMMMMMMMM',
      'MMMMMMMMMMMMMMMM',
      'MMMMMMMMMMMMMMMM',
      'MMMMMMMMMMMMMMMM',
      '.MMMMMMMMMMMMMM.',
      '..MMMMMMMMMMMM..',
      '...MMMMMMMMMM...',
      '.....MMMMMM.....',
      '.......MM.......',
    ];
    const on = (x, y) => rows[y]?.[x] === 'M';
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch !== 'M') return;
        const rim = !on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1);
        px(2 + x, 2 + y, rim ? 'D' : x + y < 9 ? 'L' : 'M');
      }),
    );
    // The seal: the flag's three stripes in a round, gold-ringed medallion.
    disc(C, 9.5, 4.4, 'D');
    disc(C, 9.5, 3.6, (x) => (x < 9 ? 'P' : x < 11 ? 'W' : 'R'));
  },
};

for (const [name, draw] of Object.entries(crests))
  fs.writeFileSync(path.join(out, name + '.svg'), sprite(draw, FLAIR_PAL));
console.log('wrote', Object.keys(crests).length);
