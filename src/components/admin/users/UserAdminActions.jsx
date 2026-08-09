import UserCosmeticsPanel from '../UserCosmeticsPanel';
import DiscordLinkTransfer from './DiscordLinkTransfer';
import UserFieldEditor from './UserFieldEditor';

// Extracted from UsersTab.jsx, which was past the 400-line component limit.
const UserAdminActions = ({ darkMode, textClass, mutedClass, inputClass, loading, selectedUser, handleToggleDiscordWall, handleUnlinkDiscord, handleGrantCosmetic, handleRevokeCosmetic, handleChangeDisplayName, newDisplayName, setNewDisplayName, handleRollbackUser, moveSourceId, setMoveSourceId, moveSource, handleLookupMoveSource, handleMoveDiscordLink, freeDiscordId, setFreeDiscordId, handleFreeDiscord, handleSetCrew, handleGrantAchievement, handleSetMargin, handleSetHolding, editTicker, setEditTicker, editShares, setEditShares, editCostBasis, setEditCostBasis }) => (
  <>
    {/* Crew, achievements, margin, holdings — the direct Firestore edits */}
    <UserFieldEditor {...{ darkMode, mutedClass, loading, selectedUser, handleSetCrew, handleGrantAchievement, handleSetMargin, handleSetHolding, editTicker, setEditTicker, editShares, setEditShares, editCostBasis, setEditCostBasis }} />

    {/* Cosmetics (give/revoke for giveaways) */}
    <UserCosmeticsPanel
      darkMode={darkMode}
      textClass={textClass}
      mutedClass={mutedClass}
      inputClass={inputClass}
      loading={loading}
      selectedUser={selectedUser}
      handleGrantCosmetic={handleGrantCosmetic}
      handleRevokeCosmetic={handleRevokeCosmetic}
    />

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

        <div>
          <label className={`text-xs ${mutedClass} block mb-1`}>Linked Discord:</label>
          <div className="flex items-center gap-2">
            <span className={`text-xs ${selectedUser.discordId ? 'text-indigo-400' : mutedClass}`}>
              {selectedUser.discordId
                ? (selectedUser.discordUsername || selectedUser.discordId)
                : 'None linked'}
            </span>
            {selectedUser.discordId && (
              <button
                onClick={() => handleUnlinkDiscord(selectedUser.id, selectedUser.displayName || selectedUser.username, selectedUser.discordUsername)}
                disabled={loading}
                className="ml-auto px-3 py-1 text-xs font-semibold rounded disabled:opacity-50 bg-red-600 text-white hover:bg-red-700"
              >
                Unlink
              </button>
            )}
          </div>
          <p className={`text-xs ${mutedClass} mt-1`}>
            Players can't swap Discord accounts themselves. Unlink here if someone lost access to theirs.
          </p>

          <DiscordLinkTransfer {...{ darkMode, mutedClass, loading, selectedUser, moveSourceId, setMoveSourceId, moveSource, handleLookupMoveSource, handleMoveDiscordLink, freeDiscordId, setFreeDiscordId, handleFreeDiscord }} />
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
  </>
);

export default UserAdminActions;
