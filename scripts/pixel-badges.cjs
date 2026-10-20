// Draws the pixel-art (20x20) achievement badges into public/pins/achievements/.
// Original artwork, one draw function per badge; an auto outline gives the
// sprite edge. Run: node scripts/pixel-badges.cjs, then wire the file in as the
// achievement's `icon` in src/constants/achievements.ts.
const fs = require('fs');
const path = require('path');
const { sprite } = require('./pixel-sprite.cjs');

const out = path.join(__dirname, '..', 'public', 'pins', 'achievements');
fs.mkdirSync(out, { recursive: true });

// Grid centre: cells 0-19 measured at their middles, so the true centre is 10.
const C = 10;
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
    // 🙌 raised hands, but the hands themselves are cut diamond. Fingers sit
    // side by side (alternating shades) so each hand stays small and the
    // thumb gets room to be big, angled up toward the other hand with a clear
    // notch between it and the fingers.
    const hand = (dir) => {
      // dir 1 = left hand (thumb on its right), -1 = right hand, mirrored about x 9.5
      const X = (x) => (dir === 1 ? x : 19 - x);
      // rect() wants left <= right, which a mirrored hand flips
      const R = (x0, y0, x1, y1, c) => rect(Math.min(X(x0), X(x1)), y0, Math.max(X(x0), X(x1)), y1, c);
      for (const [x, top, c] of [
        [1, 7, 'c'],
        [2, 5, 'B'],
        [3, 4, 'c'],
        [4, 5, 'B'],
      ])
        rect(X(x), top, X(x), 9, c);
      R(1, 9, 5, 15, 'c');
      R(5, 8, 5, 9, 'c');
      R(6, 12, 7, 15, 'c');
      R(7, 10, 8, 12, 'c');
      R(8, 8, 8, 9, 'c');
      line(X(1), 13, X(4), 10, 'B');
      px(X(2), 11, 'S');
      px(X(7), 11, 'S');
      R(1, 15, 6, 15, 'b');
      px(X(7), 14, 'b');
      px(X(8), 12, 'B');
      px(X(3), 4, 'W');
      px(X(8), 8, 'W');
      px(X(1), 10, 'W');
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
    star(9, 3);
    px(10, 0, 'W');
    px(0, 2, 'W');
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
  // ── Portfolio ──
  broke_2k: ({ disc, rect, line, px }) => {
    // Breaking even... kinda: a standing piggy bank, cracked and patched with a band-aid, one coin going in.
    disc(10.5, 11, 6.4, 'q');
    rect(2, 10, 4, 13, 'q');
    px(3, 11, 'Q');
    px(3, 12, 'Q');
    rect(6, 4, 7, 5, 'Q');
    px(6, 8, 'K');
    rect(5, 16, 6, 18, 'q');
    rect(14, 16, 15, 18, 'q');
    rect(8, 17, 9, 18, 'Q');
    rect(11, 17, 12, 18, 'Q');
    px(17, 9, 'Q');
    px(18, 8, 'Q');
    px(18, 10, 'Q');
    rect(9, 5, 12, 5, 'N');
    px(10, 15, 'Q');
    px(9, 16, 'Q');
    px(16, 7, 'Q');
    px(15, 6, 'Q');
    line(11, 13, 15, 9, 'O');
    line(12, 13, 16, 9, 'O');
    line(11, 12, 15, 8, 'O');
    px(13, 11, 'W');
    px(14, 10, 'W');
    px(13, 10, 'W');
    px(14, 11, 'W');
    rect(10, 1, 11, 3, 'Y');
    px(10, 1, 'W');
    px(6, 9, 'W');
    px(5, 10, 'W');
  },
  broke_5k: ({ rect, px }) => {
    // High roller: a pair of dice.
    rect(2, 4, 9, 11, 'W');
    rect(2, 11, 9, 11, 'S');
    rect(9, 4, 9, 11, 'S');
    for (const [x, y] of [
      [3, 5],
      [7, 5],
      [5, 7],
      [3, 9],
      [7, 9],
    ])
      px(x, y, 'N');
    rect(10, 9, 17, 16, 'W');
    rect(10, 16, 17, 16, 'S');
    rect(17, 9, 17, 16, 'S');
    for (const [x, y] of [
      [11, 10],
      [13, 12],
      [15, 14],
    ])
      px(x, y, 'R');
  },
  broke_10k: ({ rect, line, px }) => {
    // Big shot: a gold VIP lanyard pass.
    line(3, 0, 8, 5, 'R');
    line(16, 0, 11, 5, 'R');
    rect(9, 4, 10, 5, 'S');
    rect(4, 6, 15, 17, 'W');
    rect(4, 6, 15, 8, 'Y');
    rect(4, 17, 15, 17, 'S');
    rect(8, 7, 11, 7, 'y');
    for (const y of [10, 11, 12]) {
      px(5, y, 'N');
      px(7, y, 'N');
    }
    px(6, 13, 'N');
    px(6, 14, 'N');
    rect(9, 10, 9, 14, 'N');
    rect(11, 10, 12, 10, 'N');
    px(11, 11, 'N');
    px(13, 11, 'N');
    rect(11, 12, 12, 12, 'N');
    rect(11, 13, 11, 14, 'N');
  },
  broke_25k: ({ rect }) => {
    // Tycoon: a top hat.
    rect(5, 2, 14, 13, 'N');
    rect(6, 3, 6, 9, 's');
    rect(5, 10, 14, 11, 'R');
    rect(5, 11, 14, 11, 'r');
    rect(1, 13, 18, 14, 'N');
    rect(2, 15, 17, 15, 's');
  },
  broke_50k: ({ disc, rect, line }) => {
    // Well established: a big tree with deep roots spreading underground.
    rect(2, 13, 17, 19, 'm');
    for (const [x0, y0, x1, y1] of [
      [9, 13, 4, 18],
      [10, 13, 15, 18],
      [9, 14, 8, 19],
      [10, 14, 12, 19],
      [9, 15, 6, 19],
      [10, 15, 13, 17],
    ])
      line(x0, y0, x1, y1, 'O');
    rect(9, 9, 10, 13, 'n');
    rect(2, 12, 17, 12, 'g');
    disc(C, 5, 4.8, 'G');
    disc(5.5, 7, 3, 'G');
    disc(13.5, 7, 3, 'G');
    disc(8, 3.5, 1.6, 'g');
    disc(4.5, 6, 1, 'g');
    disc(12.5, 5.5, 1, 'g');
  },
  broke_100k: ({ rect, px }) => {
    // Six figures: a glowing LED counter that just rolled over to 100K.
    rect(0, 4, 19, 15, 's');
    rect(1, 5, 18, 14, 'N');
    const glyphs = {
      1: ['.#.', '##.', '.#.', '.#.', '###'],
      0: ['###', '#.#', '#.#', '#.#', '###'],
      K: ['#.#', '##.', '#..', '##.', '#.#'],
    };
    const draw = (ch, x, y) =>
      glyphs[ch].forEach((row, dy) => [...row].forEach((c, dx) => c === '#' && px(x + dx, y + dy, 'g')));
    ['1', '0', '0', 'K'].forEach((ch, i) => draw(ch, 2 + i * 4, 7));
    rect(2, 13, 17, 13, 'G');
    px(1, 5, 'S');
    rect(8, 16, 11, 17, 's');
  },
  broke_250k: ({ rect, px }) => {
    // Market shark: a shark in a suit and red tie, all teeth.
    rect(9, 0, 10, 2, 's');
    rect(8, 2, 11, 2, 's');
    rect(6, 3, 13, 3, 's');
    rect(4, 4, 15, 12, 's');
    rect(5, 12, 14, 12, 'S');
    rect(5, 8, 14, 11, 'r');
    for (let x = 5; x <= 14; x += 2) {
      px(x, 8, 'W');
      px(x + 1, 11, 'W');
    }
    px(6, 6, 'K');
    px(13, 6, 'K');
    rect(5, 5, 6, 5, 'S');
    rect(13, 5, 14, 5, 'S');
    rect(3, 13, 16, 19, 'N');
    rect(5, 13, 8, 14, 'W');
    rect(11, 13, 14, 14, 'W');
    rect(9, 13, 10, 14, 'R');
    rect(9, 15, 10, 17, 'R');
    px(9, 18, 'r');
    px(10, 18, 'r');
  },
  broke_500k: ({ rect, line, px }) => {
    // Untouchable: a shield with arrows bouncing off it.
    const rows = {
      3: [5, 14],
      4: [5, 14],
      5: [5, 14],
      6: [5, 14],
      7: [5, 14],
      8: [5, 14],
      9: [5, 14],
      10: [5, 14],
      11: [5, 14],
      12: [6, 13],
      13: [6, 13],
      14: [7, 12],
      15: [8, 11],
      16: [9, 10],
    };
    for (const [y, [a, b]] of Object.entries(rows)) rect(a, +y, b, +y, 'B');
    rect(6, 4, 6, 11, 'c');
    rect(5, 3, 14, 3, 'c');
    px(9, 6, 'Y');
    px(10, 6, 'Y');
    rect(8, 7, 11, 8, 'Y');
    px(9, 9, 'Y');
    px(10, 9, 'Y');
    px(9, 7, 'W');
    line(0, 3, 2, 5, 'n');
    px(3, 6, 'S');
    px(0, 2, 'W');
    px(4, 4, 'Y');
    px(3, 8, 'Y');
    line(19, 13, 17, 11, 'n');
    px(16, 10, 'S');
    px(19, 14, 'W');
    px(16, 12, 'Y');
    px(15, 8, 'Y');
  },
  broke_1m: ({ rect, px }) => {
    // First million: an open treasure chest heaped with gold.
    rect(3, 3, 16, 6, 'm');
    rect(4, 4, 15, 5, 'n');
    rect(6, 7, 13, 7, 'Y');
    rect(4, 8, 15, 8, 'Y');
    rect(3, 9, 16, 9, 'Y');
    px(8, 7, 'R');
    px(12, 8, 'c');
    px(6, 9, 'y');
    px(14, 9, 'y');
    px(10, 8, 'W');
    rect(3, 10, 16, 17, 'n');
    rect(3, 10, 16, 11, 'Y');
    rect(9, 12, 10, 14, 'Y');
    px(9, 13, 'K');
    rect(3, 17, 16, 17, 'm');
    px(1, 2, 'W');
    px(18, 3, 'W');
    px(0, 8, 'Y');
  },
  dividend_demon: ({ rect, px }) => {
    // Dividend demon: a devil's pitchfork with gold coins skewered on its prongs, rising out of flames.
    rect(3, 18, 16, 19, 'R');
    for (const c of [5, 10, 14]) {
      rect(c - 1, 15, c + 1, 19, 'y');
      px(c, 14, 'y');
      rect(c, 16, c, 18, 'Y');
    }
    rect(9, 9, 10, 17, 'r');
    rect(4, 8, 15, 9, 'R');
    rect(4, 9, 15, 9, 'r');
    rect(4, 2, 5, 7, 'R');
    rect(9, 0, 10, 7, 'R');
    rect(14, 2, 15, 7, 'R');
    const coin = (x0, y0) => {
      rect(x0, y0, x0 + 3, y0 + 2, 'Y');
      rect(x0, y0 + 2, x0 + 3, y0 + 2, 'd');
      px(x0, y0, 'W');
    };
    coin(3, 4);
    coin(8, 3);
    coin(13, 4);
  },
  // ── Predictions ──
  oracle: ({ rect, disc, line, px }) => {
    // Oracle: an all-seeing eye with a purple iris and gold rays.
    const eye = { 7: [7, 12], 8: [4, 15], 9: [2, 17], 10: [1, 18], 11: [1, 18], 12: [2, 17], 13: [4, 15], 14: [7, 12] };
    for (const [y, [a, b]] of Object.entries(eye)) rect(a, +y, b, +y, 'W');
    disc(C, 10.5, 3.6, 'V');
    disc(C, 10.5, 1.7, 'N');
    px(8, 9, 'W');
    px(11, 12, 'v');
    rect(9, 2, 10, 4, 'Y');
    line(3, 3, 5, 5, 'Y');
    line(16, 3, 14, 5, 'Y');
    line(3, 17, 5, 15, 'y');
    line(16, 17, 14, 15, 'y');
    rect(9, 16, 10, 17, 'y');
  },
  prophet: ({ rect, disc, poly, px }) => {
    // Prophet: a crystal ball on a gold stand with a rising chart glowing inside.
    disc(C, 8.5, 6.6, 'v');
    disc(9.2, 8.2, 5.3, 'V');
    poly(
      [
        [5, 11],
        [7, 9],
        [9, 10],
        [11, 7],
        [14, 5],
      ],
      'g',
    );
    px(14, 4, 'g');
    px(13, 5, 'g');
    px(6, 5, 'W');
    px(7, 4, 'W');
    px(5, 6, 'W');
    rect(6, 14, 13, 14, 'd');
    rect(5, 15, 14, 16, 'Y');
    rect(4, 17, 15, 18, 'd');
    px(5, 15, 'W');
    px(1, 3, 'W');
    px(18, 2, 'W');
    px(17, 11, 'c');
  },
  underdog: ({ rect, px }) => {
    // Underdog: a little pup wearing a crown and a gold medal.
    rect(4, 11, 13, 15, 'O');
    rect(11, 7, 16, 12, 'O');
    rect(11, 7, 12, 10, 'n');
    rect(16, 10, 17, 11, 'O');
    px(17, 10, 'K');
    px(14, 9, 'K');
    for (const x of [5, 7, 10, 12]) rect(x, 16, x, 17, 'O');
    px(3, 10, 'O');
    px(2, 9, 'O');
    rect(5, 15, 12, 15, 'n');
    rect(12, 5, 15, 6, 'Y');
    px(12, 4, 'Y');
    px(14, 4, 'Y');
    px(15, 3, 'Y');
    px(13, 5, 'R');
    rect(11, 12, 14, 12, 'R');
    rect(12, 13, 13, 14, 'Y');
    px(12, 13, 'W');
  },
  true_believer: ({ rect, px }) => {
    // True believer: a Futures ticket held to the end, stamped paid, with the coins it paid out.
    rect(2, 3, 17, 12, 'V');
    rect(2, 3, 17, 3, 'c');
    for (const y of [5, 8, 11]) {
      px(2, y, null);
      px(17, y, null);
    }
    rect(4, 5, 8, 5, 'W');
    rect(4, 7, 8, 7, 'S');
    rect(4, 9, 7, 9, 'S');
    // gold stamp disc with a bold white check
    rect(11, 4, 15, 4, 'Y');
    rect(11, 12, 15, 12, 'Y');
    rect(10, 5, 16, 11, 'Y');
    rect(11, 5, 15, 11, 'Y');
    px(10, 5, 'V');
    px(16, 5, 'V');
    px(10, 11, 'V');
    px(16, 11, 'V');
    for (const [x, y] of [
      [11, 8],
      [12, 9],
      [12, 10],
      [13, 9],
      [14, 8],
      [15, 7],
      [15, 6],
      [11, 9],
      [13, 10],
      [14, 7],
    ])
      px(x, y, 'W');
    // coins below
    const coin = (x0, y0) => {
      rect(x0, y0, x0 + 3, y0 + 2, 'Y');
      rect(x0, y0 + 2, x0 + 3, y0 + 2, 'd');
      px(x0, y0, 'W');
    };
    coin(4, 16);
    coin(9, 15);
    coin(14, 16);
    rect(9, 18, 12, 18, 'd');
    px(1, 1, 'W');
    px(18, 14, 'W');
  },

  // ── Ladder Game ──
  compulsive_gambler: ({ rect, px }) => {
    // Compulsive gambler: a ladder with gold piled on its rungs, more the higher it goes.
    rect(4, 1, 5, 19, 'n');
    rect(14, 1, 15, 19, 'n');
    for (const y of [4, 8, 12, 16]) rect(6, y, 13, y, 'O');
    const coins = (y, w) => {
      rect(10 - w, y - 1, 9 + w, y - 1, 'Y');
      rect(10 - w, y - 1, 9 + w, y - 1, 'Y');
      px(10 - w, y - 1, 'W');
    };
    coins(16, 1);
    coins(12, 2);
    coins(8, 3);
    rect(7, 2, 12, 3, 'Y');
    rect(7, 3, 12, 3, 'd');
    px(7, 2, 'W');
    px(9, 0, 'Y');
    px(1, 3, 'W');
    px(18, 6, 'W');
  },
  addicted: ({ disc, line, rect, px }) => {
    // Addicted: a hamster running in its wheel, round and round.
    line(9, 9, 3, 19, 'n');
    line(10, 9, 16, 19, 'n');
    const ring = (x, y) => (x + 0.5 - C) ** 2 + (y + 0.5 - 9) ** 2 > 6.4 * 6.4;
    disc(C, 9, 8, 'S', ring);
    for (const [x, y] of [
      [9, 1],
      [15, 3],
      [17, 9],
      [15, 15],
      [3, 15],
      [1, 9],
      [3, 3],
    ])
      px(x, y, 's');
    rect(9, 8, 10, 9, 'n');
    const body = { 11: [7, 11], 12: [6, 12], 13: [6, 12], 14: [7, 11] };
    for (const [y, [a, b]] of Object.entries(body)) rect(a, +y, b, +y, 'O');
    rect(11, 10, 13, 13, 'O');
    px(11, 9, 'O');
    px(13, 11, 'K');
    px(14, 12, 'q');
    px(12, 12, 'q');
    rect(7, 14, 10, 14, 'p');
    px(7, 15, 'q');
    px(11, 15, 'q');
    px(3, 11, 'W');
    px(4, 13, 'W');
    px(3, 13, 'W');
  },
  casino_champion: ({ rect, px }) => {
    // Casino champion: a gold championship belt with a "1" on the plate.
    rect(0, 8, 19, 12, 'R');
    rect(0, 12, 19, 12, 'r');
    rect(2, 9, 3, 11, 'Y');
    rect(16, 9, 17, 11, 'Y');
    rect(6, 5, 13, 15, 'Y');
    rect(5, 6, 14, 14, 'Y');
    rect(7, 6, 12, 14, 'd');
    rect(9, 7, 10, 13, 'W');
    px(8, 8, 'W');
    rect(8, 13, 11, 13, 'W');
    px(6, 6, 'W');
    px(5, 7, 'W');
  },
  jihoism: ({ rect, px }) => {
    // Jihoism: the whole balance tumbling away, coins and a bill falling past a red crash arrow.
    const coin = (x, y) => {
      rect(x + 1, y, x + 2, y, 'Y');
      rect(x, y + 1, x + 3, y + 2, 'Y');
      rect(x + 1, y + 3, x + 2, y + 3, 'd');
      px(x + 1, y + 1, 'W');
      px(x + 1, y - 2, 'S');
      px(x + 2, y - 3, 'S');
      px(x + 1, y - 4, 's');
    };
    rect(1, 1, 6, 4, 'G');
    rect(2, 2, 5, 3, 'g');
    px(3, 2, 'G');
    px(4, 3, 'G');
    px(2, 0, 's');
    px(5, 0, 's');
    coin(8, 4);
    coin(3, 9);
    coin(9, 12);
    coin(4, 15);
    rect(15, 2, 16, 13, 'R');
    rect(13, 13, 18, 13, 'R');
    rect(14, 14, 17, 14, 'R');
    rect(15, 15, 16, 15, 'R');
    rect(16, 2, 16, 13, 'r');
  },
  // ── Dedication ──
  dedicated_7: ({ rect, px }) => {
    // Regular: a steaming coffee mug, the regular's order.
    rect(2, 17, 17, 18, 'S');
    rect(4, 6, 13, 16, 'W');
    rect(13, 7, 13, 16, 'S');
    rect(4, 6, 13, 6, 'S');
    rect(5, 7, 12, 8, 'n');
    rect(4, 11, 13, 12, 'R');
    rect(14, 9, 16, 9, 'W');
    rect(16, 10, 16, 13, 'W');
    rect(14, 14, 16, 14, 'W');
    for (const x of [6, 10]) {
      px(x, 4, 'S');
      px(x, 3, 'S');
      px(x + 1, 2, 'S');
      px(x + 1, 1, 'S');
      px(x, 0, 'S');
    }
  },
  dedicated_14: ({ disc, rect, px }) => {
    // Committed: a diamond engagement ring.
    disc(C, 12.5, 6.2, 'Y', (x, y) => (x + 0.5 - C) ** 2 + (y + 0.5 - 12.5) ** 2 > 4.4 * 4.4);
    disc(C, 12.5, 6.2, 'd', (x, y) => y >= 14 && x >= 10 && (x + 0.5 - C) ** 2 + (y + 0.5 - 12.5) ** 2 > 4.4 * 4.4);
    rect(8, 1, 11, 1, 'c');
    rect(7, 2, 12, 2, 'c');
    rect(7, 3, 12, 3, 'B');
    rect(8, 4, 11, 4, 'B');
    rect(9, 5, 10, 5, 'b');
    px(8, 1, 'W');
    px(7, 2, 'W');
    px(7, 4, 'Y');
    px(12, 4, 'Y');
    rect(8, 6, 11, 6, 'Y');
    px(3, 2, 'W');
    px(16, 1, 'W');
    px(15, 5, 'c');
  },
  dedicated_30: ({ rect, px }) => {
    // Devoted: a candle burning steady.
    const flame = { 1: [9, 9], 2: [9, 10], 3: [8, 10], 4: [8, 11], 5: [8, 11], 6: [9, 10] };
    for (const [y, [a, b]] of Object.entries(flame)) rect(a, +y, b, +y, 'y');
    rect(9, 3, 9, 5, 'Y');
    px(10, 4, 'Y');
    px(9, 4, 'W');
    px(9, 7, 'N');
    rect(7, 8, 12, 16, 'W');
    rect(12, 8, 12, 16, 'S');
    px(7, 9, 'W');
    px(6, 9, 'W');
    px(6, 10, 'W');
    rect(4, 16, 15, 17, 'd');
    rect(5, 16, 14, 16, 'Y');
    rect(16, 16, 17, 16, 'd');
    px(4, 3, 'Y');
    px(15, 2, 'Y');
    px(14, 6, 'y');
  },
  dedicated_100: ({ rect, px }) => {
    // Legendary: the sword in the stone.
    const stone = { 13: [6, 13], 14: [4, 15], 15: [3, 16], 16: [3, 16], 17: [3, 16], 18: [3, 16] };
    for (const [y, [a, b]] of Object.entries(stone)) rect(a, +y, b, +y, 'S');
    px(6, 16, 's');
    px(7, 17, 's');
    px(13, 15, 's');
    px(14, 16, 's');
    rect(3, 18, 16, 18, 's');
    px(2, 18, 'G');
    px(17, 18, 'G');
    px(1, 18, 'g');
    rect(9, 6, 10, 13, 'W');
    rect(10, 6, 10, 13, 'S');
    rect(6, 5, 13, 5, 'Y');
    rect(9, 1, 10, 4, 'n');
    rect(9, 0, 10, 0, 'Y');
    px(6, 4, 'Y');
    px(13, 4, 'Y');
    px(5, 8, 'c');
    px(14, 9, 'c');
    px(4, 2, 'c');
    px(15, 2, 'W');
  },

  // ── Missions ──
  mission_10: ({ rect, px }) => {
    // Task runner: a running sneaker with speed lines.
    const upper = { 9: [9, 12], 10: [6, 13], 11: [4, 15], 12: [3, 16], 13: [3, 17] };
    for (const [y, [a, b]] of Object.entries(upper)) rect(a, +y, b, +y, 'R');
    rect(8, 9, 11, 9, 'N');
    px(10, 10, 'W');
    px(11, 11, 'W');
    px(12, 12, 'W');
    rect(4, 12, 9, 12, 'W');
    rect(3, 10, 5, 11, 'r');
    rect(2, 14, 18, 15, 'W');
    rect(2, 16, 18, 16, 's');
    px(18, 14, 'S');
    rect(0, 9, 2, 9, 'S');
    rect(0, 11, 1, 11, 'S');
    rect(0, 13, 1, 13, 's');
  },
  mission_50: ({ rect, px }) => {
    // Mission master: a treasure map, the dotted route ending at the red X.
    rect(2, 3, 17, 16, 'p');
    rect(2, 3, 17, 3, 'O');
    rect(2, 16, 17, 16, 'O');
    px(2, 8, 'O');
    px(17, 11, 'O');
    px(6, 16, 'n');
    px(12, 3, 'n');
    for (const [x, y] of [
      [4, 14],
      [6, 13],
      [8, 13],
      [9, 11],
      [8, 9],
      [10, 8],
      [12, 8],
    ])
      px(x, y, 'n');
    px(4, 14, 'G');
    rect(3, 13, 4, 14, 'G');
    px(13, 5, 'R');
    px(15, 5, 'R');
    px(14, 6, 'R');
    px(13, 7, 'R');
    px(15, 7, 'R');
    rect(4, 5, 5, 6, 'G');
    px(4, 4, 'G');
    rect(14, 12, 15, 13, 'B');
  },
  mission_100: ({ disc, rect, px }) => {
    // Mission legend: a flag planted on the moon, mission accomplished.
    disc(C, 22, 10.5, 'S');
    px(5, 15, 's');
    px(6, 15, 's');
    px(13, 14, 's');
    px(14, 16, 's');
    px(9, 17, 's');
    px(10, 17, 's');
    rect(9, 2, 9, 13, 'W');
    rect(10, 2, 16, 7, 'R');
    rect(10, 4, 16, 5, 'W');
    px(10, 2, 'r');
    px(2, 3, 'W');
    px(4, 9, 'W');
    px(17, 10, 'W');
    px(15, 0, 'Y');
    px(1, 12, 'c');
  },
  // ── Leaderboard ──
  top_10: ({ px }) => {
    // Contender: a bold white "10" inside a laurel wreath tied with red.
    for (let y = 3; y <= 16; y++) {
      const off = Math.round(((y - 10) * (y - 10)) / 18) - 1;
      px(2 + off, y, 'G');
      px(17 - off, y, 'G');
      if (y % 2 === 0) {
        px(3 + off, y, 'g');
        px(16 - off, y, 'g');
        px(1 + off, y - 1, 'g');
        px(18 - off, y - 1, 'g');
      }
    }
    const paintRows = (x0, y0, rows) =>
      rows.forEach((row, dy) => [...row].forEach((ch, dx) => ch === 'X' && px(x0 + dx, y0 + dy, 'W')));
    paintRows(5, 6, ['.XX', 'XXX', '.XX', '.XX', '.XX', '.XX', '.XX']);
    paintRows(10, 6, ['.XXX.', 'XX.XX', 'XX.XX', 'XX.XX', 'XX.XX', 'XX.XX', '.XXX.']);
    px(9, 17, 'R');
    px(10, 17, 'R');
    px(8, 18, 'R');
    px(11, 18, 'R');
  },
  top_3: ({ rect, px }) => {
    // Elite: the 1-2-3 podium.
    const glyph = {
      1: ['.#.', '##.', '.#.', '.#.', '###'],
      2: ['##.', '..#', '.#.', '#..', '###'],
      3: ['##.', '..#', '.#.', '..#', '##.'],
    };
    const draw = (ch, x, y, c) =>
      glyph[ch].forEach((row, dy) => [...row].forEach((k, dx) => k === '#' && px(x + dx, y + dy, c)));
    rect(0, 9, 6, 17, 'S');
    rect(7, 5, 12, 17, 'Y');
    rect(13, 12, 19, 17, 'O');
    rect(0, 9, 6, 9, 'W');
    rect(7, 5, 12, 5, 'W');
    rect(13, 12, 19, 12, 'p');
    rect(6, 10, 6, 17, 's');
    rect(12, 6, 12, 17, 'd');
    rect(19, 13, 19, 17, 'n');
    draw(1, 8, 7, 'd');
    draw(2, 2, 11, 's');
    draw(3, 15, 13, 'n');
    rect(0, 18, 19, 18, 's');
  },
  top_1: ({ rect, px }) => {
    // Champion: a laurel wreath around a gold "1".
    for (const [x, y] of [
      [5, 4],
      [4, 6],
      [3, 8],
      [3, 10],
      [4, 12],
      [5, 14],
      [7, 16],
    ]) {
      px(x, y, 'G');
      px(x - 1, y, 'g');
      px(x, y + 1, 'G');
      px(19 - x, y, 'G');
      px(20 - x, y, 'g');
      px(19 - x, y + 1, 'G');
    }
    rect(9, 4, 10, 13, 'Y');
    px(8, 5, 'Y');
    rect(8, 13, 11, 13, 'Y');
    rect(10, 4, 10, 13, 'd');
    px(9, 4, 'W');
    rect(9, 16, 10, 17, 'R');
    px(8, 18, 'R');
    px(11, 18, 'R');
  },

  // ── Crew ──
  crowned: ({ disc, rect, px }) => {
    // Crowned: a crown being lowered onto a head.
    disc(C, 21, 7.6, 'N', (x, y) => y >= 13);
    rect(5, 16, 14, 19, 'p');
    rect(4, 15, 15, 15, 'N');
    px(7, 18, 'K');
    px(12, 18, 'K');
    px(6, 13, 's');
    rect(5, 8, 14, 10, 'Y');
    rect(5, 10, 14, 10, 'd');
    rect(5, 5, 5, 7, 'Y');
    rect(9, 4, 10, 7, 'Y');
    rect(14, 5, 14, 7, 'Y');
    rect(6, 7, 13, 7, 'Y');
    px(6, 6, 'Y');
    px(13, 6, 'Y');
    px(5, 4, 'W');
    px(14, 4, 'W');
    rect(9, 3, 10, 3, 'R');
    px(8, 9, 'R');
    px(11, 9, 'B');
    rect(2, 6, 2, 10, 'S');
    rect(17, 6, 17, 10, 'S');
    px(3, 12, 'S');
    px(16, 12, 'S');
  },
  dynasty: ({ rect, px }) => {
    // Dynasty: a castle that has stood for ages, flying the royal banner.
    rect(3, 9, 16, 18, 'S');
    rect(1, 6, 5, 18, 'S');
    rect(14, 6, 18, 18, 'S');
    for (const x of [1, 3, 5, 14, 16, 18]) px(x, 5, 'S');
    for (const x of [7, 9, 11, 13]) px(x, 8, 'S');
    rect(5, 7, 5, 18, 's');
    rect(18, 7, 18, 18, 's');
    rect(3, 18, 16, 18, 's');
    rect(8, 13, 11, 18, 'N');
    rect(9, 12, 10, 12, 'N');
    px(3, 9, 'N');
    px(3, 10, 'N');
    px(16, 9, 'N');
    px(16, 10, 'N');
    px(5, 13, 's');
    px(14, 15, 's');
    px(12, 11, 's');
    rect(9, 1, 9, 7, 'n');
    rect(10, 1, 14, 4, 'R');
    rect(10, 4, 14, 4, 'r');
    px(11, 2, 'Y');
    px(13, 2, 'Y');
    rect(11, 3, 13, 3, 'Y');
    px(12, 2, 'Y');
  },
  usurper: ({ rect, px }) => {
    // Usurper: a dagger driven down through a crown.
    rect(3, 14, 16, 18, 'Y');
    rect(3, 18, 16, 18, 'd');
    rect(3, 11, 5, 13, 'Y');
    rect(4, 10, 4, 10, 'Y');
    rect(8, 11, 11, 13, 'Y');
    rect(14, 11, 16, 13, 'Y');
    px(15, 10, 'Y');
    px(4, 9, 'W');
    px(15, 9, 'W');
    px(6, 16, 'R');
    px(13, 16, 'B');
    px(7, 15, 'd');
    px(8, 16, 'd');
    px(7, 17, 'd');
    px(12, 15, 'd');
    px(11, 16, 'd');
    px(12, 17, 'd');
    rect(9, 5, 10, 15, 'W');
    rect(10, 5, 10, 15, 'S');
    rect(6, 4, 13, 4, 'S');
    rect(9, 1, 10, 3, 'n');
    rect(9, 0, 10, 0, 'R');
  },
};
for (const [name, draw] of Object.entries(badges)) fs.writeFileSync(path.join(out, name + '.svg'), sprite(draw));
console.log('wrote', Object.keys(badges).length);
