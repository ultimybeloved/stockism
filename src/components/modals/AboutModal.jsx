import { useState } from 'react';
import { getThemeClasses } from '../../utils/theme';
import { useAppContext } from '../../context/AppContext';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { marketTimes } from '../../utils/localTime';

const AboutModal = ({ onClose }) => {
  useEscapeKey(onClose);
  const { darkMode, userData } = useAppContext();
  const [activeTab, setActiveTab] = useState('about');

  const { textClass, mutedClass, overlayClass, modalShellClass, cardEdgeClass } = getThemeClasses(darkMode);
  const linkClass = 'text-orange-500 hover:text-orange-400 underline';

  return (
    <div className={`${overlayClass} z-50`} onClick={onClose}>
      <div
        className={`${modalShellClass} max-w-2xl overflow-hidden max-h-[90vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`p-4 border-b ${cardEdgeClass}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>About Stockism</h2>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-500 text-xl`}>
              ×
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className={`flex border-b ${cardEdgeClass}`}>
          {[
            { key: 'about', label: '📖 About' },
            { key: 'faq', label: '❓ FAQ' },
            { key: 'privacy', label: '🔒 Privacy' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-3 text-sm font-semibold ${
                activeTab === tab.key ? 'text-orange-500 border-b-2 border-orange-500' : mutedClass
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* ABOUT TAB */}
          {activeTab === 'about' && (
            <div className={`space-y-4 ${textClass}`}>
              <div>
                <h3 className="font-semibold text-orange-500 mb-2">What is Stockism?</h3>
                <p className={mutedClass}>
                  Stockism is a free fan-made stock market simulation game based on the Lookism webtoon universe. Trade
                  fictional characters like stocks, predict story outcomes, and compete on the leaderboard!
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-2">How does it work?</h3>
                <p className={mutedClass}>
                  Each character has a stock price that changes based on player trading activity. Buy low, sell high,
                  and use your knowledge of the webtoon to make smart investments. You can also bet on weekly
                  predictions about upcoming chapters.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-2">Is real money involved?</h3>
                <p className={mutedClass}>
                  <span className={`font-semibold ${userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>
                    Absolutely not.
                  </span>{' '}
                  Stockism uses entirely fictional currency. You start with $1,000 of fake money, raised to $3,000 when
                  you link Discord, and can earn more through daily check-ins. There is no way to deposit, withdraw, or
                  exchange real money. This is purely for fun!
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-2">Who made this?</h3>
                <p className={mutedClass}>
                  Stockism was created by{' '}
                  <a
                    href="https://github.com/UltiMyBeloved"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-orange-500 hover:text-orange-400 underline"
                  >
                    Darth YG
                  </a>{' '}
                  for the Lookism community. It's a free, open-source project with no ads or monetization.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-2">Join the Community</h3>
                <div className="flex gap-3">
                  <a
                    href="https://discord.gg/hpVm8nQMvY"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex items-center gap-2 px-3 py-2 rounded ${darkMode ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-indigo-500 hover:bg-indigo-600'} text-white text-sm font-medium`}
                  >
                    Discord
                  </a>
                  <a
                    href="https://reddit.com/r/stockismapp"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex items-center gap-2 px-3 py-2 rounded ${darkMode ? 'bg-orange-600 hover:bg-orange-500' : 'bg-orange-500 hover:bg-orange-600'} text-white text-sm font-medium`}
                  >
                    Reddit
                  </a>
                </div>

                {/* Live Discord widget. Loads from discord.com only when this tab is open. */}
                <div className="mt-3 w-full max-w-[350px]">
                  <iframe
                    src="https://discord.com/widget?id=1466532292242702452&theme=dark"
                    title="Stockism Discord"
                    width="350"
                    height="500"
                    frameBorder="0"
                    sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
                    className="w-full rounded"
                  />
                  <p className={`text-xs ${mutedClass} mt-1`}>
                    This widget loads live from Discord, so opening it lets Discord set its own cookies.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* FAQ TAB */}
          {activeTab === 'faq' && (
            <div className={`space-y-4 ${textClass}`}>
              <div>
                <h3 className="font-semibold text-orange-500 mb-1">Why is the market closed on Thursdays?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  The market halts every week ({marketTimes().halt}) while new chapter events get priced in. Nobody can
                  trade during the halt, so early chapter readers don't get an unfair edge.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-1">What is the pre-market?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  During the last stretch of the halt ({marketTimes().preMarket}) you can queue buy and sell orders.
                  Then orders lock in. All queued orders execute together in one opening auction, and the market reopens
                  ({marketTimes().reopen}). It's the way to act on the new chapter without waiting at your screen for
                  the exact reopen second.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-1">What are limit orders and stop losses?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  A limit order buys or sells automatically when a stock hits your target price, even while you're
                  offline. A stop loss sells automatically if the price drops to your trigger, protecting you from a
                  crash. Set both from any character's trade menu. Pending orders are checked every 15 minutes and
                  expire after 90 days.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-1">Why can't I sell some of my shares?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Two kinds of temporary locks exist. Shares bought in an IPO are locked for 24 hours after the IPO
                  window closes, so the guaranteed launch bump can't be flipped instantly. Shares bought with borrowed
                  margin money are locked for 36 hours. The trade screen shows how many of your shares are locked and
                  when they free up.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-1">What's the "bid-ask spread"?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Just like real stock markets, there's a tiny gap between buy and sell prices (0.2% for stocks, 0.1%
                  for ETFs). This prevents instant arbitrage and makes the simulation more realistic.
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
                  ETF prices move in two ways: from direct trading (buying/selling the ETF itself) and from the
                  performance of the underlying stocks. If a character in an ETF goes up, the ETF price will rise
                  proportionally too.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-1">Why is the spread different for ETFs?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  ETFs have a tighter spread (0.1% vs 0.2% for individual stocks) because they're diversified. Holding a
                  basket of stocks is less risky than holding a single one, so the trading cost is lower.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-1">How do prices change?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Prices are driven by player activity using a realistic "square root" model. Buying pushes prices up,
                  selling pushes them down. Large orders have diminishing impact to prevent manipulation.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-1">What is shorting?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Shorting lets you profit when a stock goes DOWN. You "borrow" shares, sell them, and hope to buy them
                  back cheaper later. It's risky. If the price goes up instead, you lose money. Requires full
                  collateral: you deposit the stock's current value, dollar for dollar.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-1">How do dividends work?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Every stock pays a weekly dividend to holders. Payouts run every Thursday right before the chapter
                  halt, using the pre-halt price snapshot. The rate depends on the stock&apos;s rarity: Legendary pays
                  the most (1% a week) and Common the least (0.3%), with ETFs at a flat 0.7%. Rarity goes by price rank,
                  so it changes as the market moves. Shares must be held for at least 10 days to earn anything, and they
                  earn 1.25x at 4 weeks and 1.5x at 8 weeks. Check the Portfolio modal to see each holding&apos;s tier
                  and projected weekly income. You can also turn on DRIP per stock in your portfolio to automatically
                  reinvest each payout into more shares instead of taking cash.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-1">How do predictions work?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Place bets on story outcomes (e.g., "Will X defeat Y?"). All bets go into a pool, and winners split
                  the entire pool in proportion to their bets. Some bets start with house money in every side of the
                  pool, which goes to the winners too.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-1">What are seasons?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  A season runs alongside a story arc and scores how much you grow your account from the day it starts.
                  Free stock and bonuses don&apos;t count. Tiers are a ladder: Bronze for being active, then Silver for
                  finishing up, Gold for beating the market, and Platinum and Diamond for the top finishers in your
                  account-size division. You need each tier before the next one. Open the Season card for the exact
                  rules and your progress.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-1">Why can&apos;t I buy a stock back?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  If your sells or shorts push a stock down 4% or more in a day, you can&apos;t buy it back for 48
                  hours. Selling hard also blocks shorting that stock for 48 hours. This stops players crashing a stock
                  on purpose and buying the dip. Selling and closing positions are never blocked.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-1">Can I lose all my money?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Yes, through bad trades or losing prediction bets. But you can always earn more through the daily
                  check-in bonus. It starts at $300 and climbs each day you check in, up to $500 a day. Miss a day and
                  it resets. If your account is wiped out, you can take a $1,500 bailout once a day, but it clears every
                  position and removes you from your crew.
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
          )}

          {/* PRIVACY TAB */}
          {activeTab === 'privacy' && (
            <div className={`space-y-4 ${textClass}`}>
              <div
                className={`p-3 rounded-sm ${userData?.colorBlindMode ? (darkMode ? 'bg-teal-900/30 border border-teal-700' : 'bg-teal-50 border border-teal-200') : darkMode ? 'bg-green-900/30 border border-green-700' : 'bg-green-50 border border-green-200'}`}
              >
                <p className={`font-semibold text-sm ${userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>
                  🛡️ TL;DR: We store almost nothing about you. No real names, no profile pictures, no tracking.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-2">What we store in our game database:</h3>
                <ul className={`text-sm ${mutedClass} space-y-1 ml-4`}>
                  <li>
                    • <span className={darkMode ? 'text-zinc-300' : 'text-slate-700'}>Username</span>: The name YOU
                    choose (not your real name)
                  </li>
                  <li>
                    • <span className={darkMode ? 'text-zinc-300' : 'text-slate-700'}>Game data</span>: Your cash
                    balance, holdings, and trade history
                  </li>
                  <li>
                    • <span className={darkMode ? 'text-zinc-300' : 'text-slate-700'}>Account ID</span>: A random ID to
                    identify your account
                  </li>
                  <li>
                    • <span className={darkMode ? 'text-zinc-300' : 'text-slate-700'}>Discord ID</span>: If you link
                    Discord, so one Discord account maps to one player. Never shown to other players
                  </li>
                  <li>
                    • <span className={darkMode ? 'text-zinc-300' : 'text-slate-700'}>IP address</span>: Used only to
                    stop people making alt accounts. Never shown to other players
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-2">What Firebase Authentication stores:</h3>
                <p className={`text-sm ${mutedClass} mb-2`}>
                  Firebase (Google's service) handles login and stores your email to manage your account. This is
                  standard for any website with login. It's how you can sign back in later.
                </p>
                <ul className={`text-sm ${mutedClass} space-y-1 ml-4`}>
                  <li>
                    • <span className={darkMode ? 'text-amber-400' : 'text-amber-600'}>📧 Email</span>: Stored by
                    Firebase Auth (not our game database). Never visible to other players or used for marketing.
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-2">What we DON'T store anywhere:</h3>
                <ul className={`text-sm ${mutedClass} space-y-1 ml-4`}>
                  <li>
                    •{' '}
                    <span className={userData?.colorBlindMode ? 'text-purple-400' : 'text-red-400'}>
                      ❌ Your real name
                    </span>
                    : We never save the name from your sign-in account
                  </li>
                  <li>
                    •{' '}
                    <span className={userData?.colorBlindMode ? 'text-purple-400' : 'text-red-400'}>
                      ❌ Your profile picture
                    </span>
                    : We never save your sign-in photo
                  </li>
                  <li>
                    •{' '}
                    <span className={userData?.colorBlindMode ? 'text-purple-400' : 'text-red-400'}>
                      ❌ Your password
                    </span>
                    : Your sign-in provider handles authentication securely
                  </li>
                  <li>
                    •{' '}
                    <span className={userData?.colorBlindMode ? 'text-purple-400' : 'text-red-400'}>
                      ❌ Your contacts or account data
                    </span>
                    : We have no access
                  </li>
                  <li>
                    •{' '}
                    <span className={userData?.colorBlindMode ? 'text-purple-400' : 'text-red-400'}>
                      ❌ Tracking cookies or analytics
                    </span>
                    : We don't use any. When something breaks, an error report goes to our bug tracker so we can fix it
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-2">About the sign-in popup:</h3>
                <p className={`text-sm ${mutedClass}`}>
                  When you sign in with Google, X, or Discord, they show a standard message saying we "could" access
                  your name and profile picture. That screen shows the <em>maximum possible</em> permissions, not what
                  we actually use.
                </p>
                <p className={`text-sm ${mutedClass} mt-2`}>
                  In reality, our code immediately discards this information. We only use the sign-in to verify you're a
                  real person, then we ask you to create a username. That username is the only identifier visible to
                  other players.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-2">Data deletion:</h3>
                <p className={`text-sm ${mutedClass}`}>
                  You can delete your account and all associated data anytime from your Profile (click your username →
                  scroll to bottom → Delete Account). To stop alt-account abuse, a record of your IP address and Discord
                  ID is kept after deletion, which blocks them from making a new account for 30 days.
                </p>
              </div>

              <div className={`mt-4 p-3 rounded-sm ${darkMode ? 'bg-zinc-800/50' : 'bg-amber-50'}`}>
                <p className={`text-xs ${mutedClass}`}>
                  Last updated: September 2026. This is a fan project with no legal entity behind it. If you have
                  privacy concerns, please reach out to us directly.
                </p>
                <p className={`text-xs ${mutedClass} mt-2`}>
                  <a href="/terms.html" target="_blank" rel="noopener noreferrer" className={linkClass}>
                    View Terms of Service →
                  </a>
                  {' • '}
                  <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className={linkClass}>
                    View Privacy Policy →
                  </a>
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AboutModal;
