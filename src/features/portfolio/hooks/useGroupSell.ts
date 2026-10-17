import { useRef, useState } from 'react';
import { playSound } from '../../../utils/sounds';
import { executeTradeFunction } from '../../../api/callables';
import { errorMessage, isContentionError } from '../../../utils/errors';

// The server allows one trade every 3 seconds per player (TRADE_COOLDOWN_MS),
// so a group sell is one ordinary sell per stock, spaced just past that. Each
// goes through the normal trade path with every rule it already enforces.
const GAP_MS = 3300;

export interface GroupSellLine {
  ticker: string;
  shares: number;
}

export interface GroupSellResult {
  ticker: string;
  ok: boolean;
  proceeds?: number;
  error?: string;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useGroupSell() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<GroupSellResult[]>([]);
  const stopped = useRef(false);

  const sellOne = async ({ ticker, shares }: GroupSellLine): Promise<GroupSellResult> => {
    const call = () => executeTradeFunction({ ticker, action: 'sell', amount: shares });
    try {
      let res;
      try {
        res = await call();
      } catch (err) {
        if (!isContentionError(err)) throw err;
        await wait(500);
        res = await call();
      }
      const { totalCost, executionPrice } = res.data;
      return { ticker, ok: true, proceeds: totalCost ?? executionPrice * shares };
    } catch (err) {
      return { ticker, ok: false, error: errorMessage(err) || 'Sell failed' };
    }
  };

  const run = async (lines: GroupSellLine[]) => {
    stopped.current = false;
    setResults([]);
    setRunning(true);
    for (let i = 0; i < lines.length; i++) {
      if (stopped.current) break;
      if (i > 0) await wait(GAP_MS);
      if (stopped.current) break;
      const result = await sellOne(lines[i]!);
      playSound(result.ok ? 'sell' : 'error');
      setResults((prev) => [...prev, result]);
    }
    setRunning(false);
  };

  const stop = () => {
    stopped.current = true;
  };

  return { run, stop, running, results };
}
