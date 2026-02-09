import React, { useState, useEffect, useMemo } from 'react';
import { CREW_MAP } from '../../crews';
import PinDisplay from '../common/PinDisplay';
import { db } from '../../firebase';
import { updateDoc, doc } from 'firebase/firestore';
import { formatCurrency } from '../../utils/formatters';

const ProfileModal = ({ onClose, darkMode, userData, predictions, onOpenCrewSelection, user, onDeleteAccount, prices, holdings, shorts, costBasis }) => {
  const [showCrewSection, setShowCrewSection] = useState(false);
  const [deleteStep, setDeleteStep] = useState(0); // 0=hidden, 1=info, 2=confirm1, 3=confirm2, 4=confirm3, 5=final
  const [deleting, setDeleting] = useState(false);
  const [confirmUsername, setConfirmUsername] = useState('');
  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';

  const bets = userData?.bets || {};
  const predictionWins = userData?.predictionWins || 0;
  const userCrew = userData?.crew;
  const crewData = userCrew ? CREW_MAP[userCrew] : null;

  // Calculate trading stats
  const joinDate = userData?.createdAt?.toDate?.() || null;
  const peakPortfolio = userData?.peakPortfolioValue || 1000;

  // Find biggest holding by value
  let biggestHolding = null;
  let biggestValue = 0;
  Object.entries(holdings).forEach(([ticker, shares]) => {
    if (shares > 0) {
      const currentPrice = prices[ticker] || 0;
      const value = shares * currentPrice;
      if (value > biggestValue) {
        biggestValue = value;
        biggestHolding = { ticker, shares, value };
      }
    }
  });

  // Find best and worst performing stocks (by % return)
  let bestStock = null;
  let worstStock = null;
  let bestReturn = -Infinity;
  let worstReturn = Infinity;

  Object.entries(holdings).forEach(([ticker, shares]) => {
    if (shares > 0) {
      const currentPrice = prices[ticker] || 0;
      const avgCost = costBasis[ticker] || 0;
      const returnPercent = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : 0;

      if (returnPercent > bestReturn) {
        bestReturn = returnPercent;
        bestStock = { ticker, returnPercent, currentPrice, avgCost, shares };
      }
      if (returnPercent < worstReturn) {
        worstReturn = returnPercent;
        worstStock = { ticker, returnPercent, currentPrice, avgCost, shares };
      }
    }
  });

  // Find most shares held
  let mostShares = null;
  let maxShares = 0;
  Object.entries(holdings).forEach(([ticker, shares]) => {
    if (shares > maxShares) {
      maxShares = shares;
      mostShares = { ticker, shares };
    }
  });

  // Get all predictions user has bet on (from their bets object)
  const userBetHistory = Object.entries(bets).map(([predictionId, betData]) => {
    // Try to find the prediction in current predictions
    const prediction = predictions.find(p => p.id === predictionId);
    return {
      predictionId,
      ...betData,
      prediction
    };
  }).sort((a, b) => (b.placedAt || 0) - (a.placedAt || 0));

  // Calculate potential payout for active bets
  const calculatePotentialPayout = (bet) => {
    if (!bet.prediction || bet.prediction.resolved) return null;

    const pools = bet.prediction.pools || {};
    const totalPool = Object.values(pools).reduce((sum, p) => sum + p, 0);
    const myPool = pools[bet.option] || 0;

    if (myPool === 0) return 0;

    const myShare = bet.amount / myPool;
    return myShare * totalPool;
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className={`w-full max-w-lg max-h-[85vh] ${cardClass} border rounded-sm shadow-xl overflow-hidden flex flex-col`}
        onClick={e => e.stopPropagation()}
      >
        <div className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <div className="flex justify-between items-center">
            <div>
              <h2 className={`text-lg font-semibold ${textClass}`}>👤 {userData?.displayName}</h2>
              <p className={`text-sm ${mutedClass}`}>Profile & Stats</p>
            </div>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-600 text-xl`}>×</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Crew Section - Collapsible */}
          {userCrew && crewData && (
            <div
              className={`rounded-sm border ${darkMode ? 'border-zinc-700' : 'border-amber-200'} overflow-hidden`}
              style={{ borderColor: crewData.color }}
            >
              <button
                onClick={() => setShowCrewSection(!showCrewSection)}
                className={`w-full p-3 flex items-center justify-between ${darkMode ? 'bg-zinc-800/50 hover:bg-zinc-800' : 'bg-amber-50 hover:bg-amber-100'}`}
              >
                <div className="flex items-center gap-2">
                  {crewData.icon ? (
                    <img src={crewData.icon} alt="" className="w-6 h-6 object-contain" />
                  ) : (
                    <span className="text-xl">{crewData.emblem}</span>
                  )}
                  <span className={`font-semibold ${textClass}`} style={{ color: crewData.color }}>
                    {crewData.name}
                  </span>
                  {userData.isCrewHead && (
                    <span className="text-amber-400">👑</span>
                  )}
                </div>
                <span className={mutedClass}>{showCrewSection ? '▼' : '▶'}</span>
              </button>

              {showCrewSection && (
                <div className={`p-3 border-t ${darkMode ? 'border-zinc-700' : 'border-amber-200'}`}>
                  <div className={`text-sm ${mutedClass} mb-2`}>
                    <strong>Crew Members:</strong> {crewData.members?.join(', ')}
                  </div>
                  <button
                    onClick={() => { onClose(); onOpenCrewSelection(); }}
                    className={`w-full py-2 text-sm font-semibold rounded-sm ${darkMode ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}
                  >
                    Switch Crew (15% penalty)
                  </button>
                </div>
              )}
            </div>
          )}

          {!userCrew && (
            <button
              onClick={() => { onClose(); onOpenCrewSelection(); }}
              className="w-full py-3 text-sm font-semibold rounded-sm bg-orange-600 hover:bg-orange-700 text-white"
            >
              🏴 Join a Crew
            </button>
          )}

          {/* Stats Summary */}
          <div className={`p-4 rounded-sm ${darkMode ? 'bg-zinc-800/50' : 'bg-amber-50'}`}>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className={`text-2xl font-bold text-orange-500`}>{userData?.totalTrades || 0}</p>
                <p className={`text-xs ${mutedClass}`}>Total Trades</p>
              </div>
              <div>
                <p className={`text-2xl font-bold text-orange-500`}>{predictionWins}</p>
                <p className={`text-xs ${mutedClass}`}>Correct Predictions</p>
              </div>
              <div>
                <p className={`text-2xl font-bold ${textClass}`}>{userBetHistory.length}</p>
                <p className={`text-xs ${mutedClass}`}>Bets Placed</p>
              </div>
            </div>
          </div>

          {/* Trading Stats */}
          <div className={`p-4 rounded-sm border ${darkMode ? 'bg-zinc-800/50 border-zinc-700' : 'bg-amber-50 border-amber-200'}`}>
            <h3 className={`font-semibold ${textClass} mb-3`}>📊 Trading Stats</h3>
            <div className="space-y-2 text-sm">
              {joinDate && (
                <div className="flex justify-between">
                  <span className={mutedClass}>Joined:</span>
                  <span className={textClass}>{joinDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className={mutedClass}>Peak Portfolio:</span>
                <span className={`font-semibold ${textClass}`}>{formatCurrency(peakPortfolio)}</span>
              </div>
              {biggestHolding && (
                <div className="flex justify-between">
                  <span className={mutedClass}>Biggest Holding:</span>
                  <span className={`font-semibold ${textClass}`}>
                    ${biggestHolding.ticker} ({biggestHolding.shares} shares, {formatCurrency(biggestValue)})
                  </span>
                </div>
              )}
              {mostShares && mostShares.shares > 0 && (
                <div className="flex justify-between">
                  <span className={mutedClass}>Most Shares:</span>
                  <span className={`font-semibold ${textClass}`}>
                    ${mostShares.ticker} ({mostShares.shares} shares)
                  </span>
                </div>
              )}
              {bestStock && bestStock.returnPercent !== 0 && (
                <div className="flex justify-between">
                  <span className={mutedClass}>Best Performer:</span>
                  <span className={`font-semibold ${bestStock.returnPercent >= 0 ? (userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500') : (userData?.colorBlindMode ? 'text-purple-500' : 'text-red-500')}`}>
                    ${bestStock.ticker} ({bestStock.returnPercent >= 0 ? '+' : ''}{bestStock.returnPercent.toFixed(1)}%)
                  </span>
                </div>
              )}
              {worstStock && worstStock.returnPercent !== 0 && worstStock.ticker !== bestStock?.ticker && (
                <div className="flex justify-between">
                  <span className={mutedClass}>Worst Performer:</span>
                  <span className={`font-semibold ${worstStock.returnPercent >= 0 ? (userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500') : (userData?.colorBlindMode ? 'text-purple-500' : 'text-red-500')}`}>
                    ${worstStock.ticker} ({worstStock.returnPercent >= 0 ? '+' : ''}{worstStock.returnPercent.toFixed(1)}%)
                  </span>
                </div>
              )}
              {Object.keys(holdings).length === 0 && Object.keys(shorts || {}).length === 0 && (
                <p className={`text-xs ${mutedClass} text-center py-2`}>No active positions yet</p>
              )}
            </div>
          </div>

          {/* Accessibility Settings */}
          <div className={`p-4 rounded-sm border ${darkMode ? 'bg-zinc-800/50 border-zinc-700' : 'bg-amber-50 border-amber-200'}`}>
            <h3 className={`font-semibold ${textClass} mb-3`}>⚙️ Settings</h3>
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-sm font-semibold ${textClass}`}>Color Blind Mode</p>
                <p className={`text-xs ${mutedClass}`}>Use teal/purple instead of green/red</p>
              </div>
              <button
                onClick={async () => {
                  const newMode = !userData?.colorBlindMode;
                  try {
                    await updateDoc(doc(db, 'users', user.uid), {
                      colorBlindMode: newMode
                    });
                  } catch (err) {
                    console.error('Failed to update color blind mode:', err);
                  }
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  userData?.colorBlindMode ? 'bg-orange-600' : (darkMode ? 'bg-zinc-700' : 'bg-slate-300')
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    userData?.colorBlindMode ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Active Bets */}
          {userBetHistory.filter(b => b.prediction && !b.prediction.resolved).length > 0 && (
            <div>
              <h3 className={`font-semibold ${textClass} mb-2`}>🔮 Active Bets</h3>
              <div className="space-y-2">
                {userBetHistory.filter(b => b.prediction && !b.prediction.resolved).map(bet => {
                  const potentialPayout = calculatePotentialPayout(bet);
                  return (
                    <div key={bet.predictionId} className={`p-3 rounded-sm border ${darkMode ? 'border-zinc-700' : 'border-amber-200'}`}>
                      <p className={`text-sm font-semibold ${textClass}`}>{bet.prediction?.question || bet.question}</p>
                      <div className="flex justify-between items-center mt-2">
                        <div>
                          <span className={`text-xs ${mutedClass}`}>Your bet: </span>
                          <span className="text-orange-500 font-semibold">{formatCurrency(bet.amount)}</span>
                          <span className={`text-xs ${mutedClass}`}> on </span>
                          <span className={`text-sm font-semibold ${textClass}`}>"{bet.option}"</span>
                        </div>
                        {potentialPayout !== null && (
                          <div className="text-right">
                            <p className={`text-xs ${mutedClass}`}>Potential payout</p>
                            <p className={`font-semibold ${userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>{formatCurrency(potentialPayout)}</p>
                          </div>
                        )}
                      </div>
                      {!bet.paid && (
                        <p className={`text-xs ${mutedClass} mt-1`}>⏳ Awaiting results...</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Past Predictions */}
          <div>
            <h3 className={`font-semibold ${textClass} mb-2`}>📜 Past Predictions</h3>
            {userBetHistory.filter(b => b.prediction?.resolved || b.paid !== undefined).length === 0 ? (
              <p className={`text-sm ${mutedClass}`}>No past predictions yet.</p>
            ) : (
              <div className="space-y-2">
                {userBetHistory.filter(b => b.prediction?.resolved || b.paid !== undefined).map(bet => {
                  const won = bet.prediction?.outcome === bet.option;
                  const paidOut = bet.paid === true;
                  const colorBlindMode = userData?.colorBlindMode || false;
                  const winBorderBg = colorBlindMode
                    ? (darkMode ? 'border-teal-700 bg-teal-900/20' : 'border-teal-300 bg-teal-50')
                    : (darkMode ? 'border-green-700 bg-green-900/20' : 'border-green-300 bg-green-50');
                  const loseBorderBg = colorBlindMode
                    ? (darkMode ? 'border-purple-700/50 bg-purple-900/10' : 'border-purple-200 bg-purple-50')
                    : (darkMode ? 'border-red-700/50 bg-red-900/10' : 'border-red-200 bg-red-50');
                  const winText = colorBlindMode ? 'text-teal-500' : 'text-green-500';
                  const loseText = colorBlindMode ? 'text-purple-400' : 'text-red-400';

                  return (
                    <div key={bet.predictionId} className={`p-3 rounded-sm border ${won ? winBorderBg : loseBorderBg}`}>
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <p className={`text-sm font-semibold ${textClass}`}>
                            {bet.prediction?.question || bet.question || 'Past prediction (details unavailable)'}
                          </p>
                          <p className={`text-xs ${mutedClass} mt-1`}>
                            Your answer: <span className={`font-semibold ${won ? winText : loseText}`}>"{bet.option}"</span>
                            {(bet.prediction?.outcome || bet.outcome) && (
                              <span> • Correct answer: <span className="text-orange-500">"{bet.prediction?.outcome || bet.outcome}"</span></span>
                            )}
                          </p>
                        </div>
                        <div className="text-right ml-2">
                          {won ? (
                            <>
                              <p className={`${winText} font-bold`}>✓ Won</p>
                              {bet.payout && <p className={`${winText} text-sm`}>+{formatCurrency(bet.payout)}</p>}
                            </>
                          ) : (
                            <p className={`${loseText} font-semibold`}>✗ Lost</p>
                          )}
                        </div>
                      </div>
                      <div className={`text-xs mt-2 ${mutedClass}`}>
                        Bet: {formatCurrency(bet.amount)}
                        {paidOut ? (
                          <span className={`${winText} ml-2`}>✓ Paid out to winners</span>
                        ) : bet.prediction?.resolved ? (
                          <span className="text-amber-500 ml-2">⏳ Payout pending</span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Delete Account Section */}
          <div className={`mt-6 pt-4 border-t ${darkMode ? 'border-zinc-700' : 'border-amber-200'}`}>
            {deleteStep === 0 && (
              <button
                onClick={() => setDeleteStep(1)}
                className={`text-xs ${mutedClass} hover:text-red-500 transition-colors`}
              >
                🗑️ Delete Account
              </button>
            )}

            {deleteStep === 1 && (
              <div className={`p-3 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-amber-50'}`}>
                <h4 className={`font-semibold text-red-500 mb-2`}>Delete Your Account</h4>
                <p className={`text-sm ${mutedClass} mb-3`}>
                  This will permanently delete your account and all associated data including:
                </p>
                <ul className={`text-sm ${mutedClass} mb-3 ml-4 list-disc`}>
                  <li>Your username and profile</li>
                  <li>All cash and holdings</li>
                  <li>Trade history and achievements</li>
                  <li>Prediction bets and results</li>
                </ul>
                <p className={`text-xs text-red-400 mb-3`}>This action cannot be undone.</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDeleteStep(0)}
                    className={`flex-1 py-2 text-sm font-semibold rounded-sm ${darkMode ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setDeleteStep(2)}
                    className="flex-1 py-2 text-sm font-semibold rounded-sm bg-red-600 hover:bg-red-700 text-white"
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {deleteStep === 2 && (
              <div className={`p-3 rounded-sm border-2 border-red-500 ${darkMode ? 'bg-red-900/20' : 'bg-red-50'}`}>
                <h4 className={`font-semibold text-red-500 mb-2`}>⚠️ Are you sure?</h4>
                <p className={`text-sm ${mutedClass} mb-3`}>
                  You're about to permanently delete your account "{userData?.displayName}".
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDeleteStep(0)}
                    className={`flex-1 py-2 text-sm font-semibold rounded-sm ${darkMode ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setDeleteStep(3)}
                    className="flex-1 py-2 text-sm font-semibold rounded-sm bg-red-600 hover:bg-red-700 text-white"
                  >
                    Yes, Delete My Account
                  </button>
                </div>
              </div>
            )}

            {deleteStep === 3 && (
              <div className={`p-3 rounded-sm border-2 border-red-600 ${darkMode ? 'bg-red-900/30' : 'bg-red-100'}`}>
                <h4 className={`font-semibold text-red-600 mb-2`}>🚨 Are you absolutely certain?</h4>
                <p className={`text-sm text-red-500 mb-3`}>
                  Your account and all data will be permanently erased. There is no recovery.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDeleteStep(0)}
                    className={`flex-1 py-2 text-sm font-semibold rounded-sm ${darkMode ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setDeleteStep(4)}
                    className="flex-1 py-2 text-sm font-bold rounded-sm bg-red-700 hover:bg-red-800 text-white"
                  >
                    Continue Deletion
                  </button>
                </div>
              </div>
            )}

            {deleteStep === 4 && (
              <div className={`p-3 rounded-sm border-2 border-rose-700 ${darkMode ? 'bg-rose-900/40' : 'bg-rose-100'}`}>
                <h4 className={`font-semibold text-rose-700 mb-2`}>⚠️ Point of No Return</h4>
                <p className={`text-sm text-rose-600 mb-3`}>
                  After the next step, your account "{userData?.displayName}" will be gone forever.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDeleteStep(0)}
                    className={`flex-1 py-2 text-sm font-semibold rounded-sm ${darkMode ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => { setDeleteStep(5); setConfirmUsername(''); }}
                    className="flex-1 py-2 text-sm font-bold rounded-sm bg-rose-700 hover:bg-rose-800 text-white"
                  >
                    Proceed to Final Step
                  </button>
                </div>
              </div>
            )}

            {deleteStep === 5 && (
              <div className={`p-3 rounded-sm border-2 ${darkMode ? 'border-white bg-zinc-950' : 'border-zinc-800 bg-white'}`}>
                <h4 className={`font-semibold mb-2 ${darkMode ? 'text-white' : 'text-zinc-900'}`}>Final Confirmation</h4>
                <p className={`text-sm mb-3 ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>
                  Type your username <span className="font-bold">{userData?.displayName}</span> to confirm deletion:
                </p>
                <input
                  type="text"
                  value={confirmUsername}
                  onChange={(e) => setConfirmUsername(e.target.value)}
                  placeholder="Enter your username"
                  className={`w-full px-3 py-2 mb-3 rounded-sm border ${
                    darkMode
                      ? 'bg-zinc-900 border-zinc-600 text-white placeholder-zinc-500'
                      : 'bg-zinc-50 border-zinc-300 text-zinc-900 placeholder-zinc-400'
                  }`}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { setDeleteStep(0); setConfirmUsername(''); }}
                    className={`flex-1 py-2 text-sm font-semibold rounded-sm ${darkMode ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      setDeleting(true);
                      try {
                        await onDeleteAccount(confirmUsername);
                      } catch (err) {
                        console.error('Failed to delete account:', err);
                        setDeleting(false);
                      }
                    }}
                    disabled={deleting || confirmUsername.toLowerCase() !== userData?.displayName?.toLowerCase()}
                    className={`flex-1 py-2 text-sm font-bold rounded-sm disabled:opacity-50 ${
                      darkMode
                        ? 'bg-white hover:bg-zinc-200 text-zinc-900'
                        : 'bg-zinc-900 hover:bg-zinc-800 text-white'
                    }`}
                  >
                    {deleting ? 'Deleting...' : 'Delete My Account'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileModal;
