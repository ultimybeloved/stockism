// Account recovery for players who lost their Discord account.
//
// Discord is a login provider here, so a Discord suspension locks the player out
// of Stockism entirely. They come back on a new Discord and make a fresh
// account. Instead of migrating a portfolio between accounts, this points the
// new Discord at the original account: discordAuth looks players up by Discord
// ID, so their next login lands in the account they already had.
//
// The selected user is the ORIGINAL account. The ID pasted here is the new
// throwaway one.
const DiscordLinkTransfer = ({
  darkMode, mutedClass, loading, selectedUser,
  moveSourceId, setMoveSourceId, moveSource, handleLookupMoveSource, handleMoveDiscordLink,
}) => {
  const targetName = selectedUser.displayName || selectedUser.username;
  const sameAccount = moveSource && moveSource.id === selectedUser.id;

  return (
    <div className={`mt-3 pt-3 border-t ${darkMode ? 'border-slate-500' : 'border-slate-200'}`}>
      <label className={`text-xs ${mutedClass} block mb-1`}>Recover this account (move a Discord onto it):</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={moveSourceId}
          onChange={(e) => setMoveSourceId(e.target.value)}
          placeholder="New account: name, Discord, or user ID"
          className={`flex-1 px-2 py-1 text-sm rounded border ${
            darkMode
              ? 'bg-slate-700 border-slate-600 text-white'
              : 'bg-white border-slate-300 text-slate-900'
          }`}
        />
        <button
          onClick={() => handleLookupMoveSource(moveSourceId)}
          disabled={loading || !moveSourceId.trim()}
          className="px-3 py-1 text-xs font-semibold rounded bg-slate-500 text-white hover:bg-slate-600 disabled:opacity-50"
        >
          Look up
        </button>
      </div>

      {moveSource && (
        <div className={`mt-2 p-2 rounded text-xs ${darkMode ? 'bg-slate-700' : 'bg-slate-100'}`}>
          <div className="font-semibold text-indigo-400">{moveSource.displayName}</div>
          <div className={mutedClass}>
            Discord: {moveSource.discordUsername || moveSource.discordId || 'none linked'}
          </div>
          <div className={mutedClass}>
            Cash ${moveSource.cash.toFixed(2)} · Portfolio ${moveSource.portfolioValue.toFixed(2)}
            {moveSource.createdAt && ` · joined ${moveSource.createdAt.toLocaleDateString()}`}
          </div>

          {sameAccount && <div className="mt-1 text-orange-400">That's the account you already have open.</div>}
          {!sameAccount && !moveSource.discordId && (
            <div className="mt-1 text-orange-400">No Discord on this account, so there is nothing to move.</div>
          )}
          {!sameAccount && moveSource.discordId && (
            <>
              <div className={`mt-2 ${mutedClass}`}>
                This Discord starts logging in as <span className="font-semibold">{targetName}</span>.
                No cash or shares move. <span className="font-semibold">{moveSource.displayName}</span> loses
                its login permanently.
              </div>
              <button
                onClick={() => handleMoveDiscordLink(selectedUser.id, targetName)}
                disabled={loading}
                className="mt-2 px-3 py-1 text-xs font-semibold rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Move link to {targetName}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default DiscordLinkTransfer;
