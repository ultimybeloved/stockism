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
};
for (const [name, draw] of Object.entries(icons)) fs.writeFileSync(path.join(out, name + '.svg'), sprite(draw, UI_PAL));
console.log('wrote', Object.keys(icons).length);
