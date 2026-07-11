import { useState } from 'react';
import { COSMETICS, COSMETIC_MAP, COSMETIC_TYPES, COSMETIC_TYPE_LABELS } from '../../constants/cosmetics';

// Cosmetics section of the selected-user card in the admin Users tab.
// Give any cosmetic for free (giveaways) or take one back, no Firebase console needed.
const UserCosmeticsPanel = ({
  darkMode,
  textClass,
  mutedClass,
  inputClass,
  loading,
  selectedUser,
  handleGrantCosmetic,
  handleRevokeCosmetic,
}) => {
  const [pickedCosmetic, setPickedCosmetic] = useState('');

  const owned = selectedUser.ownedCosmetics || [];
  const active = selectedUser.activeCosmetics || {};

  return (
    <div className={`p-3 rounded mb-4 ${darkMode ? 'bg-slate-600' : 'bg-white'}`}>
      <h4 className={`text-xs font-semibold uppercase ${mutedClass} mb-2`}>🎨 Cosmetics ({owned.length} owned)</h4>

      {/* Give a cosmetic */}
      <div className="flex gap-2 mb-3">
        <select
          value={pickedCosmetic}
          onChange={e => setPickedCosmetic(e.target.value)}
          className={`flex-1 px-2 py-1 text-sm border rounded ${inputClass}`}
        >
          <option value="">Pick a cosmetic to give...</option>
          {COSMETIC_TYPES.map(type => (
            <optgroup key={type} label={COSMETIC_TYPE_LABELS[type]}>
              {COSMETICS.filter(c => c.type === type).map(c => (
                <option key={c.id} value={c.id} disabled={owned.includes(c.id)}>
                  {c.name} (${c.price.toLocaleString()}){owned.includes(c.id) ? ' — owned' : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          onClick={() => {
            handleGrantCosmetic(selectedUser.id, selectedUser.displayName || selectedUser.username, pickedCosmetic);
            setPickedCosmetic('');
          }}
          disabled={loading || !pickedCosmetic}
          className="px-3 py-1 text-xs font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded disabled:opacity-50"
        >
          🎁 Give Free
        </button>
      </div>

      {/* Owned cosmetics */}
      {owned.length === 0 ? (
        <p className={`text-xs ${mutedClass}`}>No cosmetics owned.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {owned.map(id => {
            const c = COSMETIC_MAP[id];
            const isEquipped = c && active[c.type] === id;
            return (
              <span
                key={id}
                className={`inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-full ${
                  darkMode ? 'bg-slate-700' : 'bg-slate-100'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: c?.color || '#94A3B8' }}
                />
                <span className={textClass}>{c?.name || id}</span>
                {isEquipped && <span className="text-teal-500 font-semibold">on</span>}
                <button
                  onClick={() => handleRevokeCosmetic(selectedUser.id, selectedUser.displayName || selectedUser.username, id)}
                  disabled={loading}
                  title="Take this cosmetic away"
                  className={`${mutedClass} hover:text-red-500 disabled:opacity-50`}
                >×</button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default UserCosmeticsPanel;
