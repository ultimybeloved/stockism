import { useState } from 'react';
import { changeDisplayNameFunction } from '../../firebase';
import { COSMETIC_MAP } from '../../constants/cosmetics';
import { validateUsername } from '../../utils/username';
import { getThemeClasses } from '../../utils/theme';

// Profile card header: display name (with cosmetics) and the name-change form.
// Owns the name-edit state and the 2-week cooldown logic.
const ProfileHeader = ({ userData, darkMode }) => {
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const { textClass, mutedClass } = getThemeClasses(darkMode);

  const nameChangedAt = userData?.nameChangedAt?.toDate?.() || null;
  const cooldownMs = 14 * 24 * 60 * 60 * 1000;
  const msSinceChange = nameChangedAt ? Date.now() - nameChangedAt.getTime() : Infinity;
  const daysUntilChange = msSinceChange < cooldownMs ? Math.ceil((cooldownMs - msSinceChange) / (24 * 60 * 60 * 1000)) : 0;
  const canChangeName = daysUntilChange === 0;

  const handleNameSave = async () => {
    setNameError('');
    const formatError = validateUsername(newName.trim());
    if (formatError) {
      setNameError(formatError);
      return;
    }
    setNameSaving(true);
    try {
      await changeDisplayNameFunction({ displayName: newName });
      setEditingName(false);
      setNewName('');
    } catch (err) {
      setNameError(err.message || 'Failed to change name.');
    }
    setNameSaving(false);
  };

  const ac = userData?.activeCosmetics || {};
  const nameColorC   = ac.nameColor   ? COSMETIC_MAP[ac.nameColor]   : null;
  const rowGlowC     = ac.rowGlow     ? COSMETIC_MAP[ac.rowGlow]     : null;
  const rowBackdropC = ac.rowBackdrop ? COSMETIC_MAP[ac.rowBackdrop] : null;

  return (
    <div
      className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}
      style={{
        ...(rowGlowC     ? { boxShadow: `0 0 24px ${rowGlowC.color}40` } : {}),
        ...(rowBackdropC ? { backgroundColor: darkMode ? `${rowBackdropC.color}18` : `${rowBackdropC.color}12` } : {}),
      }}
    >
      <h2 className={`text-lg font-semibold ${textClass}`}>
        👤 <span style={{ color: nameColorC?.color }}>{userData?.displayName}</span>
      </h2>
      <p className={`text-sm ${mutedClass}`}>Profile & Stats</p>

      {!editingName ? (
        <div className="mt-3">
          {canChangeName ? (
            <button
              onClick={() => { setEditingName(true); setNewName(userData?.displayName || ''); setNameError(''); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-sm border ${darkMode ? 'border-zinc-600 text-zinc-300 hover:border-orange-500 hover:text-orange-500' : 'border-slate-300 text-slate-600 hover:border-orange-500 hover:text-orange-500'} transition-colors`}
            >
              ✏️ Change name — $10,000
            </button>
          ) : (
            <p className={`text-xs ${mutedClass}`}>Name change available in {daysUntilChange} day{daysUntilChange === 1 ? '' : 's'}</p>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            maxLength={20}
            placeholder="New username"
            className={`w-full px-3 py-1.5 text-sm rounded-sm border ${darkMode ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'bg-white border-slate-300 text-slate-900'} focus:outline-none focus:border-orange-500`}
          />
          {nameError && <p className="text-xs text-red-500">{nameError}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleNameSave}
              disabled={nameSaving || !newName.trim()}
              className="flex-1 py-1.5 text-xs font-semibold rounded-sm bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-50"
            >
              {nameSaving ? 'Saving…' : 'Confirm — $10,000'}
            </button>
            <button
              onClick={() => { setEditingName(false); setNameError(''); }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-sm ${darkMode ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}
            >
              Cancel
            </button>
          </div>
          <p className={`text-xs ${mutedClass}`}>3-20 chars, at least 3 letters/numbers, up to 2 underscores. Once every 2 weeks.</p>
        </div>
      )}
    </div>
  );
};

export default ProfileHeader;
