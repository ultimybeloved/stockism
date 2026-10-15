import { useEffect, useRef, useState } from 'react';
import { useSession } from '../../../context/AppContext';
import { useWideScreen } from '../../../shared/hooks/useMediaQuery';
import { useShortcuts } from '../../../shared/hooks/useShortcuts';
import { COMPARE_MAX } from '../components/CompareChartModal';
import type { Character } from '../../../characters';
import type { TradeAction } from '../../../types';

export const MARKET_SEARCH_ID = 'market-search';

// The home page's wide-screen extras: clicking a stock opens the big stock window
// (chart, position and trade buttons) instead of the plain chart window, shift-click collects stocks for a comparison, and
// the market keyboard shortcuts (/ to search, arrows to step through stocks,
// B / S to trade the open one, C to add it to the comparison). Phones and
// tablets keep the chart window.
export function useDesktopMarket({
  characters,
  onViewChart,
}: {
  characters: Character[];
  onViewChart: (character: Character, timeRange: string) => void;
}) {
  const wide = useWideScreen();
  const { user, userData } = useSession();
  const [panel, setPanel] = useState<Character | null>(null);
  const [pendingAction, setPendingAction] = useState<TradeAction | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const shiftDown = useRef(false);

  // Whether the click that is about to arrive was a shift-click.
  useEffect(() => {
    const note = (e: PointerEvent) => {
      shiftDown.current = e.shiftKey;
    };
    document.addEventListener('pointerdown', note, true);
    return () => document.removeEventListener('pointerdown', note, true);
  }, []);

  // Only wide screens get the big window.
  const shown = wide ? panel : null;

  const toggleCompare = (ticker: string) =>
    setCompare((c) =>
      c.includes(ticker) ? c.filter((t) => t !== ticker) : c.length >= COMPARE_MAX ? c : [...c, ticker],
    );

  const openStock = (character: Character, timeRange: string) => {
    if (wide && shiftDown.current) {
      shiftDown.current = false;
      toggleCompare(character.ticker);
      return;
    }
    if (wide) {
      setPanel(character);
      return;
    }
    onViewChart(character, timeRange);
  };

  const step = (delta: 1 | -1) => {
    if (characters.length === 0) return;
    const i = characters.findIndex((c) => c.ticker === panel?.ticker);
    const next =
      i === -1 ? (delta === 1 ? 0 : characters.length - 1) : (i + delta + characters.length) % characters.length;
    setPanel(characters[next]!);
  };

  const canTrade = (action: TradeAction) =>
    !!user && !!shown && (action !== 'sell' || (userData?.holdings?.[shown.ticker] || 0) > 0);

  useShortcuts(
    {
      '/': () => !shown && document.getElementById(MARKET_SEARCH_ID)?.focus(),
      arrowright: () => step(1),
      arrowleft: () => step(-1),
      b: () => canTrade('buy') && setPendingAction('buy'),
      s: () => canTrade('sell') && setPendingAction('sell'),
      c: () => shown && toggleCompare(shown.ticker),
    },
    wide,
  );

  return {
    wide,
    panelCharacter: shown,
    closePanel: () => setPanel(null),
    step,
    openStock,
    pendingAction,
    clearPendingAction: () => setPendingAction(null),
    compare,
    toggleCompare,
    clearCompare: () => setCompare([]),
    comparing: comparing && compare.length >= 2,
    setComparing,
  };
}
