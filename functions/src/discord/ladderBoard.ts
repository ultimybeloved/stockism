// The Discord ladder board: a grid of emoji tiles (scripts/pixel-ladder.cjs,
// uploaded by scripts/sync-ladder-emojis.cjs) and the frames that light the
// path down it. Pure: no Discord or Firestore calls, so it is unit tested.
//
// Four tiles wide: left pole, two rung tiles, right pole. The empty board is
// sized for a 2-rung game (rungs on pole rows 2 and 4) and grows to 7 pole rows
// (rungs on 2, 4 and 6) when the game turns out to have 3. Rungs stay hidden
// until the bet. The path is blue when it lands on ODD and red on EVEN, the
// same colors as the ladder on the site.
import { LADDER_EMOJIS, type LadderTile } from '../shared/constants/ladderEmojis';

export type Side = 'left' | 'right';
export type Grid = LadderTile[][];

const RUNG_ROWS: Record<number, number[]> = { 2: [2, 4], 3: [2, 4, 6] };
const POLE_ROWS: Record<number, number> = { 2: 5, 3: 7 };

const col = (side: Side) => (side === 'left' ? 0 : 3);
const other = (side: Side): Side => (side === 'left' ? 'right' : 'left');

const board = (rungCount: number, revealed: boolean): Grid => {
  const rungs = RUNG_ROWS[rungCount]!;
  const g: Grid = [['x', 'blank', 'blank', 'x']];
  for (let r = 1; r <= POLE_ROWS[rungCount]!; r++)
    g.push(revealed && rungs.includes(r) ? ['jl', 'rung', 'rung', 'jr'] : ['pole', 'blank', 'blank', 'pole']);
  g.push(['odd_a', 'odd_b', 'even_a', 'even_b']);
  return g;
};

/** The empty board before the bet, with the picked X ringed if there is one. */
export const idleBoard = (picked?: Side): Grid => {
  const g = board(2, false);
  if (picked) g[0]![col(picked)] = 'x_sel';
  return g;
};

/** Which side a game ends on. An odd number of rungs crosses over. */
export const landsOn = (start: Side, rungCount: number): 'odd' | 'even' => {
  const end = rungCount % 2 === 1 ? other(start) : start;
  return end === 'left' ? 'odd' : 'even';
};

/**
 * The boards shown after the bet, one per message edit: rungs appear and the X
 * lights, then each edit runs the path down a pole section and across the next
 * rung, and the last one lands on the label.
 */
export const playFrames = (start: Side, rungCount: number): Grid[] => {
  const rungs = RUNG_ROWS[rungCount];
  if (!rungs) throw new Error(`No ladder layout for ${rungCount} rungs`);
  const result = landsOn(start, rungCount);
  const k = result === 'odd' ? 'b' : 'r';
  const rows = POLE_ROWS[rungCount]!;
  const g = board(rungCount, true);
  const copy = () => g.map((row) => [...row]);
  const frames: Grid[] = [];

  g[0]![col(start)] = `x_${k}`;
  frames.push(copy());
  let side = start;
  let r = 1;
  while (r <= rows) {
    while (r <= rows && !rungs.includes(r)) g[r++]![col(side)] = `pole_${k}`;
    if (r > rows) break;
    const to = other(side);
    const [from, into] = side === 'left' ? (['jl', 'jr'] as const) : (['jr', 'jl'] as const);
    g[r]![col(side)] = `${from}_in_${k}`;
    g[r]![1] = g[r]![2] = `rung_${k}`;
    g[r]![col(to)] = `${into}_out_${k}`;
    side = to;
    r++;
    frames.push(copy());
  }
  const [a, b] = side === 'left' ? [0, 1] : [2, 3];
  g[rows + 1]![a] = `${result}_lit_a`;
  g[rows + 1]![b] = `${result}_lit_b`;
  frames.push(copy());
  return frames;
};

/** A grid as emoji markup, one line per row. */
export const renderBoard = (g: Grid) => g.map((row) => row.map((t) => LADDER_EMOJIS[t]).join('')).join('\n');
