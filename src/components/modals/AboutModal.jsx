import { useState } from 'react';

const AboutModal = ({ onClose, darkMode, userData }) => {
  const [activeTab, setActiveTab] = useState('about');

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';
  const linkClass = 'text-orange-500 hover:text-orange-400 underline';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-2xl ${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[90vh] flex flex-col`}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>About Stockism</h2>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-600 text-xl`}>×</button>
          </div>
        </div>

        {/* Tabs */}
        <div className={`flex border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          {[
            { key: 'about', label: '📖 About' },
            { key: 'faq', label: '❓ FAQ' },
            { key: 'privacy', label: '🔒 Privacy' },
          ].map(tab => (
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
                  Stockism is a free fan-made stock market simulation game based on the Lookism webtoon universe.
                  Trade fictional characters like stocks, predict story outcomes, and compete on the leaderboard!
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-2">How does it work?</h3>
                <p className={mutedClass}>
                  Each character has a stock price that changes based on player trading activity.
                  Buy low, sell high, and use your knowledge of the webtoon to make smart investments.
                  You can also bet on weekly predictions about upcoming chapters.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-2">Is real money involved?</h3>
                <p className={mutedClass}>
                  <span className={`font-semibold ${userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>Absolutely not.</span> Stockism uses entirely fictional currency.
                  You start with $1,000 of fake money and can earn more through daily check-ins.
                  There is no way to deposit, withdraw, or exchange real money. This is purely for fun!
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-2">Who made this?</h3>
                <p className={mutedClass}>
                  Stockism was created by <a href="https://github.com/UltiMyBeloved" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:text-orange-400 underline">Darth YG</a> for the Lookism community.
                  It's a free, open-source project with no ads or monetization.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-2">Join the Community</h3>
                <div className="flex gap-3">
                  <a
                    href="https://discord.gg/yxw94uNrYv"
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
              </div>
            </div>
          )}

          {/* FAQ TAB */}
          {activeTab === 'faq' && (
            <div className={`space-y-4 ${textClass}`}>
              <div>
                <h3 className="font-semibold text-orange-500 mb-1">What's the "bid-ask spread"?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Just like real stock markets, there's a tiny gap between buy and sell prices (0.2%).
                  This prevents instant arbitrage and makes the simulation more realistic.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-1">How do prices change?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Prices are driven by player activity using a realistic "square root" model.
                  Buying pushes prices up, selling pushes them down. Large orders have diminishing
                  impact to prevent manipulation.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-1">What is shorting?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Shorting lets you profit when a stock goes DOWN. You "borrow" shares, sell them,
                  and hope to buy them back cheaper later. It's risky — if the price goes up instead,
                  you lose money. Requires 50% margin as collateral.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-1">How do predictions work?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Place bets on story outcomes (e.g., "Will X defeat Y?"). All bets go into a pool,
                  and winners split the entire pool proportionally. If everyone picks the same answer
                  and wins, everyone just gets their money back.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-1">Can I lose all my money?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Yes, through bad trades or losing prediction bets. But you can always earn more
                  through the daily check-in bonus ($300/day). You can never go below $0.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-1">How do I report bugs or suggest features?</h3>
                <p className={`text-sm ${mutedClass}`}>
                  Report issues or suggest features on <a href="https://github.com/ultimybeloved/stockism" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:text-orange-400 underline">GitHub</a>. We're always looking to improve!
                </p>
              </div>
            </div>
          )}

          {/* PRIVACY TAB */}
          {activeTab === 'privacy' && (
            <div className={`space-y-4 ${textClass}`}>
              <div className={`p-3 rounded-sm ${userData?.colorBlindMode ? (darkMode ? 'bg-teal-900/30 border border-teal-700' : 'bg-teal-50 border border-teal-200') : (darkMode ? 'bg-green-900/30 border border-green-700' : 'bg-green-50 border border-green-200')}`}>
                <p className={`font-semibold text-sm ${userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>
                  🛡️ TL;DR: We store almost nothing about you. No real names, no profile pictures, no tracking.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-2">What we store in our game database:</h3>
                <ul className={`text-sm ${mutedClass} space-y-1 ml-4`}>
                  <li>• <span className={darkMode ? 'text-zinc-300' : 'text-slate-700'}>Username</span> — The name YOU choose (not your Google name)</li>
                  <li>• <span className={darkMode ? 'text-zinc-300' : 'text-slate-700'}>Game data</span> — Your cash balance, holdings, and trade history</li>
                  <li>• <span className={darkMode ? 'text-zinc-300' : 'text-slate-700'}>Account ID</span> — A random ID to identify your account</li>
                </ul>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-2">What Firebase Authentication stores:</h3>
                <p className={`text-sm ${mutedClass} mb-2`}>
                  Firebase (Google's service) handles login and stores your email to manage your account.
                  This is standard for any website with login — it's how you can sign back in later.
                </p>
                <ul className={`text-sm ${mutedClass} space-y-1 ml-4`}>
                  <li>• <span className={darkMode ? 'text-amber-400' : 'text-amber-600'}>📧 Email</span> — Stored by Firebase Auth (not our game database). Never visible to other players or used for marketing.</li>
                </ul>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-2">What we DON'T store anywhere:</h3>
                <ul className={`text-sm ${mutedClass} space-y-1 ml-4`}>
                  <li>• <span className={userData?.colorBlindMode ? 'text-purple-400' : 'text-red-400'}>❌ Your real name</span> — We never save your Google display name</li>
                  <li>• <span className={userData?.colorBlindMode ? 'text-purple-400' : 'text-red-400'}>❌ Your profile picture</span> — We never save your Google photo</li>
                  <li>• <span className={userData?.colorBlindMode ? 'text-purple-400' : 'text-red-400'}>❌ Your password</span> — Google handles authentication securely</li>
                  <li>• <span className={userData?.colorBlindMode ? 'text-purple-400' : 'text-red-400'}>❌ Your contacts or Google data</span> — We have no access</li>
                  <li>• <span className={userData?.colorBlindMode ? 'text-purple-400' : 'text-red-400'}>❌ Tracking cookies or analytics</span> — We don't use any</li>
                </ul>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-2">About the Google Sign-In popup:</h3>
                <p className={`text-sm ${mutedClass}`}>
                  When you sign in, Google shows a standard message saying we "could" access your name and
                  profile picture. This is Google's default OAuth screen — it shows the <em>maximum possible</em> permissions, not what we actually use.
                </p>
                <p className={`text-sm ${mutedClass} mt-2`}>
                  In reality, our code immediately discards this information. We only use Google to verify
                  you're a real person, then we ask you to create a username. That username is the only
                  identifier visible to other players.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-orange-500 mb-2">Data deletion:</h3>
                <p className={`text-sm ${mutedClass}`}>
                  You can delete your account and all associated data anytime from your Profile (click your username → scroll to bottom → Delete Account).
                </p>
              </div>

              <div className={`mt-4 p-3 rounded-sm ${darkMode ? 'bg-zinc-800/50' : 'bg-amber-50'}`}>
                <p className={`text-xs ${mutedClass}`}>
                  Last updated: January 2026. This is a fan project with no legal entity behind it.
                  If you have privacy concerns, please reach out to us directly.
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
