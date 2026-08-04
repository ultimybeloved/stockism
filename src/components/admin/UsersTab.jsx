import { CHARACTERS } from '../../characters';
import { ADMIN_UIDS } from '../../constants';
import UserFinancials from './users/UserFinancials';
import UserPositions from './users/UserPositions';
import UserAdminActions from './users/UserAdminActions';

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
  handleUnlinkDiscord,
  handleGrantCosmetic,
  handleRevokeCosmetic,
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
          placeholder="Search by name, ID, or Discord..."
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
                Object.values(user.shorts).forEach((position) => {
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
              {selectedUser.discordId && (
                <p className={`text-xs ${mutedClass} font-mono`}>
                  💬 Discord: {selectedUser.discordUsername || selectedUser.discordId}
                  {selectedUser.discordUsername && ` (${selectedUser.discordId})`}
                </p>
              )}
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

          <UserFinancials {...{ darkMode, textClass, mutedClass, loading, prices, selectedUser, calculateLivePortfolioValue, handleSyncSingleUser }} />
          <UserPositions {...{ darkMode, textClass, mutedClass, prices, selectedUser }} />
          <UserAdminActions {...{ darkMode, textClass, mutedClass, inputClass, loading, selectedUser, handleToggleDiscordWall, handleUnlinkDiscord, handleGrantCosmetic, handleRevokeCosmetic, handleChangeDisplayName, newDisplayName, setNewDisplayName, handleRollbackUser }} />
        </div>
      )}

      {/* User List */}
      {!selectedUser && userSearchResults.length > 0 && (
        <>
          <div className="space-y-1">
            {userSearchResults
              .slice(usersPage * USERS_PER_PAGE, (usersPage + 1) * USERS_PER_PAGE)
              .map((u) => {
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
