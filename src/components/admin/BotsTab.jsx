
const BotsTab = ({
  darkMode,
  textClass,
  mutedClass,
  loading,
  prices,
  bots,
  botsLoading,
  handleDeleteBot,
  handleCreateBots,
}) => {
  return (
    <div className="space-y-4">
      <div className={`p-3 rounded-sm ${darkMode ? 'bg-purple-900/20' : 'bg-purple-50'}`}>
        <div className="flex justify-between items-center gap-3">
          <p className={`text-sm ${mutedClass}`}>
            🤖 Bot traders. Creating is safe to repeat, existing bots are skipped.
          </p>
          <button
            onClick={handleCreateBots}
            disabled={loading}
            className="px-3 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-sm disabled:opacity-50 whitespace-nowrap"
            title="Create any missing bots from the standard roster"
          >
            {loading ? '...' : '➕ Create Bots'}
          </button>
        </div>
      </div>

      {/* Bot List */}
      {bots.length > 0 && (
        <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <h3 className={`text-sm font-semibold ${textClass} mb-3`}>Active Bots ({bots.length})</h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {bots.map(bot => {
              const holdingsValue = Object.entries(bot.holdings || {}).reduce((sum, [ticker, shares]) => {
                const shareCount = typeof shares === 'number' ? shares : (shares?.shares || 0);
                return sum + (prices[ticker] || 0) * shareCount;
              }, 0);

              return (
                <div key={bot.id} className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700' : 'bg-slate-100'}`}>
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`font-semibold ${textClass}`}>{bot.displayName}</span>
                        <span className="text-xs px-2 py-0.5 rounded bg-purple-600 text-white">
                          {bot.botPersonality}
                        </span>
                        {bot.botCrew && (
                          <span className="text-xs px-2 py-0.5 rounded bg-blue-600 text-white">
                            {bot.botCrew}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-4 gap-3 mt-2 text-xs">
                        <div>
                          <span className={mutedClass}>Cash:</span>
                          <span className={`ml-1 font-semibold text-green-500`}>
                            ${bot.cash?.toFixed(2) || '0.00'}
                          </span>
                        </div>
                        <div>
                          <span className={mutedClass}>Holdings:</span>
                          <span className={`ml-1 font-semibold ${textClass}`}>
                            ${holdingsValue.toFixed(2)}
                          </span>
                        </div>
                        <div>
                          <span className={mutedClass}>Portfolio:</span>
                          <span className={`ml-1 font-semibold ${textClass}`}>
                            ${bot.portfolioValue?.toFixed(2) || '0.00'}
                          </span>
                        </div>
                        <div>
                          <span className={mutedClass}>Trades:</span>
                          <span className={`ml-1 font-semibold ${textClass}`}>
                            {bot.totalTrades || 0}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteBot(bot.id)}
                      className="ml-3 px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {bots.length === 0 && !botsLoading && (
        <p className={`text-center ${mutedClass} py-8`}>
          No bots found.
        </p>
      )}
    </div>
  );
};

export default BotsTab;
