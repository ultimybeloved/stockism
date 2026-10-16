// Draws the pixel-art (20x20) tiles for the Discord ladder board into
// public/pins/ladder/. Original artwork. Run: node scripts/pixel-ladder.cjs
//
// The board is a 4-wide grid of emojis: left pole, two rung columns, right
// pole, so the rungs are as long as on the site.
// Every piece the path can light has a blue version (lands on ODD) and a red
// version (lands on EVEN), the same colors as the ladder on the site. Tiles are
// drawn edge to edge with no outline so neighboring emojis join up.
//
// Junctions are where a rung meets a pole. The path either comes DOWN the pole
// and turns onto the rung ("in"), or comes ACROSS the rung and carries on down
// ("out"), so each junction has those two lit states.
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, '..', 'public', 'pins', 'ladder');
fs.mkdirSync(out, { recursive: true });

const N = 20;
const COLORS = {
  grey: { body: '#b4ac99', edge: '#8a8270' },
  b: { body: '#2286f6', edge: '#155bb0' },
  r: { body: '#f22431', edge: '#a8121c' },
};
const INK = '#3b3624';
const SEL = { body: '#c9bfa6', edge: '#f97316' };

// Pole runs down x 7..12, rung across y 7..12. Edges are a shade darker.
const P0 = 7;
const P1 = 12;

const tile = (draw) => {
  const g = Array.from({ length: N }, () => Array(N).fill(null));
  const px = (x, y, c) => {
    if (x >= 0 && y >= 0 && x < N && y < N) g[y][x] = c;
  };
  draw(px);
  return g;
};
const vbar = (px, y0, y1, c) => {
  for (let y = y0; y <= y1; y++) for (let x = P0; x <= P1; x++) px(x, y, x === P0 || x === P1 ? c.edge : c.body);
};
const hbar = (px, x0, x1, c) => {
  for (let x = x0; x <= x1; x++) for (let y = P0; y <= P1; y++) px(x, y, y === P0 || y === P1 ? c.edge : c.body);
};

// A bold 6x10 font, just the letters ODD and EVEN need.
const FONT = {
  O: ['.XXXX.', 'XXXXXX', 'XX..XX', 'XX..XX', 'XX..XX', 'XX..XX', 'XX..XX', 'XX..XX', 'XXXXXX', '.XXXX.'],
  D: ['XXXXX.', 'XXXXXX', 'XX..XX', 'XX..XX', 'XX..XX', 'XX..XX', 'XX..XX', 'XX..XX', 'XXXXXX', 'XXXXX.'],
  E: ['XXXXXX', 'XXXXXX', 'XX....', 'XX....', 'XXXXX.', 'XXXXX.', 'XX....', 'XX....', 'XXXXXX', 'XXXXXX'],
  V: ['XX..XX', 'XX..XX', 'XX..XX', 'XX..XX', 'XX..XX', 'XX..XX', '.XXXX.', '.XXXX.', '..XX..', '..XX..'],
  N: ['XX..XX', 'XXX.XX', 'XXX.XX', 'XXXXXX', 'XXXXXX', 'XX.XXX', 'XX.XXX', 'XX..XX', 'XX..XX', 'XX..XX'],
};

const tiles = {};
for (const [k, c] of Object.entries(COLORS)) {
  const sfx = k === 'grey' ? '' : `_${k}`;
  tiles[`pole${sfx}`] = tile((px) => vbar(px, 0, N - 1, c));
  tiles[`rung${sfx}`] = tile((px) => hbar(px, 0, N - 1, c));
}

// Junctions. Grey first, then each lit state over a grey base.
const junction = (side, lit, state) =>
  tile((px) => {
    const g = COLORS.grey;
    const [r0, r1] = side === 'l' ? [P1 + 1, N - 1] : [0, P0 - 1];
    vbar(px, 0, N - 1, g);
    hbar(px, r0, r1, g);
    if (!lit) return;
    if (state === 'in') vbar(px, 0, P1, lit);
    else vbar(px, P0, N - 1, lit);
    hbar(px, r0, r1, lit);
    // The corner where the bar turns: repaint so the lit path reads as one bend.
    for (let y = P0; y <= P1; y++) for (let x = P0; x <= P1; x++) px(x, y, lit.body);
  });
for (const side of ['l', 'r']) {
  tiles[`j${side}`] = junction(side, null);
  for (const k of ['b', 'r'])
    for (const state of ['in', 'out']) tiles[`j${side}_${state}_${k}`] = junction(side, COLORS[k], state);
}

// The two start circles, with a stub of pole underneath so the X joins its pole.
const startX = (c, stub) =>
  tile((px) => {
    vbar(px, 15, N - 1, stub);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < N; x++) {
        const d = (x + 0.5 - 10) ** 2 + (y + 0.5 - 8) ** 2;
        if (d <= 7.6 ** 2) px(x, y, d >= (c === SEL ? 5.6 : 6.4) ** 2 ? c.edge : c.body);
      }
    const ink = c === COLORS.grey || c === SEL ? INK : '#ffffff';
    for (let i = 0; i < 7; i++) {
      px(7 + i, 5 + i, ink);
      px(13 - i, 5 + i, ink);
    }
  });
tiles.x = startX(COLORS.grey, COLORS.grey);
tiles.x_sel = startX(SEL, COLORS.grey);
tiles.x_b = startX(COLORS.b, COLORS.b);
tiles.x_r = startX(COLORS.r, COLORS.r);

// ODD / EVEN plates at the foot of each pole. Each plate spans two tiles, so
// the word can be drawn in a big bold font and still be read at embed size. The
// stub joining the pole sits on the outer tile (left for ODD, right for EVEN).
const W = N * 2;
const PLATE_W = 35;
const plate = (word, c, stub, poleSide) => {
  const g = Array.from({ length: N }, () => Array(W).fill(null));
  const px = (x, y, col) => {
    if (x >= 0 && y >= 0 && x < W && y < N) g[y][x] = col;
  };
  const sx = poleSide === 'l' ? 0 : N;
  for (let y = 0; y <= 4; y++)
    for (let x = P0; x <= P1; x++) px(sx + x, y, x === P0 || x === P1 ? stub.edge : stub.body);
  // The plate is PLATE_W wide, flush with the pole's outer edge, so the ODD
  // and EVEN plates sit under their own poles with a gap between them.
  const p0 = poleSide === 'l' ? 0 : W - PLATE_W;
  const p1 = p0 + PLATE_W - 1;
  for (let y = 5; y < N - 1; y++)
    for (let x = p0; x <= p1; x++) {
      const edge = y === 5 || y === N - 2 || x === p0 || x === p1;
      if ((y === 5 || y === N - 2) && (x === p0 || x === p1)) continue; // rounded corners
      px(x, y, edge ? c.edge : c.body);
    }
  const ink = c === COLORS.grey ? INK : '#ffffff';
  let x0 = p0 + Math.ceil((PLATE_W - (word.length * 8 - 2)) / 2);
  for (const ch of word) {
    FONT[ch].forEach((row, dy) => [...row].forEach((on, dx) => on === 'X' && px(x0 + dx, 7 + dy, ink)));
    x0 += 8;
  }
  // Split into the two emoji tiles.
  return [g.map((row) => row.slice(0, N)), g.map((row) => row.slice(N))];
};
for (const [name, word, poleSide, lit] of [
  ['odd', 'ODD', 'l', COLORS.b],
  ['even', 'EVEN', 'r', COLORS.r],
]) {
  for (const [sfx, c] of [
    ['', COLORS.grey],
    ['_lit', lit],
  ]) {
    const [a, b] = plate(word, c, c, poleSide);
    tiles[`${name}${sfx}_a`] = a;
    tiles[`${name}${sfx}_b`] = b;
  }
}

tiles.blank = tile(() => {});

for (const [name, g] of Object.entries(tiles)) {
  const rects = [];
  g.forEach((row, y) =>
    row.forEach((c, x) => c && rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`)),
  );
  fs.writeFileSync(
    path.join(out, `${name}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges">${rects.join('')}</svg>\n`,
  );
}
console.log(`wrote ${Object.keys(tiles).length} tiles to ${path.relative(process.cwd(), out)}`);
