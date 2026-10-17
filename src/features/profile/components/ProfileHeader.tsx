import { useState } from 'react';
import { changeDisplayNameFunction } from '../../../api/callables';
import { getCosmeticStyles, getActiveTitle } from '../../../utils/cosmetics';
import { frameTrend as frameTrendOf } from '../../../rules/cosmetics';
import TitleText from '../../../shared/components/TitleText';
import CosmeticLayers from '../../../shared/components/cosmetics/CosmeticLayers';
import CosmeticName from '../../../shared/components/cosmetics/CosmeticName';
import { validateUsername } from '../../../utils/username';
import { themeClasses } from '../../../utils/theme';
import { errorMessage } from '../../../utils/errors';
import type { UserData } from '../../../types';
import PixelIcon from '../../../shared/components/PixelIcon';

// Profile card header: display name (with cosmetics), the customization
// shortcut, and the name-change form. Owns the name-edit state and the 2-week
// cooldown logic.
const ProfileHeader = ({
  userData,
  onOpenCustomization,
}: {
  userData: UserData | null;
  onOpenCustomization: () => void;
}) => {
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const { textClass, mutedClass } = themeClasses;

  const nameChangedAt = (userData?.nameChangedAt as { toDate?: () => Date } | undefined)?.toDate?.() || null;
  const cooldownMs = 14 * 24 * 60 * 60 * 1000;
  const msSinceChange = nameChangedAt ? Date.now() - nameChangedAt.getTime() : Infinity;
  const daysUntilChange =
    msSinceChange < cooldownMs ? Math.ceil((cooldownMs - msSinceChange) / (24 * 60 * 60 * 1000)) : 0;
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
      setNameError(errorMessage(err) || 'Failed to change name.');
    }
    setNameSaving(false);
  };

  const cosmetics = getCosmeticStyles(userData?.activeCosmetics, userData?.ownedCosmetics, {
    seedKey: userData?.displayName,
    trend: frameTrendOf(userData?.portfolioValue, userData?.portfolioSnapshot24h),
    style: userData?.cosmeticStyle,
  });
  const { glowColor, rowClass, rowStyle, frameTrend, layers } = cosmetics;
  const activeTitle = getActiveTitle(userData);

  return (
    <div
      className={`relative p-4 border-b light:border-amber-200 dark:border-zinc-800 ${rowClass}`}
      data-trend={frameTrend}
      style={{
        ...rowStyle,
        ...(glowColor ? { boxShadow: `0 0 24px ${glowColor}40` } : {}),
      }}
    >
      <CosmeticLayers {...layers} seedKey={userData?.displayName} />
      <h2 className={`text-lg font-semibold ${textClass}`}>
        <PixelIcon name="profile" className="w-5 h-5 mr-1.5 align-[-3px]" />
        <CosmeticName name={userData?.displayName || ''} styles={cosmetics} />
      </h2>
      <TitleText title={activeTitle} className="text-sm" />
      <p className={`text-sm ${mutedClass}`}>Profile & Stats</p>

      {!editingName ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {onOpenCustomization && (
            <button
              onClick={onOpenCustomization}
              className="px-3 py-1.5 text-xs font-semibold rounded-sm border light:border-slate-300 light:text-slate-600 light:hover:border-orange-500 light:hover:text-orange-500 dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-orange-500 dark:hover:text-orange-500 transition-colors"
            >
              <PixelIcon name="palette" className="w-3.5 h-3.5 mr-1 align-[-2px]" />
              Customize
            </button>
          )}
          {canChangeName ? (
            <button
              onClick={() => {
                setEditingName(true);
                setNewName(userData?.displayName || '');
                setNameError('');
              }}
              className="px-3 py-1.5 text-xs font-semibold rounded-sm border light:border-slate-300 light:text-slate-600 light:hover:border-orange-500 light:hover:text-orange-500 dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-orange-500 dark:hover:text-orange-500 transition-colors"
            >
              <PixelIcon name="pencil" className="w-3.5 h-3.5 mr-1 align-[-2px]" />
              Change name ($10,000)
            </button>
          ) : (
            <p className={`text-xs ${mutedClass}`}>
              Name change available in {daysUntilChange} day{daysUntilChange === 1 ? '' : 's'}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <input
            aria-label="New username"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={20}
            placeholder="New username"
            className="w-full px-3 py-1.5 text-sm rounded-sm border light:bg-white light:border-slate-300 light:text-slate-900 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100 focus:outline-none focus:border-orange-500"
          />
          {nameError && (
            <p role="alert" className="text-xs text-red-500">
              {nameError}
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleNameSave}
              disabled={nameSaving || !newName.trim()}
              className="flex-1 py-1.5 text-xs font-semibold rounded-sm bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-50"
            >
              {nameSaving ? 'Saving…' : 'Confirm ($10,000)'}
            </button>
            <button
              onClick={() => {
                setEditingName(false);
                setNameError('');
              }}
              className="flex-1 py-1.5 text-xs font-semibold rounded-sm light:bg-slate-200 light:hover:bg-slate-300 light:text-slate-700 dark:bg-zinc-700 dark:hover:bg-zinc-600 dark:text-zinc-200"
            >
              Cancel
            </button>
          </div>
          <p className={`text-xs ${mutedClass}`}>
            3-20 chars, at least 3 letters/numbers, up to 2 underscores. Once every 2 weeks.
          </p>
        </div>
      )}
    </div>
  );
};

export default ProfileHeader;
