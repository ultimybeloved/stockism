// Sell several stocks in one go: pick a rarity or a crew to select all of
// those holdings, then tick or untick any single stock. Each stock is sold
// whole (minus any locked shares) through the normal sell, one after another.
import { useState } from 'react';
import SheetHandle from '../../../shared/components/SheetHandle';
import PixelIcon from '../../../shared/components/PixelIcon';
import CrewPin from '../../../shared/components/CrewPin';
import { useSheetRef } from '../../../shared/hooks/useSwipeToClose';
import { useEscapeKey } from '../../../shared/hooks/useEscapeKey';
import { useSession, useMarket } from '../../../context/AppContext';
import { themeClasses } from '../../../utils/theme';
import { formatCurrency } from '../../../utils/formatters';
import { getMarketClosedState } from '../../../utils/marketHours';
import { CREWS } from '../../../crews';
import { DIVIDEND_TIER_META, formatShares } from '../utils/shared';
import { useGroupSell } from '../hooks/useGroupSell';
import type { PortfolioItem } from '../utils/buildPositionItems';

const TIER_ORDER = ['legendary', 'epic', 'rare', 'uncommon', 'common', 'etf'];

interface GroupSellSheetProps {
  items: PortfolioItem[];
  onClose: () => void;
}

const GroupSellSheet = ({ items, onClose }: GroupSellSheetProps) => {
  const { userData } = useSession();
  const { marketData } = useMarket();
  const { run, stop, running, results } = useGroupSell();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  // The stocks being sold, fixed when the sale starts: each one leaves the
  // portfolio as it sells, but stays on this list with its result.
  const [batch, setBatch] = useState<{ ticker: string; shares: number }[] | null>(null);
  // Closing mid-sale stops the rest; what already sold stays sold.
  const close = () => {
    stop();
    onClose();
  };
  const sheetRef = useSheetRef(close);
  useEscapeKey(close);
  const { sheetOverlayClass, sheetShellClass, textClass, mutedClass, chipClass, ghostBtnClass, borderClass } =
    themeClasses;

  const closed = getMarketClosedState(marketData).closed;
  const now = Date.now();

  // What can be sold of each holding right now: locked shares stay behind.
  const lock = (l?: { shares?: number; until?: number }) => (l && now < (l.until || 0) ? l.shares || 0 : 0);
  const rows = items.map((item) => {
    const locked = lock(userData?.ipoLockup?.[item.ticker]) + lock(userData?.marginLockup?.[item.ticker]);
    const sellable = Math.max(0, item.shares - locked);
    const paused = now < (marketData?.haltedTickers?.[item.ticker]?.resumeAt ?? 0);
    return { item, locked, sellable, paused, value: sellable * item.currentPrice };
  });
  const sellableRows = rows.filter((r) => r.sellable > 0 && !r.paused);

  const tiers = TIER_ORDER.filter((t) => sellableRows.some((r) => r.item.tier === t));
  const crews = Object.values(CREWS).filter((c) => sellableRows.some((r) => c.members.includes(r.item.ticker)));
  const pickGroup = (match: (ticker: string, tier: string) => boolean) =>
    setPicked(new Set(sellableRows.filter((r) => match(r.item.ticker, r.item.tier)).map((r) => r.item.ticker)));
  const toggle = (ticker: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });

  const chosen = sellableRows.filter((r) => picked.has(r.item.ticker));
  const chosenValue = chosen.reduce((s, r) => s + r.value, 0);

  const start = () => {
    const lines = chosen.map((r) => ({ ticker: r.item.ticker, shares: r.sellable }));
    setBatch(lines);
    run(lines);
  };

  const sold = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const soldTotal = sold.reduce((s, r) => s + (r.proceeds || 0), 0);

  const chip = (key: string, label: React.ReactNode, onClick: () => void) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 text-xs font-semibold rounded-full inline-flex items-center gap-1 ${chipClass} hover:brightness-110`}
    >
      {label}
    </button>
  );

  return (
    <div className={`${sheetOverlayClass} z-50`} onClick={close}>
      <div
        ref={sheetRef}
        role="dialog"
        aria-label="Sell a group"
        className={`${sheetShellClass} p-4 md:max-w-md`}
        onClick={(e) => e.stopPropagation()}
      >
        <SheetHandle />
        <h3 className={`text-lg font-semibold mb-1 ${textClass}`}>Sell a group</h3>

        {batch ? (
          <>
            <p className={`text-sm mb-3 ${mutedClass}`}>
              {running
                ? `Selling ${Math.min(results.length + 1, batch.length)} of ${batch.length}. Keep this open, closing stops the rest.`
                : `Sold ${sold.length} of ${batch.length} for ${formatCurrency(soldTotal)}.`}
            </p>
            <ul
              className={`border rounded-sm divide-y mb-3 ${borderClass} light:divide-amber-200 dark:divide-zinc-700`}
            >
              {batch.map((line) => {
                const res = results.find((x) => x.ticker === line.ticker);
                return (
                  <li key={line.ticker} className="flex items-center gap-2 px-3 py-2 text-sm">
                    {res ? (
                      <PixelIcon name={res.ok ? 'success' : 'error'} className="w-4 h-4" />
                    ) : (
                      <PixelIcon name="hourglass" className={`w-4 h-4 ${running ? '' : 'opacity-30'}`} />
                    )}
                    <span className="font-mono text-orange-500">${line.ticker}</span>
                    <span className={`flex-1 truncate text-xs ${mutedClass}`}>{res?.error}</span>
                    {res?.ok && (
                      <span className={`tabular-nums ${textClass}`}>{formatCurrency(res.proceeds || 0)}</span>
                    )}
                  </li>
                );
              })}
            </ul>
            {running ? (
              <button
                type="button"
                onClick={stop}
                className={`w-full py-2.5 text-sm font-semibold rounded-sm border ${ghostBtnClass}`}
              >
                Stop after this one
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 text-sm font-semibold rounded-sm bg-orange-600 text-white"
              >
                Done{failed.length > 0 ? ` (${failed.length} not sold)` : ''}
              </button>
            )}
          </>
        ) : (
          <>
            <p className={`text-sm mb-3 ${mutedClass}`}>
              Pick a group, then tick or untick single stocks. Each one sells in full.
            </p>
            {closed ? (
              <p className="text-sm text-amber-500 mb-3">The market is closed, so nothing can be sold right now.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {chip('all', 'All', () => pickGroup(() => true))}
                  {tiers.map((t) =>
                    chip(t, <span className={DIVIDEND_TIER_META[t]?.color}>{DIVIDEND_TIER_META[t]?.label}</span>, () =>
                      pickGroup((_, tier) => tier === t),
                    ),
                  )}
                  {picked.size > 0 && chip('none', 'Clear', () => setPicked(new Set()))}
                </div>
                {crews.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {crews.map((c) =>
                      chip(
                        c.id,
                        <>
                          <CrewPin crew={c} className="w-3.5 h-3.5" />
                          {c.name}
                        </>,
                        () => pickGroup((ticker) => c.members.includes(ticker)),
                      ),
                    )}
                  </div>
                )}
              </>
            )}

            <ul
              className={`border rounded-sm divide-y mb-3 max-h-[40vh] overflow-y-auto ${borderClass} light:divide-amber-200 dark:divide-zinc-700`}
            >
              {rows.map((r) => {
                const disabled = closed || r.sellable <= 0 || r.paused;
                return (
                  <li key={r.item.ticker}>
                    <label
                      className={`flex items-center gap-2 px-3 py-2 text-sm ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
                    >
                      <input
                        type="checkbox"
                        checked={picked.has(r.item.ticker) && !disabled}
                        disabled={disabled}
                        onChange={() => toggle(r.item.ticker)}
                        className="accent-orange-600"
                      />
                      <span className="font-mono text-orange-500">${r.item.ticker}</span>
                      <span className={`flex-1 truncate text-xs ${mutedClass}`}>
                        {r.paused
                          ? 'Paused right now'
                          : r.sellable <= 0
                            ? 'All shares locked'
                            : `${formatShares(r.sellable)} shares${r.locked > 0 ? `, ${formatShares(r.locked)} locked` : ''}`}
                      </span>
                      <span className={`tabular-nums ${textClass}`}>{formatCurrency(r.value)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>

            {confirming ? (
              <div className="space-y-2">
                <p className={`text-sm ${textClass}`}>
                  Sell all of {chosen.length} stock{chosen.length === 1 ? '' : 's'}? Each sale moves its price down, so
                  you will get a bit less than {formatCurrency(chosenValue)}. This can't be undone.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className={`py-2.5 text-sm font-semibold rounded-sm border ${ghostBtnClass}`}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={start}
                    className="py-2.5 text-sm font-semibold rounded-sm bg-red-600 hover:bg-red-700 text-white"
                  >
                    Sell them
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={closed || chosen.length === 0}
                onClick={() => setConfirming(true)}
                className="w-full py-2.5 text-sm font-semibold rounded-sm bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-40"
              >
                {chosen.length === 0
                  ? 'Pick stocks to sell'
                  : `Sell ${chosen.length} stock${chosen.length === 1 ? '' : 's'} (about ${formatCurrency(chosenValue)})`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default GroupSellSheet;
