// The market as a list instead of cards. Phones get compact rows (about ten
// stocks a screen) that open the stock page; bigger screens get a table with
// sortable columns, the player's own position, and buy/sell buttons.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SimpleLineChart from '../../../shared/components/charts/SimpleLineChart';
import TradeLauncher from '../../trading/components/TradeLauncher';
import { useSession, useMarket } from '../../../context/AppContext';
import { themeClasses } from '../../../utils/theme';
import { formatCurrency, formatChange } from '../../../utils/formatters';
import { formatShares } from '../../../utils/tradeLimits';
import { priceAt } from '../../../utils/marketStats';
import { getMarketClosedState } from '../../../utils/marketHours';
import { InlineHoldingLabel, useHoldingMark } from '../../../shared/components/cosmetics/HoldingMark';
import { positionOf } from '../../../utils/holdingMarks';
import { useLongPress } from '../hooks/useLongPress';
import type { Character } from '../../../characters';
import type { PricePoint, TradeAction } from '../../../types';

const DAY = 86_400_000;

interface MarketListProps {
  characters: Character[];
  onTrade: (ticker: string, action: TradeAction, amount: number) => unknown;
  onViewChart: (character: Character, timeRange: string) => void;
  onQuickActions?: (character: Character) => void;
  /** The stock open in the desktop stock window. */
  selectedTicker?: string;
  sortBy: string;
  setSortBy: (sort: string) => void;
}

/** Price now, 24h and 7d change, and the 7-day line, from local history. */
export const rowStats = (history: PricePoint[] = [], price: number) => {
  const now = Date.now();
  const open24 = priceAt(history, now - DAY, price);
  const open7 = priceAt(history, now - 7 * DAY, price);
  const week = history.filter((p) => p.timestamp >= now - 7 * DAY);
  return {
    change24: open24 > 0 ? ((price - open24) / open24) * 100 : 0,
    change7: open7 > 0 ? ((price - open7) / open7) * 100 : 0,
    line: [{ price: open7 }, ...week, { price }],
  };
};

// Column header that sorts. Clicking again flips the direction where it has one.
const SortHeader = ({
  label,
  sorts,
  sortBy,
  setSortBy,
  className = '',
}: {
  label: string;
  sorts: [string, string?];
  sortBy: string;
  setSortBy: (s: string) => void;
  className?: string;
}) => {
  const [first, second] = sorts;
  const active = sortBy === first || sortBy === second;
  const next = sortBy === first && second ? second : first;
  return (
    <th className={`px-3 py-2 font-semibold ${className}`}>
      <button
        type="button"
        onClick={() => setSortBy(next)}
        className={`uppercase text-[11px] tracking-wide ${active ? 'text-orange-500' : 'hover:text-orange-500'}`}
      >
        {label}
        {active && (sortBy === second ? ' ▲' : ' ▼')}
      </button>
    </th>
  );
};

const PhoneRow = ({ character, onOpen, onHold }: { character: Character; onOpen: () => void; onHold?: () => void }) => {
  const { userData, getColorBlindColors } = useSession();
  const { prices, priceHistory } = useMarket();
  const { textClass, mutedClass } = themeClasses;
  const press = useLongPress(onOpen, onHold);
  const price = priceHistory[character.ticker]?.at(-1)?.price ?? (prices[character.ticker] || character.basePrice);
  const { change24, line } = rowStats(priceHistory[character.ticker], price);
  const mark = useHoldingMark();
  const pos = positionOf(userData, character.ticker, price);
  return (
    <li data-tour="card">
      <button
        type="button"
        {...press}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left select-none active:bg-orange-500/10"
      >
        <div className="min-w-0 flex-1">
          <div className="text-orange-500 font-mono text-sm font-semibold">${character.ticker}</div>
          <div className={`text-xs truncate ${mutedClass}`}>
            {character.name}
            {pos?.kind === 'long' && <InlineHoldingLabel mark={mark} pos={pos} className="ml-1.5" />}
          </div>
        </div>
        <div className="w-16 shrink-0">
          <SimpleLineChart data={line} colorBlindMode={userData?.colorBlindMode} className="!h-7" />
        </div>
        <div className="w-24 shrink-0 text-right">
          <div className={`text-sm font-semibold ${textClass}`}>{formatCurrency(price)}</div>
          <div className={`text-xs font-mono ${getColorBlindColors(change24 >= 0).text}`}>{formatChange(change24)}</div>
        </div>
      </button>
    </li>
  );
};

const MarketList = ({
  characters,
  onTrade,
  onViewChart,
  onQuickActions,
  selectedTicker,
  sortBy,
  setSortBy,
}: MarketListProps) => {
  const navigate = useNavigate();
  const { user, userData, getColorBlindColors } = useSession();
  const mark = useHoldingMark();
  const { prices, priceHistory, marketData } = useMarket();
  const { cardClass, textClass, mutedClass } = themeClasses;
  const [trade, setTrade] = useState<{ character: Character; action: TradeAction } | null>(null);
  const closed = getMarketClosedState(marketData).closed;
  const sortProps = { sortBy, setSortBy };

  return (
    <>
      {/* Phones */}
      <ul className={`md:hidden ${cardClass} border rounded-sm divide-y light:divide-amber-100 dark:divide-zinc-800`}>
        {characters.map((c) => (
          <PhoneRow
            key={c.ticker}
            character={c}
            onOpen={() => navigate(`/stock/${c.ticker}`)}
            onHold={onQuickActions ? () => onQuickActions(c) : undefined}
          />
        ))}
      </ul>

      {/* Tablets and desktops */}
      <div className={`hidden md:block ${cardClass} border rounded-sm overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className={`text-left ${mutedClass} border-b light:border-amber-200 dark:border-zinc-800`}>
            <tr>
              <SortHeader label="Stock" sorts={['ticker']} {...sortProps} />
              <SortHeader label="Price" sorts={['price-high', 'price-low']} className="text-right" {...sortProps} />
              <SortHeader label="24h" sorts={['change-high', 'change-low']} className="text-right" {...sortProps} />
              <th className="px-3 py-2 text-right uppercase text-[11px] tracking-wide font-semibold">7d</th>
              <th className="px-3 py-2 w-32 uppercase text-[11px] tracking-wide font-semibold">Week</th>
              {user && <th className="px-3 py-2 text-right uppercase text-[11px] tracking-wide font-semibold">You</th>}
              {user && <th className="px-3 py-2 w-36" />}
            </tr>
          </thead>
          <tbody>
            {characters.map((c) => {
              const price = priceHistory[c.ticker]?.at(-1)?.price ?? (prices[c.ticker] || c.basePrice);
              const { change24, change7, line } = rowStats(priceHistory[c.ticker], price);
              const held = userData?.holdings?.[c.ticker] || 0;
              const short = userData?.shorts?.[c.ticker]?.shares || 0;
              const cost = userData?.costBasis?.[c.ticker] || 0;
              const pl = held > 0 && cost > 0 ? (price - cost) * held : null;
              const heldPos = positionOf(userData, c.ticker, price);
              const halted = Date.now() < (marketData?.haltedTickers?.[c.ticker]?.resumeAt ?? 0);
              const canTrade = !closed && !halted;
              return (
                <tr
                  key={c.ticker}
                  data-tour="card"
                  onClick={() => onViewChart(c, '7d')}
                  aria-selected={c.ticker === selectedTicker}
                  className="cursor-pointer aria-selected:bg-orange-500/10 border-b last:border-0 light:border-amber-100 dark:border-zinc-800/70 light:hover:bg-amber-50 dark:hover:bg-zinc-800/50"
                >
                  <td className="px-3 py-2">
                    <span className="text-orange-500 font-mono font-semibold">${c.ticker}</span>
                    <span className={`ml-2 text-xs ${mutedClass}`}>{c.name}</span>
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold ${textClass}`}>{formatCurrency(price)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${getColorBlindColors(change24 >= 0).text}`}>
                    {formatChange(change24)}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${getColorBlindColors(change7 >= 0).text}`}>
                    {formatChange(change7)}
                  </td>
                  <td className="px-3 py-1">
                    <SimpleLineChart data={line} colorBlindMode={userData?.colorBlindMode} className="!h-7" />
                  </td>
                  {user && (
                    <td className="px-3 py-2 text-right text-xs whitespace-nowrap">
                      {held > 0.001 && heldPos && (
                        <div>
                          <InlineHoldingLabel mark={mark} pos={heldPos} />
                        </div>
                      )}
                      {pl !== null && (
                        <div className={getColorBlindColors(pl >= 0).text}>
                          {pl >= 0 ? '+' : ''}
                          {formatCurrency(pl)}
                        </div>
                      )}
                      {short > 0 && <div className="text-orange-500 font-semibold">{formatShares(short)} short</div>}
                      {held <= 0.001 && short <= 0 && <span className={mutedClass}>-</span>}
                    </td>
                  )}
                  {user && (
                    <td className="px-3 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        disabled={!canTrade}
                        onClick={() => setTrade({ character: c, action: 'buy' })}
                        className={`px-2.5 py-1 text-xs font-semibold uppercase rounded-sm text-white disabled:opacity-40 ${getColorBlindColors(true).bg}`}
                      >
                        Buy
                      </button>
                      <button
                        type="button"
                        disabled={!canTrade || held <= 0}
                        onClick={() => setTrade({ character: c, action: 'sell' })}
                        className={`ml-1.5 px-2.5 py-1 text-xs font-semibold uppercase rounded-sm text-white disabled:opacity-40 ${getColorBlindColors(false).bg}`}
                      >
                        Sell
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {trade && (
        <TradeLauncher
          character={trade.character}
          action={trade.action}
          onTrade={onTrade}
          onClose={() => setTrade(null)}
        />
      )}
    </>
  );
};

export default MarketList;
