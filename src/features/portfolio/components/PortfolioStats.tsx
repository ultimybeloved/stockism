// The portfolio's account numbers: cash, what is invested, open profit, how
// the account moved today / this week / this month, dividends, and margin.
// Desktop shows them as a grid beside the chart; phones as a row of chips you
// swipe through.
import { useSession, useMarket } from '../../../context/AppContext';
import { themeClasses } from '../../../utils/theme';
import { formatCurrency, formatChange } from '../../../utils/formatters';
import { calculateMarginStatus } from '../../../utils/calculations';
import type { PortfolioItem } from '../utils/buildPositionItems';

interface PortfolioStatsProps {
  items: PortfolioItem[];
  shortCollateral: number;
  currentValue: number;
}

type Tile = { label: string; value: string; tone?: boolean | null; sub?: string };

const PortfolioStats = ({ items, shortCollateral, currentValue }: PortfolioStatsProps) => {
  const { userData, getColorBlindColors } = useSession();
  const { prices, priceHistory } = useMarket();
  const { textClass, mutedClass } = themeClasses;

  const invested = items.reduce((s, i) => s + i.value, 0);
  const cost = items.reduce((s, i) => s + i.totalCost, 0);
  const open = invested - cost;
  const today = items.reduce((s, i) => s + i.todayReturnDollar, 0);
  const dividends = items.reduce((s, i) => s + (i.weeklyDividend || 0), 0);
  const since = (snap?: { value?: number } | null) =>
    snap?.value && snap.value > 0 ? ((currentValue - snap.value) / snap.value) * 100 : null;
  const week = since(userData?.portfolioSnapshot7d);
  const month = since(userData?.portfolioSnapshot30d);
  const margin = userData?.marginEnabled ? calculateMarginStatus(userData, prices, priceHistory) : null;
  const debt = userData?.marginUsed || 0;

  const tiles: Tile[] = [
    { label: 'Cash', value: formatCurrency(userData?.cash || 0) },
    {
      label: 'Invested',
      value: formatCurrency(invested),
      sub: `${items.length} stock${items.length === 1 ? '' : 's'}`,
    },
    {
      label: 'Open profit',
      value: `${open >= 0 ? '+' : ''}${formatCurrency(open)}`,
      tone: open >= 0,
      sub: cost > 0 ? formatChange((open / cost) * 100) : undefined,
    },
    {
      label: 'Today',
      value: `${today >= 0 ? '+' : ''}${formatCurrency(today)}`,
      tone: today >= 0,
      sub: 'on your stocks',
    },
    ...(week !== null ? [{ label: '7 days', value: formatChange(week), tone: week >= 0 }] : []),
    ...(month !== null ? [{ label: '30 days', value: formatChange(month), tone: month >= 0 }] : []),
    ...(dividends > 0 ? [{ label: 'Dividends', value: `~${formatCurrency(dividends)}`, sub: 'per week' }] : []),
    ...(shortCollateral > 0 ? [{ label: 'In shorts', value: formatCurrency(shortCollateral), sub: 'collateral' }] : []),
    ...(margin
      ? [
          {
            label: 'Can borrow',
            value: formatCurrency(Math.max(0, margin.availableMargin)),
            sub: debt > 0 ? `owes ${formatCurrency(debt)}` : 'margin',
            tone: debt > 0 ? false : null,
          },
        ]
      : []),
  ];

  return (
    <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1 md:mx-0 md:px-0 md:grid md:grid-cols-2 md:overflow-visible">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="shrink-0 min-w-[7.5rem] md:min-w-0 p-3 rounded-sm border light:border-amber-200 light:bg-amber-50/50 dark:border-zinc-800 dark:bg-zinc-900/60"
        >
          <div className={`text-[11px] uppercase font-semibold ${mutedClass}`}>{t.label}</div>
          <div
            className={`text-base font-bold whitespace-nowrap ${
              t.tone === undefined || t.tone === null ? textClass : getColorBlindColors(t.tone).text
            }`}
          >
            {t.value}
          </div>
          {t.sub && <div className={`text-[11px] ${mutedClass}`}>{t.sub}</div>}
        </div>
      ))}
    </div>
  );
};

export default PortfolioStats;
