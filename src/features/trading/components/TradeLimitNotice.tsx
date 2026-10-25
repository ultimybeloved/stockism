import { MAX_TRADES_PER_TICKER_24H } from '../../../constants';
import { formatShares } from '../../../utils/tradeLimits';

const RED = 'mb-3 p-2 rounded-sm bg-red-900/40 border border-red-500/50 text-red-300 text-xs font-semibold text-center';
const YELLOW = 'mb-3 p-2 rounded-sm bg-yellow-900/30 border border-yellow-500/40 text-yellow-400 text-xs text-center';

// The limits that would refuse this order, shown before it's sent: a timed
// block (wash rule, short cooldowns, today's move limit), the 24h trade count,
// and how many shares today's move limit still allows.
export default function TradeLimitNotice({
  ticker,
  action,
  tradeCount,
  block,
  blocksSubmit,
  dailyCapShares,
}: {
  ticker: string;
  action: string;
  tradeCount: number;
  /** tradeLimits.tradeBlockMessage. */
  block: string | null;
  /** False when the block only delays the order (a limit buy in the wash rule). */
  blocksSubmit: boolean;
  /** Set when today's move limit is what caps this order. */
  dailyCapShares?: number;
}) {
  if (block) return <div className={blocksSubmit ? RED : YELLOW}>{block}</div>;
  if (tradeCount >= MAX_TRADES_PER_TICKER_24H)
    return (
      <div className={RED}>
        Daily trading limit reached for ${ticker} ({tradeCount}/{MAX_TRADES_PER_TICKER_24H} {action}s used)
      </div>
    );
  return (
    <>
      {tradeCount >= 7 && (
        <div className={YELLOW}>
          {tradeCount}/{MAX_TRADES_PER_TICKER_24H} {action}s used on ${ticker} (rolling 24h)
        </div>
      )}
      {dailyCapShares !== undefined && (
        <div className={YELLOW}>
          Today&apos;s limit on how far you can move ${ticker} allows up to {formatShares(dailyCapShares)} shares right
          now.
        </div>
      )}
    </>
  );
}
