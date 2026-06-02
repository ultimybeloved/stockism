import React from 'react';
import { CHARACTERS } from '../../characters';
import { ADMIN_UIDS } from '../../constants';

const UsersTab = ({
  darkMode,
  textClass,
  mutedClass,
  inputClass,
  loading,
  prices,
  userSearchQuery,
  handleUserSearch,
  setUsersPage,
  userSortBy,
  handleUserSortChange,
  handleLoadAllUsers,
  handleRecalculatePortfolios,
  deleteMode,
  setDeleteMode,
  setSelectedForDeletion,
  selectedForDeletion,
  allUsers,
  userSearchResults,
  usersPage,
  USERS_PER_PAGE,
  selectedUser,
  setSelectedUser,
  calculateLivePortfolioValue,
  handleSyncSingleUser,
  handleSetCash,
  handleTransferToLadder,
  handleToggleDiscordWall,
  handleReinstateUser,
  handleChangeDisplayName,
  newDisplayName,
  setNewDisplayName,
  handleRollbackUser,
  toggleUserForDeletion,
  deleteSelectedUsers,
}) => {
  return (
    <div className="space-y-4">
      <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-100'}`}>
        <p className={`text-sm ${mutedClass}`}>
          👥 Browse, search, and manage users. Click "Load" to fetch all users.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        <input
          type="text"
          value={userSearchQuery}
          onChange={e => { handleUserSearch(e.target.value); setUsersPage(0); }}
          placeholder="Search by name or ID..."
          className={`flex-1 min-w-[150px] px-3 py-2 border rounded-sm ${inputClass}`}
        />
        <select
          value={userSortBy}
          onChange={e => handleUserSortChange(e.target.value)}
          className={`px-3 py-2 border rounded-sm ${inputClass}`}
        >
          <option value="portfolio-high">Portfolio: High → Low</option>
          <option value="portfolio-low">Portfolio: Low → High</option>
          <option value="cash-high">Cash: High → Low</option>
          <option value="cash-low">Cash: Low → High</option>
        </select>
        <button
          onClick={handleLoadAllUsers}
          disabled={loading}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-sm disabled:opacity-50"
        >
          {loading ? '...' : '🔄 Load'}
        </button>
        <button
          onClick={handleRecalculatePortfolios}
          disabled={loading}
          className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-sm disabled:opacity-50"
          title="Recalculate all portfolio values based on current prices"
        >
          {loading ? '...' : '📊 Recalc'}
        </button>
        <button
          onClick={() => { setDeleteMode(!deleteMode); setSelectedForDeletion(new Set()); }}
          className={`px-4 py-2 font-semibold rounded-sm ${
            deleteMode
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : darkMode ? 'bg-slate-600 hover:bg-slate-500 text-white' : 'bg-slate-300 hover:bg-slate-400 text-slate-700'
          }`}
        >
          {deleteMode ? '✕ Cancel' : '🗑️ Delete Mode'}
        </button>
      </div>

      {/* Delete Mode Controls */}
      {deleteMode && (
        <div className={`p-3 rounded-sm border-2 border-red-500 ${darkMode ? 'bg-red-900/20' : 'bg-red-50'}`}>
          <div className="flex justify-between items-center">
            <div>
              <span className="text-red-500 font-semibold">Delete Mode Active</span>
              <span className={`ml-2 ${mutedClass}`}>
                {selectedForDeletion.size} selected
              </span>
            </div>
            <button
              onClick={deleteSelectedUsers}
              disabled={loading || selectedForDeletion.size === 0}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-sm disabled:opacity-50"
            >
              {loading ? '...' : `🗑️ Delete ${selectedForDeletion.size} Users`}
            </button>
          </div>

          {/* Live selection summary */}
          {selectedForDeletion.size > 0 && (() => {
            let totalCash = 0;
            let totalShares = 0;
            let totalValue = 0;
            let totalShortShares = 0;
            let totalShortValue = 0;

            for (const userId of selectedForDeletion) {
              const user = allUsers.find(u => u.id === userId);
              if (!user) continue;
              totalCash += user.cash || 0;

              if (user.holdings && Object.keys(user.holdings).length > 0) {
                Object.entries(user.holdings).forEach(([ticker, shares]) => {
                  const shareCount = typeof shares === 'number' ? shares : (shares?.shares || 0);
                  if (shareCount > 0) {
                    totalShares += shareCount;
                    const character = CHARACTERS.find(c => c.ticker === ticker);
                    const price = prices[ticker] || character?.basePrice || 0;
                    totalValue += shareCount * price;
                  }
                });
              }

              if (user.shorts && Object.keys(user.shorts).length > 0) {
                Object.entries(user.shorts).forEach(([ticker, position]) => {
                  if (position && position.shares > 0) {
                    totalShortShares += position.shares;
                    totalShortValue += position.margin || 0;
                  }
                });
              }
            }

            return (
              <div className={`mt-2 pt-2 border-t ${darkMode ? 'border-red-800' : 'border-red-300'} text-xs`}>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <span className={mutedClass}>Cash: </span>
                    <span className="text-green-500 font-semibold">${totalCash.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className={mutedClass}>Shares: </span>
                    <span className={`font-semibold ${textClass}`}>{totalShares}</span>
                  </div>
                  <div>
                    <span className={mutedClass}>Value: </span>
                    <span className="text-cyan-500 font-semibold">${totalValue.toFixed(2)}</span>
                  </div>
                </div>
                {totalShortShares > 0 && (
                  <div className="grid grid-cols-3 gap-2 mt-1">
                    <div>
                      <span className={mutedClass}>Shorts: </span>
                      <span className="text-orange-500 font-semibold">{totalShortShares}</span>
                    </div>
                    <div>
                      <span className={mutedClass}>Collateral: </span>
                      <span className="text-orange-500 font-semibold">${totalShortValue.toFixed(2)}</span>
                    </div>
                    <div></div>
                  </div>
                )}
              </div>
            );
          })()}

          <p className={`text-xs ${mutedClass} mt-2`}>
            Click on users to select them for deletion. Admin accounts cannot be deleted.
          </p>
        </div>
      )}

      {allUsers.length > 0 && (
        <div className={`text-xs ${mutedClass}`}>
          Showing {Math.min(usersPage * USERS_PER_PAGE + 1, userSearchResults.length)}-{Math.min((usersPage + 1) * USERS_PER_PAGE, userSearchResults.length)} of {userSearchResults.length} users
          {userSearchQuery && ` (filtered from ${allUsers.length})`}
        </div>
      )}

      {/* Selected User Detail */}
      {selectedUser && !deleteMode && (
        <div className={`p-4 rounded-sm border-2 border-teal-500 ${darkMode ? 'bg-slate-700' : 'bg-teal-50'}`}>
          <div className="flex justify-between items-start mb-3">
            <div>
              <h3 className={`font-bold text-lg ${textClass}`}>{selectedUser.displayName}</h3>
              <p className={`text-xs ${mutedClass} font-mono`}>{selectedUser.id}</p>
            </div>
            <button
              onClick={() => setSelectedUser(null)}
              className={`text-xl ${mutedClass} hover:text-red-500`}
            >×</button>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className={`p-2 rounded ${darkMode ? 'bg-slate-600' : 'bg-white'}`}>
              <div className="flex items-center justify-between">
                <div className={`text-xs ${mutedClass}`}>Cash</div>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleSetCash(selectedUser.id, selectedUser.displayName || selectedUser.username)}
                    disabled={loading}
                    className="text-[10px] px-1.5 py-0.5 bg-yellow-600 hover:bg-yellow-700 text-white rounded disabled:opacity-50"
                  >Set</button>
                  <button
                    onClick={() => handleTransferToLadder(selectedUser.id, selectedUser.displayName || selectedUser.username)}
                    disabled={loading}
                    title="Transfer cash to/from this user's ladder game balance"
                    className="text-[10px] px-1.5 py-0.5 bg-purple-600 hover:bg-purple-700 text-white rounded disabled:opacity-50"
                  >→ Ladder</button>
                </div>
              </div>
              <div className={`font-bold ${isNaN(selectedUser.cash) ? 'text-red-500' : 'text-green-500'}`}>
                {isNaN(selectedUser.cash) ? '$NaN' : `$${selectedUser.cash.toFixed(2)}`}
              </div>
            </div>
            <div className={`p-2 rounded ${darkMode ? 'bg-slate-600' : 'bg-white'}`}>
              <div className={`text-xs ${mutedClass}`}>Portfolio</div>
              <div className={`font-bold ${textClass}`}>${selectedUser.portfolioValue.toFixed(2)}</div>
            </div>
            <div className={`p-2 rounded ${darkMode ? 'bg-slate-600' : 'bg-white'}`}>
              <div className={`text-xs ${mutedClass}`}>Peak Value</div>
              <div className={`font-bold text-cyan-500`}>${(selectedUser.peakPortfolioValue || 0).toFixed(2)}</div>
            </div>
            <div className={`p-2 rounded ${darkMode ? 'bg-slate-600' : 'bg-white'}`}>
              <div className={`text-xs ${mutedClass}`}>Total P&L</div>
              <div className={`font-bold ${selectedUser.portfolioValue >= 1000 ? 'text-green-500' : 'text-red-500'}`}>
                {selectedUser.portfolioValue >= 1000 ? '+' : ''}${(selectedUser.portfolioValue - 1000).toFixed(2)}
              </div>
            </div>
          </div>

          {/* Sync Status */}
          {(() => {
            const liveValue = calculateLivePortfolioValue(selectedUser);
            const storedValue = selectedUser.portfolioValue || 0;
            const difference = liveValue !== null ? Math.abs(liveValue - storedValue) : 0;
            const isOutOfSync = difference > 0.01;
            const lastSynced = selectedUser.lastSyncedAt;

            return (
              <div className={`p-3 rounded mb-4 ${darkMode ? 'bg-slate-600' : 'bg-white'}`}>
                <div className="flex items-center justify-between mb-2">
                  <h4 className={`text-xs font-semibold uppercase ${mutedClass}`}>🔄 Sync Status</h4>
                  <button
                    onClick={() => handleSyncSingleUser(selectedUser.id)}
                    disabled={loading}
                    className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded disabled:opacity-50"
                  >
                    {loading ? '...' : 'Sync Now'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className={`text-xs ${mutedClass}`}>Stored Value</div>
                    <div className={`font-bold ${textClass}`}>${storedValue.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className={`text-xs ${mutedClass}`}>Calculated Value</div>
                    <div className={`font-bold ${liveValue !== null ? (isOutOfSync ? 'text-orange-500' : 'text-green-500') : mutedClass}`}>
                      {liveValue !== null ? `$${liveValue.toFixed(2)}` : 'N/A'}
                    </div>
                  </div>
                  <div>
                    <div className={`text-xs ${mutedClass}`}>Difference</div>
                    <div className={`font-bold ${isOutOfSync ? 'text-red-500' : 'text-green-500'}`}>
                      {liveValue !== null ? `$${difference.toFixed(2)}` : 'N/A'}
                    </div>
                  </div>
                  <div>
                    <div className={`text-xs ${mutedClass}`}>Status</div>
                    <div className={`font-bold text-xs ${isOutOfSync ? 'text-orange-500' : 'text-green-500'}`}>
                      {isOutOfSync ? '⚠️ Out of Sync' : '✅ Synced'}
                    </div>
                  </div>
                </div>

                {lastSynced && (
                  <div className={`mt-2 pt-2 border-t ${darkMode ? 'border-slate-500' : 'border-slate-200'} text-xs ${mutedClass}`}>
                    Last synced: {lastSynced instanceof Date ? lastSynced.toLocaleString() : new Date(lastSynced.seconds * 1000).toLocaleString()}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Financial Breakdown */}
          {(() => {
            const txLog = selectedUser.transactionLog || [];

            let tradingProfit = 0;
            let betProfit = 0;
            let checkinBonus = 0;
            let totalTrades = 0;
            let profitableTrades = 0;
            let totalBets = 0;
            let wonBets = 0;

            txLog.forEach(tx => {
              if (tx.type === 'SELL') {
                totalTrades++;
                const profit = (tx.totalRevenue || 0) - (tx.totalCost || 0);
                tradingProfit += profit;
                if (profit > 0) profitableTrades++;
              }
              if (tx.type === 'SHORT_CLOSE') {
                totalTrades++;
                const profit = tx.totalProfit || 0;
                tradingProfit += profit;
                if (profit > 0) profitableTrades++;
              }
              if (tx.type === 'CHECKIN') {
                checkinBonus += tx.bonus || 0;
              }
              if (tx.type === 'BET') {
                totalBets++;
              }
            });

            Object.values(selectedUser.bets || {}).forEach(bet => {
              if (bet.paid && bet.payout > 0) {
                betProfit += (bet.payout - bet.amount);
                wonBets++;
              } else if (bet.paid) {
                betProfit -= bet.amount;
              }
            });

            const holdingsValue = Object.entries(selectedUser.holdings || {}).reduce((sum, [ticker, shares]) => {
              const shareCount = typeof shares === 'number' ? shares : (shares?.shares || 0);
              return sum + (prices[ticker] || 0) * shareCount;
            }, 0);

            const totalCostBasis = Object.entries(selectedUser.costBasis || {}).reduce((sum, [ticker, cost]) => {
              const h = selectedUser.holdings || {};
              const shareCount = typeof h[ticker] === 'number' ? h[ticker] : (h[ticker]?.shares || 0);
              if (shareCount > 0 && typeof cost === 'number' && !isNaN(cost)) return sum + cost;
              return sum;
            }, 0);

            const unrealizedGains = holdingsValue - totalCostBasis;

            return (
              <div className={`p-3 rounded mb-4 ${darkMode ? 'bg-slate-600' : 'bg-white'}`}>
                <h4 className={`text-xs font-semibold uppercase ${mutedClass} mb-3`}>💰 Money Breakdown</h4>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className={mutedClass}>Trading Realized P&L:</span>
                    <span className={`font-bold ${tradingProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {tradingProfit >= 0 ? '+' : ''}${tradingProfit.toFixed(2)}
                    </span>
                  </div>
                  {totalTrades > 0 && (
                    <div className="flex justify-between pl-4">
                      <span className={`text-xs ${mutedClass}`}>
                        {totalTrades} trades • {profitableTrades} wins ({((profitableTrades / totalTrades) * 100).toFixed(0)}%)
                      </span>
                      <span className={`text-xs ${mutedClass}`}>
                        avg: ${(tradingProfit / totalTrades).toFixed(2)}/trade
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between">
                    <span className={mutedClass}>Holdings Unrealized:</span>
                    <span className={`font-bold ${unrealizedGains >= 0 ? 'text-cyan-500' : 'text-orange-500'}`}>
                      {unrealizedGains >= 0 ? '+' : ''}${unrealizedGains.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between pl-4">
                    <span className={`text-xs ${mutedClass}`}>
                      Cost basis: ${totalCostBasis.toFixed(2)} → Value: ${holdingsValue.toFixed(2)}
                    </span>
                  </div>

                  {totalBets > 0 && (
                    <>
                      <div className="flex justify-between">
                        <span className={mutedClass}>Betting Net:</span>
                        <span className={`font-bold ${betProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {betProfit >= 0 ? '+' : ''}${betProfit.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between pl-4">
                        <span className={`text-xs ${mutedClass}`}>
                          {wonBets}/{totalBets} bets won ({totalBets > 0 ? ((wonBets / totalBets) * 100).toFixed(0) : 0}%)
                        </span>
                      </div>
                    </>
                  )}

                  {checkinBonus > 0 && (
                    <div className="flex justify-between">
                      <span className={mutedClass}>Check-in Bonuses:</span>
                      <span className="font-bold text-blue-500">+${checkinBonus.toFixed(2)}</span>
                    </div>
                  )}

                  <div className={`flex justify-between pt-2 border-t ${darkMode ? 'border-slate-500' : 'border-slate-300'}`}>
                    <span className={`font-semibold ${textClass}`}>Total Income:</span>
                    <span className={`font-bold ${(tradingProfit + betProfit + checkinBonus) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {(tradingProfit + betProfit + checkinBonus) >= 0 ? '+' : ''}${(tradingProfit + betProfit + checkinBonus).toFixed(2)}
                    </span>
                  </div>

                  <div className={`pt-2 border-t ${darkMode ? 'border-slate-500' : 'border-slate-300'}`}>
                    <div className="flex justify-between text-xs">
                      <span className={mutedClass}>Total Trades:</span>
                      <span className={textClass}>{selectedUser.totalTrades || 0}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className={mutedClass}>Check-ins:</span>
                      <span className={textClass}>{selectedUser.totalCheckins || 0}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className={mutedClass}>Crew:</span>
                      <span className={textClass}>{selectedUser.crew || 'None'}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Margin/Loan Info */}
          {(selectedUser.marginEnabled || selectedUser.activeLoan) && (
            <div className={`p-2 rounded mb-4 ${darkMode ? 'bg-amber-900/30' : 'bg-amber-50'}`}>
              <h4 className={`text-xs font-semibold uppercase text-amber-500 mb-2`}>Debt Info</h4>
              {selectedUser.marginEnabled && (
                <div className="text-sm flex justify-between">
                  <span className={mutedClass}>Margin Used:</span>
                  <span className="text-amber-500 font-bold">${(selectedUser.marginUsed || 0).toFixed(2)}</span>
                </div>
              )}
              {selectedUser.activeLoan && (
                <div className="text-sm flex justify-between">
                  <span className={mutedClass}>Active Loan:</span>
                  <span className="text-red-500 font-bold">${selectedUser.activeLoan.principal?.toFixed(2) || '?'}</span>
                </div>
              )}
            </div>
          )}

          {/* Holdings */}
          {Object.keys(selectedUser.holdings).length > 0 && (
            <div className="mb-4">
              <h4 className={`text-xs font-semibold uppercase ${mutedClass} mb-2`}>Holdings (with P&L)</h4>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {Object.entries(selectedUser.holdings)
                  .map(([ticker, shares]) => {
                    const shareCount = typeof shares === 'number' ? shares : (shares?.shares || 0);
                    if (shareCount <= 0) return null;

                    const currentPrice = prices[ticker] || 0;
                    const currentValue = currentPrice * shareCount;
                    const avgCost = selectedUser.costBasis?.[ticker] || 0;
                    const totalCost = avgCost * shareCount;
                    const unrealizedPL = currentValue - totalCost;
                    const unrealizedPct = avgCost > 0 ? (((currentPrice - avgCost) / avgCost) * 100) : 0;

                    return { ticker, shareCount, currentPrice, currentValue, totalCost, avgCost, unrealizedPL, unrealizedPct };
                  })
                  .filter(h => h !== null)
                  .sort((a, b) => b.unrealizedPL - a.unrealizedPL)
                  .map(({ ticker, shareCount, currentPrice, currentValue, totalCost, avgCost, unrealizedPL, unrealizedPct }) => (
                    <div key={ticker} className={`text-sm p-2 rounded ${darkMode ? 'bg-slate-700' : 'bg-slate-100'}`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <span className={`font-semibold ${textClass}`}>{ticker}</span>
                          <span className={`ml-2 text-xs ${mutedClass}`}>{shareCount} shares</span>
                        </div>
                        <span className={`font-bold ${unrealizedPL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {unrealizedPL >= 0 ? '+' : ''}${unrealizedPL.toFixed(2)}
                        </span>
                      </div>
                      <div className={`text-xs ${mutedClass} mt-1`}>
                        Avg cost: ${avgCost.toFixed(2)} → Price: ${currentPrice.toFixed(2)} ({unrealizedPct >= 0 ? '+' : ''}{unrealizedPct.toFixed(1)}%)
                      </div>
                      <div className={`text-xs ${mutedClass}`}>
                        Total cost: ${totalCost.toFixed(2)} → Value: ${currentValue.toFixed(2)}
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
          )}

          {/* Shorts */}
          {Object.keys(selectedUser.shorts).length > 0 && (
            <div className="mb-4">
              <h4 className={`text-xs font-semibold uppercase text-red-400 mb-2`}>Short Positions</h4>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {Object.entries(selectedUser.shorts).map(([ticker, shortData]) => {
                  if (!shortData || shortData.shares <= 0) return null;
                  const entryPrice = shortData.costBasis || shortData.entryPrice || 0;
                  const currentPrice = prices[ticker] || entryPrice;
                  const pnl = (entryPrice - currentPrice) * shortData.shares;
                  const pnlPct = entryPrice > 0 ? ((pnl / (entryPrice * shortData.shares)) * 100) : 0;
                  return (
                    <div key={ticker} className={`text-sm p-2 rounded ${darkMode ? 'bg-slate-700' : 'bg-slate-100'}`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="text-red-400 font-semibold">{ticker}</span>
                          <span className={`ml-2 text-xs ${mutedClass}`}>{shortData.shares} shares short</span>
                        </div>
                        <span className={`font-bold ${pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                        </span>
                      </div>
                      <div className={`text-xs ${mutedClass} mt-1`}>
                        Entry: ${entryPrice?.toFixed(2)} → Current: ${currentPrice.toFixed(2)} ({pnl >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)
                      </div>
                      <div className={`text-xs ${mutedClass}`}>
                        Margin held: ${shortData.margin?.toFixed(2) || '0.00'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Bets */}
          {Object.keys(selectedUser.bets).length > 0 && (
            <div>
              <h4 className={`text-xs font-semibold uppercase ${mutedClass} mb-2`}>Bets</h4>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {Object.entries(selectedUser.bets).map(([predId, bet]) => (
                  <div key={predId} className={`text-sm ${textClass}`}>
                    <div className="flex justify-between">
                      <span className="font-mono text-xs">{predId}</span>
                      <span className="text-teal-500">${bet.amount}</span>
                    </div>
                    <div className={`text-xs ${mutedClass}`}>
                      {bet.option}
                      {bet.paid && (
                        <span className={bet.payout > 0 ? 'text-green-500 ml-2' : 'text-red-400 ml-2'}>
                          {bet.payout > 0 ? `Won $${bet.payout.toFixed(2)}` : 'Lost'}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Display Name Editor */}
          <div className={`p-3 rounded mb-4 ${darkMode ? 'bg-slate-600' : 'bg-white'}`}>
            <h4 className={`text-xs font-semibold uppercase ${mutedClass} mb-2`}>⚙️ Manual Tools</h4>
            <div className="space-y-2">
              <div>
                <label className={`text-xs ${mutedClass} block mb-1`}>Change Display Name:</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newDisplayName}
                    onChange={(e) => setNewDisplayName(e.target.value)}
                    placeholder={selectedUser.displayName}
                    className={`flex-1 px-2 py-1 text-sm rounded border ${
                      darkMode
                        ? 'bg-slate-700 border-slate-600 text-white'
                        : 'bg-white border-slate-300 text-slate-900'
                    }`}
                  />
                  <button
                    onClick={() => handleChangeDisplayName(selectedUser.id, newDisplayName)}
                    disabled={!newDisplayName || newDisplayName.trim().length === 0}
                    className={`px-3 py-1 text-xs font-semibold rounded ${
                      newDisplayName && newDisplayName.trim().length > 0
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-slate-400 text-slate-200 cursor-not-allowed'
                    }`}
                  >
                    Update
                  </button>
                </div>
              </div>

              <div>
                <label className={`text-xs ${mutedClass} block mb-1`}>Discord Verification Wall:</label>
                <div className="flex items-center gap-2">
                  <span className={`text-xs ${selectedUser.requiresDiscordLink ? 'text-orange-400' : mutedClass}`}>
                    {selectedUser.requiresDiscordLink
                      ? (selectedUser.discordId ? 'Flagged (already linked — wall inactive)' : 'Flagged — must link Discord')
                      : 'Not flagged'}
                  </span>
                  <button
                    onClick={() => handleToggleDiscordWall(selectedUser.id, selectedUser.displayName || selectedUser.username, !!selectedUser.requiresDiscordLink)}
                    disabled={loading}
                    className={`ml-auto px-3 py-1 text-xs font-semibold rounded disabled:opacity-50 ${
                      selectedUser.requiresDiscordLink
                        ? 'bg-slate-500 text-white hover:bg-slate-600'
                        : 'bg-orange-600 text-white hover:bg-orange-700'
                    }`}
                  >
                    {selectedUser.requiresDiscordLink ? 'Clear wall' : 'Require Discord'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Transaction Log */}
          {selectedUser.transactionLog && selectedUser.transactionLog.length > 0 && (
            <div className="mb-4">
              <h4 className={`text-xs font-semibold uppercase text-cyan-400 mb-2`}>Transaction Log (Last {selectedUser.transactionLog.length})</h4>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {[...selectedUser.transactionLog].reverse().map((tx, i) => (
                  <div key={i} className={`text-xs p-2 rounded ${darkMode ? 'bg-slate-700' : 'bg-slate-100'}`}>
                    <div className="flex justify-between items-start">
                      <span className={`font-semibold ${
                        tx.type === 'BUY' ? 'text-green-500' :
                        tx.type === 'SELL' ? 'text-red-400' :
                        tx.type === 'SHORT_OPEN' ? 'text-orange-500' :
                        tx.type === 'SHORT_CLOSE' ? 'text-amber-400' :
                        tx.type === 'CHECKIN' ? 'text-cyan-400' :
                        tx.type === 'BET' ? 'text-purple-400' :
                        'text-zinc-400'
                      }`}>
                        {tx.type}
                      </span>
                      <span className={mutedClass}>
                        {new Date(tx.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <div className={`${textClass} mt-1`}>
                      {tx.type === 'BUY' && `${tx.shares} ${tx.ticker} @ $${tx.pricePerShare?.toFixed(2)} = $${tx.totalCost?.toFixed(2)}`}
                      {tx.type === 'SELL' && `${tx.shares} ${tx.ticker} @ $${tx.pricePerShare?.toFixed(2)} = $${tx.totalRevenue?.toFixed(2)} (${tx.profitPercent >= 0 ? '+' : ''}${tx.profitPercent}%)`}
                      {tx.type === 'SHORT_OPEN' && `${tx.shares} ${tx.ticker} @ $${tx.entryPrice?.toFixed(2)}, margin $${tx.marginRequired?.toFixed(2)}`}
                      {tx.type === 'SHORT_CLOSE' && `${tx.shares} ${tx.ticker}, P&L: $${tx.totalProfit?.toFixed(2)}`}
                      {tx.type === 'CHECKIN' && `+$${tx.bonus} daily bonus`}
                      {tx.type === 'BET' && `$${tx.amount} on "${tx.option}"`}
                    </div>
                    <div className={`${mutedClass} mt-1 flex justify-between items-center`}>
                      <span>Cash: ${tx.cashBefore?.toFixed(2)} → ${tx.cashAfter?.toFixed(2)}</span>
                      <button
                        onClick={() => handleRollbackUser(selectedUser.id, tx)}
                        className="ml-2 px-2 py-0.5 text-xs bg-orange-600 text-white rounded hover:bg-orange-700"
                      >
                        ⏮ Rollback
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* User List */}
      {!selectedUser && userSearchResults.length > 0 && (
        <>
          <div className="space-y-1">
            {userSearchResults
              .slice(usersPage * USERS_PER_PAGE, (usersPage + 1) * USERS_PER_PAGE)
              .map((u, i) => {
                const isSelected = selectedForDeletion.has(u.id);
                const isAdminUser = ADMIN_UIDS.includes(u.id);

                return (
                  <div
                    key={u.id}
                    onClick={() => {
                      if (deleteMode) {
                        if (!isAdminUser) toggleUserForDeletion(u.id);
                      } else {
                        setSelectedUser(u);
                      }
                    }}
                    className={`p-2 rounded-sm cursor-pointer flex justify-between items-center ${
                      deleteMode && isSelected
                        ? 'bg-red-500/30 border border-red-500'
                        : deleteMode && isAdminUser
                        ? `${darkMode ? 'bg-slate-800 opacity-50' : 'bg-slate-200 opacity-50'} cursor-not-allowed`
                        : darkMode ? 'hover:bg-slate-700' : 'hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {deleteMode && (
                        <span className={`text-lg ${isSelected ? 'text-red-500' : mutedClass}`}>
                          {isSelected ? '☑' : isAdminUser ? '🔒' : '☐'}
                        </span>
                      )}
                      <div>
                        <span className={`font-semibold ${textClass}`}>{u.displayName}</span>
                        {isAdminUser && <span className="ml-2 text-xs text-amber-500">👑 Admin</span>}
                        {(u.isBankrupt || u.portfolioValue <= 100) && <span className="ml-2 text-xs text-red-500">💔 Bankrupt</span>}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-bold ${textClass}`}>${u.portfolioValue.toFixed(2)}</div>
                      <div className={`text-xs ${mutedClass}`}>Cash: ${u.cash.toFixed(2)}</div>
                    </div>
                  </div>
                );
              })}
          </div>

          {/* Pagination */}
          {userSearchResults.length > USERS_PER_PAGE && (
            <div className="flex justify-center items-center gap-2 pt-2">
              <button
                onClick={() => setUsersPage(0)}
                disabled={usersPage === 0}
                className={`px-2 py-1 text-xs rounded-sm ${
                  usersPage === 0 ? 'opacity-30 cursor-not-allowed' : ''
                } ${darkMode ? 'bg-slate-700 text-zinc-300' : 'bg-slate-200 text-zinc-600'}`}
              >
                ««
              </button>
              <button
                onClick={() => setUsersPage(p => Math.max(0, p - 1))}
                disabled={usersPage === 0}
                className={`px-3 py-1 text-xs rounded-sm ${
                  usersPage === 0 ? 'opacity-30 cursor-not-allowed' : ''
                } ${darkMode ? 'bg-slate-700 text-zinc-300' : 'bg-slate-200 text-zinc-600'}`}
              >
                ‹ Prev
              </button>
              <span className={`px-3 py-1 text-sm ${textClass}`}>
                Page {usersPage + 1} of {Math.ceil(userSearchResults.length / USERS_PER_PAGE)}
              </span>
              <button
                onClick={() => setUsersPage(p => Math.min(Math.ceil(userSearchResults.length / USERS_PER_PAGE) - 1, p + 1))}
                disabled={usersPage >= Math.ceil(userSearchResults.length / USERS_PER_PAGE) - 1}
                className={`px-3 py-1 text-xs rounded-sm ${
                  usersPage >= Math.ceil(userSearchResults.length / USERS_PER_PAGE) - 1 ? 'opacity-30 cursor-not-allowed' : ''
                } ${darkMode ? 'bg-slate-700 text-zinc-300' : 'bg-slate-200 text-zinc-600'}`}
              >
                Next ›
              </button>
              <button
                onClick={() => setUsersPage(Math.ceil(userSearchResults.length / USERS_PER_PAGE) - 1)}
                disabled={usersPage >= Math.ceil(userSearchResults.length / USERS_PER_PAGE) - 1}
                className={`px-2 py-1 text-xs rounded-sm ${
                  usersPage >= Math.ceil(userSearchResults.length / USERS_PER_PAGE) - 1 ? 'opacity-30 cursor-not-allowed' : ''
                } ${darkMode ? 'bg-slate-700 text-zinc-300' : 'bg-slate-200 text-zinc-600'}`}
              >
                »»
              </button>
            </div>
          )}
        </>
      )}

      {allUsers.length === 0 && (
        <p className={`text-center ${mutedClass} py-8`}>
          Click "Load" to fetch all users
        </p>
      )}
    </div>
  );
};

export default UsersTab;
