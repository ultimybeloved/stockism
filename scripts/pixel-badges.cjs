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
  V: '#8b5cf6',
  v: '#5b2bb5',
  p: '#f5b8a0',
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
  // ── Profits ──
  bull_run: ({ rect, px }) => {
    // Bull market: a green bull head, horns up, ears out, lighter muzzle, gold nose ring.
    rect(2, 1, 3, 3, 'W');
    rect(3, 4, 4, 5, 'W');
    rect(16, 1, 17, 3, 'W');
    rect(15, 4, 16, 5, 'W');
    rect(2, 7, 4, 8, 'G');
    rect(15, 7, 17, 8, 'G');
    rect(5, 5, 14, 12, 'G');
    rect(6, 12, 13, 16, 'g');
    rect(7, 17, 12, 17, 'g');
    rect(8, 14, 8, 15, 'N');
    rect(11, 14, 11, 15, 'N');
    rect(6, 8, 7, 9, 'K');
    px(7, 8, 'W');
    rect(12, 8, 13, 9, 'K');
    px(13, 8, 'W');
    rect(8, 18, 11, 18, 'Y');
    px(7, 17, 'Y');
    px(12, 17, 'Y');
  },
  diamond_hands: ({ rect, line, px }) => {
    // 🙌 raised hands, but the hands themselves are cut diamond: four fingers
    // and a thumb that splits off the palm with a notch, angled toward the
    // other hand.
    const hand = (dir) => {
      // dir 1 = left hand (thumb on its right), -1 = right hand, mirrored about x 9.5
      const X = (x) => (dir === 1 ? x : 19 - x);
      for (const [x, top] of [
        [0, 5],
        [2, 3],
        [4, 2],
        [6, 3],
      ])
        rect(X(x), top, X(x), 8, 'c'); // pinky → index
      for (let x = 0; x <= 6; x++) rect(X(x), 9, X(x), x === 0 || x === 6 ? 14 : 15, 'c');
      px(X(7), 12, 'c');
      px(X(7), 13, 'c');
      rect(X(8), 9, X(8), 11, 'c'); // thumb
      // facets and light
      line(X(0), 13, X(4), 9, 'B');
      line(X(2), 9, X(6), 13, 'S');
      rect(X(1), 15, X(5), 15, 'b');
      px(X(6), 14, 'b');
      px(X(7), 13, 'b');
      rect(X(0), 5, X(0), 6, 'W');
      rect(X(4), 2, X(4), 4, 'W');
      px(X(1), 10, 'W');
      px(X(8), 9, 'W');
      rect(X(2), 5, X(2), 7, 'B');
      rect(X(6), 5, X(6), 7, 'B');
    };
    hand(1);
    hand(-1);
    const star = (x, y) => {
      px(x, y, 'W');
      px(x - 1, y, 'c');
      px(x + 1, y, 'c');
      px(x, y - 1, 'c');
      px(x, y + 1, 'c');
    };
    star(9, 4);
    px(10, 1, 'W');
  },
  cold_blooded: ({ disc, rect, px }) => {
    // A drop of blood frozen inside an ice-shell drop.
    rect(9, 1, 10, 2, 'c');
    rect(8, 3, 11, 4, 'c');
    rect(7, 5, 12, 5, 'c');
    disc(C, 12.5, 6.4, 'c', (x, y) => y >= 6);
    rect(9, 6, 10, 7, 'R');
    rect(8, 8, 11, 9, 'R');
    disc(C, 13, 3.9, 'R', (x, y) => y >= 9);
    disc(C, 13, 3.9, 'r', (x, y) => y >= 13 && x >= 11);
    px(9, 2, 'W');
    px(8, 4, 'W');
    px(5, 10, 'W');
    px(4, 11, 'W');
    px(4, 12, 'W');
    px(8, 10, 'p');
    px(15, 16, 'S');
    px(14, 17, 'S');
    px(16, 6, 'W');
    px(17, 5, 'c');
    px(15, 5, 'c');
    px(16, 4, 'c');
  },
  npc_lover: ({ rect, px }) => {
    // A blank-faced background NPC with a heart floating over their head.
    rect(7, 1, 8, 1, 'V');
    rect(11, 1, 12, 1, 'V');
    rect(6, 2, 13, 3, 'V');
    rect(7, 4, 12, 4, 'V');
    rect(8, 5, 11, 5, 'V');
    rect(9, 6, 10, 6, 'V');
    px(7, 2, 'W');
    px(12, 3, 'v');
    px(11, 4, 'v');
    rect(6, 8, 13, 8, 's');
    rect(6, 9, 13, 13, 'p');
    px(8, 10, 'K');
    px(11, 10, 'K');
    rect(8, 12, 11, 12, 'O');
    rect(8, 14, 11, 14, 'p');
    rect(4, 15, 15, 19, 'S');
    rect(4, 15, 5, 19, 's');
    rect(14, 15, 15, 19, 's');
  },
  discount_deacon: ({ rect, line, px }) => {
    rect(6, 4, 18, 15, 'y');
    rect(5, 5, 5, 14, 'y');
    rect(4, 6, 4, 13, 'y');
    rect(3, 7, 3, 12, 'y');
    rect(5, 9, 6, 10, 'N');
    line(5, 9, 1, 2, 'S');
    const nine = (x) => {
      rect(x, 7, x + 2, 7, 'W');
      px(x, 8, 'W');
      px(x + 2, 8, 'W');
      rect(x, 9, x + 2, 9, 'W');
      px(x + 2, 10, 'W');
      rect(x, 11, x + 2, 11, 'W');
    };
    px(9, 11, 'W');
    nine(11);
    nine(15);
  },
  profit_champion: ({ rect, px }) => {
    rect(5, 3, 14, 9, 'Y');
    rect(6, 10, 13, 11, 'Y');
    rect(8, 12, 11, 12, 'Y');
    rect(9, 13, 10, 14, 'y');
    rect(6, 15, 13, 15, 'y');
    rect(5, 16, 14, 17, 's');
    rect(3, 4, 3, 6, 'Y');
    px(4, 3, 'Y');
    px(4, 7, 'Y');
    rect(16, 4, 16, 6, 'Y');
    px(15, 3, 'Y');
    px(15, 7, 'Y');
    rect(9, 4, 10, 8, 'W');
    px(8, 5, 'W');
    px(6, 4, 'W');
    px(6, 5, 'W');
    rect(13, 4, 13, 9, 'y');
  },
  youre_a_worker: ({ disc, rect, px }) => {
    disc(C, 13, 7.6, 'Y', (x, y) => y <= 13);
    rect(1, 13, 18, 14, 'y');
    rect(9, 6, 10, 12, 'y');
    px(5, 9, 'W');
    px(6, 8, 'W');
    px(7, 7, 'W');
    rect(4, 16, 15, 17, 's');
    px(4, 15, 's');
    px(15, 15, 's');
  },
  animal_instinct: ({ disc, line, px }) => {
    // Three solid claw slashes torn across a dark coin, tapering at both ends.
    disc(C, C, 8.6, 'N');
    for (const [x0, y0, x1, y1] of [
      [12, 2, 3, 14],
      [15, 3, 6, 16],
      [17, 6, 10, 17],
    ]) {
      line(x0, y0, x1, y1, 'R');
      line(x0 - 1, y0 + 2, x1 + 2, y1 - 1, 'R');
      line(x0, y0 + 2, x1 + 2, y1 - 2, 'r');
      px(x0, y0, 'W');
    }
  },
};
for (const [name, draw] of Object.entries(badges)) fs.writeFileSync(path.join(out, name + '.svg'), sprite(draw));
console.log('wrote', Object.keys(badges).length);
