import type { Tone } from './components/AnswerLine';

/** What the bet slip has open: one answer on one question. */
export interface SlipPick {
  kind: Tone;
  id: string;
  option: string;
  /** Futures only: open on Sell instead of Buy. */
  sell?: boolean;
}

export const samePick = (a: SlipPick | null, kind: Tone, id: string, option: string) =>
  !!a && a.kind === kind && a.id === id && a.option === option;
