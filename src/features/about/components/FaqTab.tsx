import { getThemeClasses } from '../../../utils/theme';
import { useTheme } from '../../../context/AppContext';
import { marketTimes } from '../../../utils/localTime';

// The FAQ tab: how the market, orders, shorts, dividends and seasons work.
const FaqTab = () => {
  const { darkMode } = useTheme();
  const { textClass, mutedClass } = getThemeClasses(darkMode);

  return (
    <div className={`space-y-4 ${textClass}`}>
      <div>
        <h3 className="font-semibold text-orange-500 mb-1">Why is the market closed on Thursdays?</h3>
        <p className={`text-sm ${mutedClass}`}>
          The market halts every week ({marketTimes().halt}) while new chapter events get priced in. Nobody can trade
          during the halt, so early chapter readers don't get an unfair edge.
        </p>
      </div>

      <div>
        <h3 className="font-semibold text-orange-500 mb-1">What is the pre-market?</h3>
        <p className={`text-sm ${mutedClass}`}>
          During the last stretch of the halt ({marketTimes().preMarket}) you can queue buy and sell orders. Then orders
          lock in. All queued orders execute together in one opening auction, and the market reopens (
          {marketTimes().reopen}). It's the way to act on the new chapter without waiting at your screen for the exact
          reopen second.
        </p>
      </div>

      <div>
        <h3 className="font-semibold text-orange-500 mb-1">What are limit orders and stop losses?</h3>
        <p className={`text-sm ${mutedClass}`}>
          A limit order buys or sells automatically when a stock hits your target price, even while you're offline. A
          stop loss sells automatically if the price drops to your trigger, protecting you from a crash. Set both from
          any character's trade menu. Pending orders are checked every 15 minutes and expire after 90 days.
        </p>
      </div>

      <div>
        <h3 className="font-semibold text-orange-500 mb-1">Why can't I sell some of my shares?</h3>
        <p className={`text-sm ${mutedClass}`}>
          Two kinds of temporary locks exist. Shares bought in an IPO are locked for 24 hours after the IPO window
          closes, so the guaranteed launch bump can't be flipped instantly. Shares bought with borrowed margin money are
          locked for 36 hours. The trade screen shows how many of your shares are locked and when they free up.
        </p>
      </div>

      <div>
        <h3 className="font-semibold text-orange-500 mb-1">What's the "bid-ask spread"?</h3>
        <p className={`text-sm ${mutedClass}`}>
          Just like real stock markets, there's a tiny gap between buy and sell prices (0.2% for stocks, 0.1% for ETFs).
          This prevents instant arbitrage and makes the simulation more realistic.
        </p>
      </div>

      <div>
        <h3 className="font-semibold text-orange-500 mb-1">What are ETFs?</h3>
        <p className={`text-sm ${mutedClass}`}>
          ETFs (Exchange-Traded Funds) are baskets of character stocks bundled together. Instead of buying each
          character individually, you can buy one ETF to get exposure to an entire crew or group at once.
        </p>
      </div>

      <div>
        <h3 className="font-semibold text-orange-500 mb-1">How do ETF prices work?</h3>
        <p className={`text-sm ${mutedClass}`}>
          ETF prices move in two ways: from direct trading (buying/selling the ETF itself) and from the performance of
          the underlying stocks. If a character in an ETF goes up, the ETF price will rise proportionally too.
        </p>
      </div>

      <div>
        <h3 className="font-semibold text-orange-500 mb-1">Why is the spread different for ETFs?</h3>
        <p className={`text-sm ${mutedClass}`}>
          ETFs have a tighter spread (0.1% vs 0.2% for individual stocks) because they're diversified. Holding a basket
          of stocks is less risky than holding a single one, so the trading cost is lower.
        </p>
      </div>

      <div>
        <h3 className="font-semibold text-orange-500 mb-1">How do prices change?</h3>
        <p className={`text-sm ${mutedClass}`}>
          Prices are driven by player activity using a realistic "square root" model. Buying pushes prices up, selling
          pushes them down. Large orders have diminishing impact to prevent manipulation.
        </p>
      </div>

      <div>
        <h3 className="font-semibold text-orange-500 mb-1">What is shorting?</h3>
        <p className={`text-sm ${mutedClass}`}>
          Shorting lets you profit when a stock goes DOWN. You "borrow" shares, sell them, and hope to buy them back
          cheaper later. It's risky. If the price goes up instead, you lose money. Requires full collateral: you deposit
          the stock's current value, dollar for dollar.
        </p>
      </div>

      <div>
        <h3 className="font-semibold text-orange-500 mb-1">How do dividends work?</h3>
        <p className={`text-sm ${mutedClass}`}>
          Every stock pays a weekly dividend to holders. Payouts run every Thursday right before the chapter halt, using
          the pre-halt price snapshot. The rate depends on the stock&apos;s rarity: Legendary pays the most (1% a week)
          and Common the least (0.3%), with ETFs at a flat 0.7%. Rarity goes by price rank, so it changes as the market
          moves. Shares must be held for at least 10 days to earn anything, and they earn 1.25x at 4 weeks and 1.5x at 8
          weeks. Check the Portfolio modal to see each holding&apos;s tier and projected weekly income. You can also
          turn on DRIP per stock in your portfolio to automatically reinvest each payout into more shares instead of
          taking cash.
        </p>
      </div>

      <div>
        <h3 className="font-semibold text-orange-500 mb-1">How do predictions work?</h3>
        <p className={`text-sm ${mutedClass}`}>
          Place bets on story outcomes (e.g., "Will X defeat Y?"). All bets go into a pool, and winners split the entire
          pool in proportion to their bets. Some bets start with house money in every side of the pool, which goes to
          the winners too.
        </p>
      </div>

      <div>
        <h3 className="font-semibold text-orange-500 mb-1">What are seasons?</h3>
        <p className={`text-sm ${mutedClass}`}>
          A season runs alongside a story arc and scores how much you grow your account from the day it starts. Free
          stock and bonuses don&apos;t count. Tiers are a ladder: Bronze for being active, then Silver for finishing up,
          Gold for beating the market, and Platinum and Diamond for the top finishers in your account-size division. You
          need each tier before the next one. Open the Season card for the exact rules and your progress.
        </p>
      </div>

      <div>
        <h3 className="font-semibold text-orange-500 mb-1">Why can&apos;t I buy a stock back?</h3>
        <p className={`text-sm ${mutedClass}`}>
          If your sells or shorts push a stock down 4% or more in a day, you can&apos;t buy it back for 48 hours.
          Selling hard also blocks shorting that stock for 48 hours. This stops players crashing a stock on purpose and
          buying the dip. Selling and closing positions are never blocked.
        </p>
      </div>

      <div>
        <h3 className="font-semibold text-orange-500 mb-1">Can I lose all my money?</h3>
        <p className={`text-sm ${mutedClass}`}>
          Yes, through bad trades or losing prediction bets. But you can always earn more through the daily check-in
          bonus. It starts at $300 and climbs each day you check in, up to $500 a day. Miss a day and it resets. If your
          account is wiped out, you can take a $1,500 bailout once a day, but it clears every position and removes you
          from your crew.
        </p>
      </div>

      <div>
        <h3 className="font-semibold text-orange-500 mb-1">How do I report bugs or suggest features?</h3>
        <p className={`text-sm ${mutedClass}`}>
          Report issues or suggest features on{' '}
          <a
            href="https://github.com/ultimybeloved/stockism"
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange-500 hover:text-orange-400 underline"
          >
            GitHub
          </a>
          . We're always looking to improve!
        </p>
      </div>
    </div>
  );
};

export default FaqTab;
