// Shared 20x20 pixel-art engine for the badge/crest generators. A draw
// function paints palette letters onto the grid; empty cells touching paint
// get a dark outline. Extra palette letters can be passed per sprite.
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
  n: '#8a4b2a',
  m: '#5c2e1a',
  q: '#f49ac2',
  Q: '#c8628f',
  d: '#b8860b',
  V: '#8b5cf6',
  v: '#5b2bb5',
  p: '#f5b8a0',
};
const N = 20;

function sprite(draw, extraPal = {}) {
  const pal = { ...PAL, ...extraPal };
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
      if (c) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${pal[c]}"/>`;
    }),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges">${rects}</svg>\n`;
}

module.exports = { sprite, PAL, N };
