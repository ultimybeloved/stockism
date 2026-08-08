import { useState } from 'react';
import { CREWS } from '../../../crews';
import { ACHIEVEMENTS } from '../../../constants/achievements';
import { CHARACTERS } from '../../../characters';

// The odd one-off user fixes that used to mean opening the Firebase console:
// crew, achievements, margin, and a single holding.
const UserFieldEditor = ({
  darkMode, mutedClass, loading, selectedUser,
  handleSetCrew, handleGrantAchievement, handleSetMargin, handleSetHolding,
  editTicker, setEditTicker, editShares, setEditShares, editCostBasis, setEditCostBasis,
}) => {
  const [achievementId, setAchievementId] = useState('');
  const name = selectedUser.displayName || selectedUser.username;
  const owned = selectedUser.achievements || [];
  const marginUsed = selectedUser.marginUsed || 0;

  const fieldClass = `px-2 py-1 text-sm rounded border ${
    darkMode ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300 text-slate-900'
  }`;

  return (
    <div className={`p-3 rounded mb-4 ${darkMode ? 'bg-slate-600' : 'bg-white'}`}>
      <h4 className={`text-xs font-semibold uppercase ${mutedClass} mb-2`}>🛠️ Direct Edits</h4>
      <div className="space-y-3">

        {/* Crew */}
        <div>
          <label className={`text-xs ${mutedClass} block mb-1`}>
            Crew: <span className="text-teal-400">{selectedUser.crew ? (CREWS[selectedUser.crew]?.name || selectedUser.crew) : 'none'}</span>
            {selectedUser.isCrewHead && <span className="ml-1 text-amber-400">(crew head)</span>}
          </label>
          <select
            value={selectedUser.crew || ''}
            onChange={(e) => handleSetCrew(selectedUser.id, name, e.target.value, CREWS[e.target.value]?.name)}
            disabled={loading}
            className={`w-full ${fieldClass}`}
          >
            <option value="">— no crew —</option>
            {Object.values(CREWS).map(c => (
              <option key={c.id} value={c.id}>{c.emblem} {c.name}</option>
            ))}
          </select>
        </div>

        {/* Achievements */}
        <div>
          <label className={`text-xs ${mutedClass} block mb-1`}>Grant achievement ({owned.length} earned):</label>
          <div className="flex gap-2">
            <select
              value={achievementId}
              onChange={(e) => setAchievementId(e.target.value)}
              className={`flex-1 ${fieldClass}`}
            >
              <option value="">— pick one —</option>
              {Object.values(ACHIEVEMENTS).map(a => (
                <option key={a.id} value={a.id}>{owned.includes(a.id) ? '✓ ' : ''}{a.name}</option>
              ))}
            </select>
            <button
              onClick={() => handleGrantAchievement(selectedUser.id, name, achievementId, ACHIEVEMENTS[achievementId]?.name || achievementId)}
              disabled={loading || !achievementId}
              className="px-3 py-1 text-xs font-semibold rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              Grant
            </button>
          </div>
        </div>

        {/* Margin */}
        <div>
          <label className={`text-xs ${mutedClass} block mb-1`}>
            Margin: <span className={selectedUser.marginEnabled ? 'text-green-400' : mutedClass}>
              {selectedUser.marginEnabled ? 'enabled' : 'disabled'}
            </span>
            {marginUsed > 0 && <span className="text-red-400"> · owes ${marginUsed.toFixed(2)}</span>}
          </label>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => handleSetMargin(selectedUser.id, name, !selectedUser.marginEnabled, false)}
              disabled={loading}
              className="px-3 py-1 text-xs font-semibold rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {selectedUser.marginEnabled ? 'Disable' : 'Enable'}
            </button>
            {marginUsed > 0 && (
              <button
                onClick={() => handleSetMargin(selectedUser.id, name, !!selectedUser.marginEnabled, true)}
                disabled={loading}
                className="px-3 py-1 text-xs font-semibold rounded bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50"
              >
                Clear ${marginUsed.toFixed(2)} debt
              </button>
            )}
          </div>
        </div>

        {/* Holdings */}
        <div>
          <label className={`text-xs ${mutedClass} block mb-1`}>Set a holding (0 shares removes it):</label>
          <div className="flex gap-2 flex-wrap">
            <select
              value={editTicker}
              onChange={(e) => setEditTicker(e.target.value)}
              className={`flex-1 min-w-[110px] ${fieldClass}`}
            >
              <option value="">— ticker —</option>
              {CHARACTERS.map(c => (
                <option key={c.ticker} value={c.ticker}>
                  {c.ticker}{(selectedUser.holdings || {})[c.ticker] ? ` (${(selectedUser.holdings || {})[c.ticker]})` : ''}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              step="any"
              value={editShares}
              onChange={(e) => setEditShares(e.target.value)}
              placeholder="shares"
              className={`w-24 ${fieldClass}`}
            />
            <input
              type="number"
              min="0"
              step="any"
              value={editCostBasis}
              onChange={(e) => setEditCostBasis(e.target.value)}
              placeholder="cost basis"
              className={`w-28 ${fieldClass}`}
            />
            <button
              onClick={() => handleSetHolding(selectedUser.id, name)}
              disabled={loading || !editTicker || editShares === ''}
              className="px-3 py-1 text-xs font-semibold rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
            >
              Set
            </button>
          </div>
          <p className={`text-xs ${mutedClass} mt-1`}>
            Leave cost basis blank to keep the current one. Hit Sync above afterwards so their portfolio value catches up.
          </p>
        </div>

      </div>
    </div>
  );
};

export default UserFieldEditor;
