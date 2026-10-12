// Draws the pixel-art (20x20) achievement badges into public/pins/achievements/.
// Original artwork, one draw function per badge; an auto outline gives the
// sprite edge. Run: node scripts/pixel-badges.cjs, then wire the file in as the
// achievement's `icon` in src/constants/achievements.ts.
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, '..', 'public', 'pins', 'achievements');
fs.mkdirSync(out, { recursive: true });

const PAL = {
  K: '#1a1c2c',
  W: '#f4f4f4',
  R: '#e43b44',
  r: '#a22633',
  Y: '#feae34',
  y: '#f77622',
  G: '#3e8948',
  g: '#63c74d',
  B: '#0099db',
  b: '#124e89',
  c: '#2ce8f5',
  S: '#c0cbdc',
  s: '#5a6988',
  N: '#262b44',
  P: '#b55088',
  T: '#68386c',
  O: '#e4a672',
};
const N = 20;

function sprite(draw) {
  const g = Array.from({ length: N }, () => Array(N).fill(null));
  const px = (x, y, c) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < N && y < N) g[y][x] = c;
  };
  const rect = (x0, y0, x1, y1, c) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(x, y, c);
  };
  const inDisc = (x, y, cx, cy, r) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r;
  const disc = (cx, cy, r, c, test = () => true) => {
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++)
        if (inDisc(x, y, cx, cy, r) && test(x, y)) px(x, y, typeof c === 'function' ? c(x, y) : c);
  };
  const line = (x0, y0, x1, y1, c) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
    for (let i = 0; i <= n; i++) px(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
  };
  const poly = (pts, c) => {
    for (let i = 0; i < pts.length - 1; i++) line(...pts[i], ...pts[i + 1], c);
  };
  draw({ px, rect, disc, line, poly, inDisc, g });
  // Auto outline: every empty cell touching a filled one turns dark.
  const filled = g.map((row) => row.map((c) => c && c !== 'K'));
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++)
      if (
        !g[y][x] &&
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dy]) => filled[y + dy]?.[x + dx])
      )
        g[y][x] = 'K';
  let rects = '';
  g.forEach((row, y) =>
    row.forEach((c, x) => {
      if (c) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${PAL[c]}"/>`;
    }),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges">${rects}</svg>\n`;
}

const C = 9.5; // centre of the grid
const badges = {
  first_blood: ({ disc, line, px }) => {
    disc(C, C + 0.5, 8.4, 'W');
    disc(C, C + 0.5, 6.4, 'R');
    disc(C, C + 0.5, 4.4, 'W');
    disc(C, C + 0.5, 2.4, 'R');
    line(10, 10, 16, 4, 'N');
    line(10, 9, 15, 4, 'N');
    px(15, 2, 'Y');
    px(16, 2, 'Y');
    px(16, 3, 'y');
    px(17, 4, 'Y');
    px(17, 5, 'Y');
    px(16, 4, 'y');
    px(17, 3, 'Y');
    px(5, 5, 'S');
    px(4, 6, 'S');
  },
  shark: ({ disc, rect, px }) => {
    disc(C, C, 8.6, (x, y) => (y >= 13 ? 'b' : 'B'));
    disc(C, C, 8.6, 'c', (x, y) => y === 13 && x % 3 !== 0);
    const fin = {
      3: [12, 13],
      4: [11, 13],
      5: [10, 13],
      6: [9, 13],
      7: [8, 13],
      8: [8, 12],
      9: [7, 12],
      10: [6, 12],
      11: [5, 13],
      12: [4, 14],
    };
    for (const [y, [a, b]] of Object.entries(fin)) {
      rect(a, +y, b, +y, 's');
      px(a, +y, 'S');
    }
    px(5, 5, 'c');
    px(6, 4, 'c');
  },
  diversified: ({ disc, px }) => {
    const cols = ['R', 'y', 'g', 'B', 'P'];
    disc(C, C, 8.6, (x, y) => {
      const a = (Math.atan2(y + 0.5 - C, x + 0.5 - C) * 180) / Math.PI + 90;
      return cols[Math.floor((((a % 360) + 360) % 360) / 72)];
    });
    px(5, 5, 'W');
    px(6, 4, 'W');
  },
  unifier: ({ disc, rect, px, line }) => {
    disc(C, C, 8.6, 'N');
    disc(C, C, 8.6, 'G', (x, y) => y >= 13 + (x - 9.5) ** 2 / 22);
    rect(3, 12, 5, 17, 's');
    rect(14, 13, 16, 17, 's');
    px(4, 13, 'Y');
    px(4, 15, 'Y');
    px(15, 14, 'Y');
    px(15, 16, 'Y');
    rect(9, 4, 10, 14, 'S');
    rect(7, 6, 12, 7, 'Y');
    line(9, 1, 9, 3, 'W');
    px(4, 5, 'W');
    px(15, 4, 'W');
    px(14, 9, 'Y');
  },
  monopoly: ({ rect, px }) => {
    // A green arrow slammed into a red ceiling: the price pushed as far as it goes.
    rect(2, 2, 17, 4, 'R');
    rect(2, 2, 17, 2, 'r');
    for (let y = 5; y <= 10; y++) rect(9.5 - (y - 4), y, 9.5 + (y - 4) - 1, y, 'G');
    rect(7, 11, 12, 17, 'G');
    rect(8, 11, 8, 17, 'g');
    rect(8, 6, 8, 9, 'g');
    px(3, 6, 'Y');
    px(4, 7, 'Y');
    px(16, 6, 'Y');
    px(15, 7, 'Y');
    px(1, 5, 'y');
    px(18, 5, 'y');
  },
  trader_20: ({ rect, line }) => {
    rect(1, 1, 18, 18, 'y');
    rect(2, 2, 17, 17, 'N');
    line(5, 9, 5, 16, 'g');
    rect(4, 11, 6, 15, 'g');
    line(10, 5, 10, 13, 'R');
    rect(9, 7, 11, 11, 'R');
    line(15, 2, 15, 11, 'g');
    rect(14, 4, 16, 9, 'g');
  },
  trader_100: ({ rect, poly }) => {
    rect(1, 2, 18, 13, 's');
    rect(2, 3, 17, 12, 'N');
    poly(
      [
        [3, 11],
        [5, 9],
        [7, 10],
        [9, 7],
        [11, 8],
        [14, 5],
        [16, 4],
      ],
      'g',
    );
    rect(8, 14, 11, 15, 'S');
    rect(5, 16, 14, 17, 'Y');
  },
  big_deal: ({ rect, poly, px }) => {
    rect(1, 1, 18, 18, 'Y');
    rect(2, 2, 17, 17, 'W');
    poly(
      [
        [3, 4],
        [6, 7],
        [8, 6],
        [10, 14],
      ],
      'R',
    );
    poly(
      [
        [10, 14],
        [12, 10],
        [14, 11],
        [17, 4],
      ],
      'G',
    );
    rect(9, 13, 11, 15, 'G');
    px(10, 14, 'Y');
  },
  topped_off: ({ disc, px, rect }) => {
    disc(C, C, 8.6, 'N');
    const pts = [
      [1, 18],
      [5, 12],
      [7, 14],
      [11, 6],
      [13, 9],
      [18, 18],
    ];
    const h = (x) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[i + 1];
        if (x >= x0 && x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      }
      return 99;
    };
    disc(
      C,
      C,
      8.6,
      (x, y) => (y < h(x) + 1.2 ? 'g' : 'G'),
      (x, y) => y >= h(x),
    );
    rect(11, 1, 11, 6, 'W');
    rect(12, 1, 13, 2, 'R');
    px(14, 2, 'R');
    px(12, 3, 'R');
  },
};
for (const [name, draw] of Object.entries(badges)) fs.writeFileSync(path.join(out, name + '.svg'), sprite(draw));
console.log('wrote', Object.keys(badges).length);
