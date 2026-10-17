// Draws the pixel-art (20x20) site icons (nav, buttons, status tags, logo pin)
// into public/pins/ui/. Original artwork. Run: node scripts/pixel-ui.cjs
const fs = require('fs');
const path = require('path');
const { sprite } = require('./pixel-sprite.cjs');

const out = path.join(__dirname, '..', 'public', 'pins', 'ui');
fs.mkdirSync(out, { recursive: true });

const UI_PAL = {
  x: '#000000',
  L: '#c9c0aa',
  l: '#8f8670',
  D: '#333333',
  h: '#fde68a',
  e: '#c27c48',
  E: '#7a4420',
  k: '#e5e7eb',
  u: '#2d6a3a',
  z: '#7dd3fc',
};

// Grid centre: cells 0-19 measured at their middles, so the true centre is 10.
const C = 10;
const bmp = (px, x0, y0, rows, c) =>
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => ch === 'X' && px(x0 + dx, y0 + dy, c)));
const paint = (px, x0, y0, rows) =>
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => ch !== '.' && px(x0 + dx, y0 + dy, ch)));
const mirror = (px) => (x, y, c) => {
  px(x, y, c);
  px(19 - x, y, c);
};

const DIGITS = {
  1: ['.XX.', 'XXX.', '.XX.', '.XX.', '.XX.', 'XXXX'],
  2: ['XXX.', '...X', '.XX.', 'X...', 'X...', 'XXXX'],
  3: ['XXX.', '...X', '.XX.', '...X', '...X', 'XXX.'],
};
// Leaderboard top 3: a numbered medal on a blue-and-red ribbon.
const rankMedal =
  (n, hi, lo, ink) =>
  ({ disc, rect, px }) => {
    for (let y = 0; y <= 7; y++) {
      const o = Math.floor(y / 2);
      rect(4 + o, y, 6 + o, y, 'B');
      rect(13 - o, y, 15 - o, y, 'R');
    }
    disc(C, 13, 5.6, lo);
    disc(C, 13, 4.4, hi);
    bmp(px, 8, 10, DIGITS[n], ink);
  };

// The speaker both sound toggle icons share: a box and a flared cone.
const speaker = ({ rect }) => {
  rect(1, 7, 4, 12, 'Y');
  rect(1, 11, 4, 12, 'y');
  for (let x = 5; x <= 10; x++) {
    const o = x - 4;
    rect(x, 7 - o, x, 12 + o, 'Y');
    rect(x, 10, x, 12 + o, 'y');
  }
};

const icons = {
  // Leaderboard: a gold trophy on a wooden plinth.
  trophy: ({ rect, px }) => {
    const rows = [
      [2, 4, 15],
      [3, 4, 15],
      [4, 4, 15],
      [5, 5, 14],
      [6, 5, 14],
      [7, 6, 13],
      [8, 7, 12],
      [9, 8, 11],
    ];
    for (const [y, a, b] of rows) {
      rect(a, y, b, y, 'Y');
      rect(Math.max(a, 12), y, b, y, 'y');
    }
    rect(4, 2, 15, 2, 'h');
    rect(6, 3, 6, 6, 'W');
    const M = mirror(px);
    for (const [x, y] of [
      [3, 3],
      [2, 3],
      [1, 4],
      [1, 5],
      [2, 6],
      [3, 7],
      [4, 7],
    ])
      M(x, y, 'Y');
    rect(9, 10, 10, 12, 'y');
    rect(7, 13, 12, 13, 'Y');
    rect(5, 14, 14, 17, 'n');
    rect(5, 17, 14, 17, 'm');
    rect(8, 15, 11, 15, 'Y');
  },
  // Predictions: a crystal ball holding a glowing question mark.
  crystal: ({ disc, rect, px }) => {
    disc(C, 8.6, 6.6, (x, y) => (x + y > 21 ? 'v' : 'V'));
    px(6, 5, 'W');
    px(7, 4, 'W');
    px(6, 6, 'q');
    bmp(px, 8, 5, ['.XX.', 'X..X', '...X', '..X.', '....', '..X.'], 'c');
    rect(6, 15, 13, 15, 'Y');
    rect(5, 16, 14, 17, 'd');
  },
  // Achievements: a starred gold medal on a red-and-blue ribbon.
  medal: ({ disc, rect, px }) => {
    for (let y = 0; y <= 7; y++) {
      const o = Math.floor(y / 2);
      rect(4 + o, y, 6 + o, y, 'B');
      rect(13 - o, y, 15 - o, y, 'R');
    }
    disc(C, 13, 5.6, 'y');
    disc(C, 13, 4.4, 'Y');
    bmp(px, 7, 10, ['..XX..', '..XX..', 'XXXXXX', '.XXXX.', '.XXXX.', 'XX..XX'], 'W');
  },
  // Season: a silver medal set with a diamond, on a purple-and-teal ribbon.
  season: ({ disc, rect }) => {
    for (let y = 0; y <= 7; y++) {
      const o = Math.floor(y / 2);
      rect(4 + o, y, 6 + o, y, 'V');
      rect(13 - o, y, 15 - o, y, 'c');
    }
    disc(C, 13, 5.6, 's');
    disc(C, 13, 4.4, 'S');
    rect(8, 11, 11, 11, 'c');
    rect(7, 12, 12, 12, 'B');
    rect(8, 13, 11, 13, 'B');
    rect(9, 14, 10, 14, 'b');
    rect(8, 11, 8, 11, 'W');
  },
  // Ladder: the game's X-in-a-circle mark.
  ladder: ({ disc, line }) => {
    disc(C, C, 8.6, (x, y) => (x + y > 21 ? 'l' : 'L'));
    for (const o of [-1, 0, 1]) {
      line(5 + Math.max(o, 0), 5 + Math.max(-o, 0), 14 - Math.max(-o, 0), 14 - Math.max(o, 0), 'D');
      line(14 - Math.max(o, 0), 5 + Math.max(-o, 0), 5 + Math.max(-o, 0), 14 - Math.max(o, 0), 'D');
    }
  },
  // Light mode toggle: the sun.
  sun: ({ disc, rect, px }) => {
    disc(C, C, 4.6, (x, y) => (x + y > 21 ? 'y' : 'Y'));
    px(8, 8, 'h');
    rect(9, 1, 10, 3, 'Y');
    rect(9, 16, 10, 18, 'y');
    rect(1, 9, 3, 10, 'Y');
    rect(16, 9, 18, 10, 'y');
    for (const [x, y, c] of [
      [4, 4, 'Y'],
      [5, 5, 'Y'],
      [15, 4, 'Y'],
      [14, 5, 'Y'],
      [4, 15, 'y'],
      [5, 14, 'y'],
      [15, 15, 'y'],
      [14, 14, 'y'],
    ])
      px(x, y, c);
  },
  // Dark mode toggle: a crescent moon with two stars.
  moon: ({ disc, px, inDisc }) => {
    disc(9, 11, 7, 'h', (x, y) => !inDisc(x, y, 13, 7.5, 5.8));
    disc(9, 11, 7, 'Y', (x, y) => !inDisc(x, y, 13, 7.5, 5.8) && x + y > 20);
    px(5, 12, 'Y');
    px(7, 15, 'Y');
    for (const [x, y] of [
      [15, 3],
      [14, 12],
    ]) {
      px(x, y, 'W');
      px(x - 1, y, 'S');
      px(x + 1, y, 'S');
      px(x, y - 1, 'S');
      px(x, y + 1, 'S');
    }
  },
  // Sound effects toggle: a speaker with sound waves, or crossed out.
  sound_on: (t) => {
    speaker(t);
    for (const r of [4.6, 7.6]) t.disc(9, C, r, 'B', (x, y) => x >= 12 && !t.inDisc(x, y, 9, C, r - 1.3));
  },
  sound_off: (t) => {
    speaker(t);
    for (const o of [0, 1]) {
      t.line(13 + o, 7, 18, 12 - o, 'R');
      t.line(13, 7 + o, 18 - o, 12, 'R');
      t.line(18 - o, 7, 13, 12 - o, 'R');
      t.line(18, 7 + o, 13 + o, 12, 'R');
    }
  },
  // Notifications: a ringing bell.
  bell: ({ disc, rect, px }) => {
    disc(C, 8, 5, 'Y', (x, y) => y <= 8);
    for (let y = 8; y <= 13; y++) rect(5 - Math.floor((y - 8) / 3), y, 14 + Math.floor((y - 8) / 3), y, 'Y');
    for (let y = 5; y <= 13; y++) rect(13 + Math.floor((y - 8) / 3), y, 14 + Math.floor((y - 8) / 3), y, 'y');
    rect(3, 14, 16, 15, 'y');
    rect(9, 1, 10, 2, 'y');
    disc(C, 17, 1.6, 'y');
    px(7, 6, 'W');
    px(6, 8, 'W');
    px(6, 9, 'W');
  },
  // Profile: a trader in a suit and red tie.
  profile: ({ disc, rect }) => {
    disc(C, 19.5, 8.2, 'N', (x, y) => y >= 12);
    rect(8, 12, 11, 12, 'W');
    rect(9, 13, 10, 13, 'W');
    rect(9, 13, 10, 18, 'R');
    rect(9, 13, 10, 13, 'r');
    rect(9, 10, 10, 11, 'p');
    disc(C, 6.5, 3.8, 'p');
    disc(C, 5.6, 4, 'm', (x, y) => y <= 4);
    rect(6, 5, 6, 6, 'm');
    rect(13, 5, 13, 6, 'm');
  },
  // Missions: a clipboard with a checklist.
  missions: ({ rect, px }) => {
    rect(3, 2, 16, 18, 'n');
    rect(5, 4, 14, 17, 'W');
    rect(7, 1, 12, 3, 'S');
    rect(9, 1, 10, 1, 's');
    for (const [y, done] of [
      [7, true],
      [11, true],
      [15, false],
    ]) {
      rect(10, y, 13, y, 's');
      if (done)
        for (const [x, dy] of [
          [6, 0],
          [7, 1],
          [8, 0],
          [9, -1],
        ])
          px(x, y + dy, 'G');
      else rect(6, y - 1, 8, y + 1, 'S');
    }
  },
  // Customization: a painter's palette.
  palette: ({ disc, px }) => {
    disc(C, C, 8, (x, y) => (x + y > 23 ? 'n' : 'O'));
    disc(13.5, 13.5, 1.8, null);
    disc(17.5, 11.5, 2.4, null);
    disc(6, 7, 1.7, 'R');
    disc(10.5, 5, 1.7, 'Y');
    disc(15, 6.5, 1.7, 'B');
    disc(5.5, 12, 1.7, 'g');
    disc(9.5, 15, 1.7, 'V');
    px(5, 6, 'W');
    px(10, 4, 'W');
  },
  // About: a blue info badge.
  about: ({ disc, rect }) => {
    disc(C, C, 8.6, (x, y) => (x + y > 21 ? 'b' : 'B'));
    rect(9, 4, 10, 5, 'W');
    rect(8, 8, 10, 8, 'W');
    rect(9, 9, 10, 14, 'W');
    rect(8, 15, 11, 15, 'W');
  },
  // Status: dead. A skull.
  dead: ({ disc, rect, px }) => {
    disc(C, 8.5, 6.8, (x, y) => (x + y > 22 ? 'S' : 'W'));
    rect(6, 12, 13, 17, 'W');
    rect(12, 12, 13, 17, 'S');
    rect(5, 8, 8, 11, 'x');
    rect(11, 8, 14, 11, 'x');
    px(5, 8, 'W');
    px(14, 8, 'W');
    rect(9, 12, 10, 13, 'x');
    for (const x of [7, 9, 11]) rect(x, 15, x, 17, 's');
  },
  // Status: alive. A heart with a pulse line. Kept on file, not shown (alive is the default).
  alive: ({ disc, rect, poly }) => {
    disc(6.5, 7.5, 4.2, 'R');
    disc(13.5, 7.5, 4.2, 'R');
    for (let y = 8; y <= 17; y++) rect(2 + (y - 8), y, 17 - (y - 8), y, 'R');
    disc(6, 6, 1.5, 'q');
    poly(
      [
        [1, 10],
        [5, 10],
        [7, 7],
        [9, 13],
        [11, 5],
        [13, 10],
        [18, 10],
      ],
      'W',
    );
  },
  // The Stockism "S": an angular gold S on a black ink splat.
  stockism: ({ disc, px }) => {
    disc(C, C, 7.4, 'x');
    for (const [x, y] of [
      [2, 4],
      [3, 3],
      [1, 9],
      [2, 14],
      [3, 16],
      [6, 18],
      [12, 18],
      [16, 17],
      [17, 15],
      [18, 11],
      [17, 6],
      [16, 3],
      [12, 1],
      [7, 1],
      [0, 6],
      [19, 9],
      [14, 19],
      [4, 0],
    ])
      px(x, y, 'x');
    paint(px, 5, 4, [
      '...hhhhhhh',
      '..YYYYYYYY',
      '.YYY......',
      'YYY.......',
      'YYY.......',
      'YYYYYYYY..',
      '.yyyyyyyy.',
      '.......yyy',
      '.......yyy',
      '......yyy.',
      'yyyyyyyy..',
      'yyyyyyy...',
    ]);
  },

  // Crews: a squad of three, the leader up front.
  crews: ({ disc }) => {
    disc(4.5, 6, 2.4, 's');
    disc(4.5, 16, 4.4, 's', (x, y) => y >= 10);
    disc(15.5, 6, 2.4, 'b');
    disc(15.5, 16, 4.4, 'b', (x, y) => y >= 10);
    disc(C, 8, 3, 'O');
    disc(C, 20.5, 6.6, 'y', (x, y) => y >= 12);
  },
  // Margin: a credit card with a green plus, borrowed buying power.
  margin: ({ rect, disc }) => {
    rect(1, 5, 16, 16, 'B');
    rect(1, 7, 16, 8, 'b');
    rect(3, 10, 5, 12, 'Y');
    rect(4, 10, 4, 12, 'd');
    rect(8, 14, 9, 14, 'S');
    rect(11, 14, 12, 14, 'S');
    rect(14, 14, 15, 14, 'S');
    disc(15.5, 4.5, 4, 'g');
    rect(15, 2, 15, 6, 'W');
    rect(13, 4, 17, 4, 'W');
  },
  // Flashback: an old sepia photo of a figure, corner curling.
  flashback: ({ rect, disc, px }) => {
    rect(2, 1, 17, 18, 'h');
    rect(4, 3, 15, 13, 'O');
    disc(C, 7, 2.6, 'n');
    disc(C, 15.5, 5, 'n', (x, y) => y >= 10 && y <= 13);
    rect(4, 3, 15, 3, 'd');
    px(17, 18, null);
    px(16, 18, null);
    px(17, 17, null);
    px(16, 17, 'd');
    px(15, 18, 'd');
  },

  rank1: rankMedal(1, 'Y', 'y', 'm'),
  rank2: rankMedal(2, 'S', 's', 'N'),
  rank3: rankMedal(3, 'e', 'E', 'E'),
  // Locked: a steel padlock.
  lock: ({ rect, disc, px }) => {
    disc(C, 8, 5, 's', (x, y) => y <= 8);
    disc(C, 8, 2.6, null, (x, y) => y <= 8);
    rect(5, 8, 6, 9, 's');
    rect(13, 8, 14, 9, 's');
    rect(3, 9, 16, 18, 'S');
    rect(13, 9, 16, 18, 's');
    rect(3, 9, 16, 9, 'W');
    bmp(px, 8, 11, ['.XX.', 'XXXX', 'XXXX', '.XX.', '.XX.', '.XX.'], 'N');
  },
  // Trade notification: rising candlesticks.
  trade: ({ rect }) => {
    for (const [x, a, b, w0, w1, c] of [
      [2, 11, 15, 9, 17, 'R'],
      [6, 9, 13, 7, 15, 'g'],
      [10, 6, 10, 4, 12, 'g'],
      [14, 2, 7, 1, 9, 'g'],
    ]) {
      rect(x + 1, w0, x + 1, w1, c === 'R' ? 'r' : 'G');
      rect(x, a, x + 2, b, c);
    }
  },
  // Announcement: a megaphone.
  announce: ({ rect, px }) => {
    for (let x = 6; x <= 15; x++) {
      const h = Math.floor((x - 6) * 0.7);
      rect(x, 8 - h, x, 11 + h, x >= 14 ? 'y' : 'Y');
    }
    rect(2, 7, 5, 12, 'R');
    rect(2, 11, 5, 12, 'r');
    rect(4, 13, 6, 17, 's');
    for (const [x, y] of [
      [17, 4],
      [18, 3],
      [17, 9],
      [18, 9],
      [17, 10],
      [18, 10],
      [17, 15],
      [18, 16],
    ])
      px(x, y, 'W');
  },
  // Margin warning: a yellow warning sign.
  warning: ({ rect }) => {
    for (let y = 2; y <= 17; y++) {
      const h = Math.floor((y - 2) / 2);
      rect(C - 1 - h, y, C + h, y, 'Y');
    }
    rect(2, 17, 17, 17, 'y');
    rect(9, 6, 10, 12, 'x');
    rect(9, 14, 10, 15, 'x');
  },
  // Dividend: a money bag with a bold green dollar sign.
  dividend: ({ disc, rect, px }) => {
    disc(C, 12.5, 7, (x, y) => (x + y > 27 ? 'n' : 'O'));
    rect(8, 3, 11, 6, 'O');
    rect(8, 5, 11, 5, 'n');
    rect(6, 1, 8, 2, 'O');
    rect(11, 1, 13, 2, 'O');
    bmp(px, 7, 9, ['..XX..', '.XXXXX', 'X.XX..', '.XXXX.', '..XX.X', 'XXXXX.', '..XX..'], 'G');
  },
  // Loyalty: a calendar of days held, a gold star on the last one.
  loyalty: ({ rect, px }) => {
    rect(2, 3, 17, 18, 'W');
    rect(2, 3, 17, 6, 'R');
    rect(5, 1, 6, 4, 's');
    rect(13, 1, 14, 4, 's');
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 4; c++) {
        const x = 4 + c * 3;
        const y = 8 + r * 3;
        rect(x, y, x + 1, y + 1, r === 2 && c === 3 ? 'W' : 'g');
      }
    bmp(px, 12, 13, ['..X..', '.XXX.', 'XXXXX', '.X.X.'], 'Y');
  },
  // Cash grant: a stack of bills.
  cash: ({ rect, disc, px }) => {
    rect(4, 3, 18, 12, 'u');
    rect(1, 6, 16, 15, 'W');
    rect(2, 7, 15, 14, 'G');
    rect(3, 8, 14, 13, 'g');
    disc(8.5, 10.5, 3.4, 'G');
    bmp(px, 7, 7, ['.X.', 'XXX', 'X..', 'XXX', '..X', 'XXX', '.X.'], 'W');
    px(4, 9, 'G');
    px(13, 12, 'G');
  },
  // Margin danger zone: a red alert circle.
  danger: ({ disc, rect }) => {
    disc(C, C, 8.6, (x, y) => (x + y > 21 ? 'r' : 'R'));
    rect(9, 4, 10, 11, 'W');
    rect(9, 13, 10, 15, 'W');
  },
  // Margin call: a flashing siren.
  margincall: ({ rect, disc, px }) => {
    disc(
      C,
      13,
      6,
      (x, y) => (x + y > 23 ? 'r' : 'R'),
      (x, y) => y <= 13,
    );
    rect(13, 9, 15, 13, 'r');
    rect(2, 14, 17, 17, 's');
    rect(2, 14, 17, 14, 'S');
    rect(7, 9, 8, 11, 'q');
    for (const [x, y] of [
      [1, 4],
      [2, 5],
      [18, 4],
      [17, 5],
    ])
      px(x, y, 'Y');
    rect(9, 1, 10, 3, 'Y');
  },
  // Pop-ups: error and success.
  error: ({ rect }) => {
    rect(2, 2, 17, 17, 'R');
    rect(2, 17, 17, 17, 'r');
    rect(17, 2, 17, 17, 'r');
    for (let i = 0; i < 9; i++) {
      rect(5 + i, 5 + i, 6 + i, 5 + i, 'W');
      rect(13 - i, 5 + i, 14 - i, 5 + i, 'W');
    }
  },
  success: ({ rect }) => {
    rect(2, 2, 17, 17, 'g');
    rect(2, 17, 17, 17, 'G');
    rect(17, 2, 17, 17, 'G');
    for (const [x, y] of [
      [5, 9],
      [6, 10],
      [7, 11],
      [8, 12],
      [9, 11],
      [10, 10],
      [11, 9],
      [12, 8],
      [13, 7],
      [14, 6],
    ])
      rect(x, y, x, y + 1, 'W');
  },
  // Mission reroll: a die inside two circling arrows.
  reroll: ({ rect, px }) => {
    rect(5, 5, 14, 14, 'W');
    rect(5, 14, 14, 14, 'S');
    rect(14, 5, 14, 14, 'S');
    for (const v of [6, 9, 12]) rect(v, v, v + 1, v + 1, 'R');
    // The second arrow is an exact half-turn of the first.
    const both = (x, y) => {
      px(x, y, 'B');
      px(19 - x, 19 - y, 'B');
    };
    for (let x = 2; x <= 11; x++) both(x, 2);
    for (let y = 2; y <= 12; y++) both(2, y);
    for (const [x, y] of [
      [12, 1],
      [12, 2],
      [13, 2],
      [12, 3],
    ])
      both(x, y);
  },
  // Change name: a pencil.
  pencil: ({ px }) => {
    for (let i = 0; i < 11; i++) {
      const x = 4 + i;
      const y = 15 - i;
      px(x, y, 'Y');
      px(x + 1, y, 'y');
      px(x, y - 1, 'h');
      px(x + 1, y - 1, 'Y');
    }
    for (const [x, y, c] of [
      [15, 4, 'S'],
      [16, 4, 's'],
      [15, 3, 'S'],
      [16, 3, 'S'],
      [16, 2, 'q'],
      [17, 2, 'Q'],
      [17, 3, 'Q'],
      [17, 1, 'q'],
    ])
      px(x, y, c);
    px(3, 16, 'O');
    px(4, 16, 'O');
    px(3, 15, 'O');
    px(2, 17, 'D');
  },
  // Waiting on a result: an hourglass with sand running down.
  hourglass: ({ rect, px }) => {
    const w = (y) => Math.max(1, Math.round(Math.abs(y - 9.5) * 0.85));
    rect(3, 1, 16, 2, 'n');
    rect(3, 17, 16, 18, 'n');
    for (let y = 3; y <= 16; y++) rect(C - w(y), y, C - 1 + w(y), y, 'z');
    for (let y = 5; y <= 8; y++) if (w(y) > 1) rect(C - w(y) + 1, y, C - 2 + w(y), y, 'Y');
    rect(9, 9, 10, 13, 'Y');
    for (let y = 14; y <= 16; y++) rect(C - w(y) + 1, y, C - 2 + w(y), y, 'Y');
    px(6, 4, 'W');
  },
  // About window tabs: an open book, a "?" bubble, a shield with a keyhole.
  book: ({ rect, px }) => {
    rect(1, 4, 18, 17, 'b');
    rect(2, 3, 9, 15, 'W');
    rect(10, 3, 17, 15, 'W');
    rect(9, 3, 10, 16, 'S');
    for (const y of [6, 8, 10, 12]) {
      rect(3, y, 7, y, 's');
      rect(12, y, 16, y, 's');
    }
    px(9, 16, 'b');
    px(10, 16, 'b');
  },
  faq: ({ rect, px }) => {
    rect(1, 2, 18, 14, 'B');
    rect(1, 13, 18, 14, 'b');
    for (const [x, y] of [
      [1, 2],
      [18, 2],
      [1, 14],
      [18, 14],
    ])
      px(x, y, null);
    rect(4, 15, 6, 15, 'b');
    rect(4, 16, 5, 16, 'b');
    px(4, 17, 'b');
    bmp(px, 7, 4, ['.XXXX.', 'XX..XX', '....XX', '...XX.', '..XX..', '......', '..XX..'], 'W');
  },
  privacy: ({ rect, px }) => {
    for (let y = 1; y <= 18; y++) {
      const w = y < 11 ? 8 : 8 - Math.round((y - 10) * 1.05);
      if (w > 0) rect(C - w, y, C - 1 + w, y, y < 2 ? 'S' : 'G');
      if (w > 1 && y > 1) rect(C - w + 1, y, C - 2 + w, y, 'g');
    }
    rect(10, 2, 17, 11, 'G');
    bmp(px, 8, 5, ['.XX.', 'XXXX', 'XXXX', '.XX.', '.XX.', '.XX.'], 'N');
  },
  // Market halt: an orange pause button.
  pause: ({ rect, px }) => {
    rect(2, 2, 17, 17, 'y');
    rect(2, 2, 17, 15, 'Y');
    for (const [x, y] of [
      [2, 2],
      [17, 2],
      [2, 17],
      [17, 17],
    ])
      px(x, y, null);
    rect(6, 5, 8, 14, 'W');
    rect(11, 5, 13, 14, 'W');
  },
  // Launch time (tutorial finale, IPO coming soon): a red-nosed rocket.
  rocket: ({ rect, disc, px }) => {
    for (let y = 1; y <= 13; y++) {
      const w = y < 5 ? Math.round((y - 0.5) * 0.9) : 3;
      rect(C - w, y, C - 1 + w, y, y < 4 ? 'R' : 'W');
    }
    rect(10, 5, 12, 13, 'S');
    disc(C, 8, 1.6, 'B');
    px(9, 7, 'c');
    rect(4, 10, 6, 14, 'R');
    rect(13, 10, 15, 14, 'r');
    rect(5, 9, 6, 9, 'R');
    rect(13, 9, 14, 9, 'r');
    rect(8, 14, 11, 14, 's');
    rect(8, 15, 11, 16, 'Y');
    rect(9, 17, 10, 18, 'y');
  },
  // IPO sold out: a red no-sign.
  sold_out: ({ disc, line }) => {
    disc(C, C, 8.6, 'R');
    disc(C, C, 6.4, null);
    for (const o of [0, 1]) {
      line(5 + o, 5, 15, 15 - o, 'R');
      line(5, 5 + o, 15 - o, 15, 'R');
    }
  },
};
for (const [name, draw] of Object.entries(icons)) fs.writeFileSync(path.join(out, name + '.svg'), sprite(draw, UI_PAL));
console.log('wrote', Object.keys(icons).length);
