import { useState } from 'react';
import { CREWS } from '../../../../crews';
import CrewPin from '../../../../shared/components/CrewPin';
import { ACHIEVEMENTS, ACHIEVEMENT_MAP } from '../../../../constants/achievements';
import { CHARACTERS } from '../../../../characters';
import type { AdminCommonProps } from '../types';
import type { LoadedAdminUser } from '../../utils/adminShared';
import type { useAdminUserEdit } from '../../hooks/useAdminUserEdit';

// The odd one-off user fixes that used to mean opening the Firebase console:
// crew, achievements, margin, and a single holding.
const UserFieldEditor = ({
  mutedClass,
  loading,
  selectedUser,
  handleSetCrew,
  handleGrantAchievement,
  handleSetMargin,
  handleSetHolding,
  editTicker,
  setEditTicker,
  editShares,
  setEditShares,
  editCostBasis,
  setEditCostBasis,
}: Pick<AdminCommonProps, 'mutedClass' | 'loading'> &
  ReturnType<typeof useAdminUserEdit> & { selectedUser: LoadedAdminUser }) => {
  const [achievementId, setAchievementId] = useState('');
  const name = selectedUser.displayName || selectedUser.username || '';
  const owned = selectedUser.achievements || [];
  const marginUsed = selectedUser.marginUsed || 0;

  const fieldClass = `px-2 py-1 text-sm rounded border light:bg-white light:border-slate-300 light:text-slate-900 dark:bg-slate-700 dark:border-slate-600 dark:text-white`;

  return (
    <div className="p-3 rounded mb-4 light:bg-white dark:bg-slate-600">
      <h4 className={`text-xs font-semibold uppercase ${mutedClass} mb-2`}>🛠️ Direct Edits</h4>
      <div className="space-y-3">
        {/* Crew */}
        <div>
          <label className={`text-xs ${mutedClass} block mb-1`}>
            Crew:{' '}
            <span className="text-teal-400">
              {selectedUser.crew ? CREWS[selectedUser.crew]?.name || selectedUser.crew : 'none'}
            </span>
            {selectedUser.isCrewHead && <span className="ml-1 text-amber-400">(crew head)</span>}
          </label>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Crew">
            {[null, ...Object.values(CREWS)].map((c) => {
              const id = c?.id || '';
              const current = (selectedUser.crew || '') === id;
              return (
                <button
                  key={id || 'none'}
                  type="button"
                  onClick={() => !current && handleSetCrew(selectedUser.id, name, id, c?.name)}
                  disabled={loading}
                  aria-pressed={current}
                  className={`inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded border disabled:opacity-50 ${
                    current
                      ? 'border-teal-500 ring-1 ring-teal-500'
                      : 'light:border-slate-300 dark:border-slate-500 light:hover:border-slate-500 dark:hover:border-slate-300'
                  } light:bg-white light:text-slate-900 dark:bg-slate-700 dark:text-white`}
                >
                  {c && <CrewPin crew={c} className="w-4 h-4" />}
                  {c ? c.name : 'No crew'}
                </button>
              );
            })}
          </div>
        </div>

        {/* Achievements */}
        <div>
          <label className={`text-xs ${mutedClass} block mb-1`}>Grant achievement ({owned.length} earned):</label>
          <div className="flex gap-2">
            <select
              aria-label="Achievement to grant"
              value={achievementId}
              onChange={(e) => setAchievementId(e.target.value)}
              className={`flex-1 ${fieldClass}`}
            >
              <option value="">— pick one —</option>
              {Object.values(ACHIEVEMENTS).map((a) => (
                <option key={a.id} value={a.id}>
                  {owned.includes(a.id) ? '✓ ' : ''}
                  {a.name}
                </option>
              ))}
            </select>
            <button
              onClick={() =>
                handleGrantAchievement(
                  selectedUser.id,
                  name,
                  achievementId,
                  ACHIEVEMENT_MAP[achievementId]?.name || achievementId,
                )
              }
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
            Margin:{' '}
            <span className={selectedUser.marginEnabled ? 'text-green-400' : mutedClass}>
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
              aria-label="Holding ticker"
              value={editTicker}
              onChange={(e) => setEditTicker(e.target.value)}
              className={`flex-1 min-w-[110px] ${fieldClass}`}
            >
              <option value="">— ticker —</option>
              {CHARACTERS.map((c) => (
                <option key={c.ticker} value={c.ticker}>
                  {c.ticker}
                  {(selectedUser.holdings || {})[c.ticker] ? ` (${(selectedUser.holdings || {})[c.ticker]})` : ''}
                </option>
              ))}
            </select>
            <input
              aria-label="Shares"
              type="number"
              min="0"
              step="any"
              value={editShares}
              onChange={(e) => setEditShares(e.target.value)}
              placeholder="shares"
              className={`w-24 ${fieldClass}`}
            />
            <input
              aria-label="Cost basis"
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
            Leave cost basis blank to keep the current one. Hit Sync above afterwards so their portfolio value catches
            up.
          </p>
        </div>
      </div>
    </div>
  );
};

export default UserFieldEditor;
