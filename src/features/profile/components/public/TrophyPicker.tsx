// Choosing what goes in your trophy case: everything you own, grouped, tap to
// add or remove. The order you pick is the order on the shelf. The server
// checks ownership again on save (setTrophyCase).
import { useState } from 'react';
import { useSession } from '../../../../context/AppContext';
import { setTrophyCaseFunction } from '../../../../api/callables';
import { COSMETIC_MAP } from '../../../../constants/cosmetics';
import { headReign, ownedTrophies, TROPHY_SLOTS, type TrophySource } from '../../../../rules/trophies';
import SheetHandle from '../../../../shared/components/SheetHandle';
import { useSheetRef } from '../../../../shared/hooks/useSwipeToClose';
import { useEscapeKey } from '../../../../shared/hooks/useEscapeKey';
import { themeClasses } from '../../../../utils/theme';
import { trophyView } from './TrophyArt';

const { sheetOverlayClass, sheetShellClass, textClass, mutedClass, borderClass, ghostBtnClass } = themeClasses;

interface TrophyPickerProps {
  current: string[];
  onClose: () => void;
  onSaved: (trophyCase: string[]) => void;
}

const TrophyPicker = ({ current, onClose, onSaved }: TrophyPickerProps) => {
  const { userData } = useSession();
  const [picked, setPicked] = useState<string[]>(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sheetRef = useSheetRef(onClose);
  useEscapeKey(onClose);

  const src = (userData || {}) as TrophySource;
  const owned = ownedTrophies(src);
  const titleMeta = (userData?.titleMeta || {}) as Record<string, string>;
  const ctx = { seedKey: userData?.displayName || 'You', titles: titleMeta, headReign: headReign(src), compact: true };
  const cosOf = (type: string) => owned.cos.filter((id) => COSMETIC_MAP[id.slice(4)]?.type === type);
  const groups: [string, string[]][] = [
    ['Crew head', owned.head],
    ['Season titles', owned.title],
    ['Names', cosOf('nameColor')],
    ['Effects', cosOf('rowGlow')],
    ['Frames', cosOf('rowFrame')],
    ['Backdrops', cosOf('rowBackdrop')],
    ['Pins', owned.pin],
    ['Achievements', owned.ach],
  ];

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < TROPHY_SLOTS ? [...p, id] : p));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await setTrophyCaseFunction({ trophies: picked });
      onSaved(res.data.trophyCase);
      onClose();
    } catch (err) {
      setError((err as { message?: string }).message || "Couldn't save. Try again.");
      setSaving(false);
    }
  };

  return (
    <div className={`${sheetOverlayClass} z-50`} onClick={onClose}>
      <div ref={sheetRef} className={`${sheetShellClass} p-4 md:max-w-2xl`} onClick={(e) => e.stopPropagation()}>
        <SheetHandle />
        <div className="flex items-baseline justify-between mb-1">
          <h3 className={`text-lg font-bold ${textClass}`}>Trophy case</h3>
          <span className={`text-sm ${mutedClass}`}>
            {picked.length} of {TROPHY_SLOTS}
          </span>
        </div>
        <p className={`text-sm ${mutedClass} mb-4`}>Pick up to {TROPHY_SLOTS}. They show in the order you pick them.</p>

        <div className="space-y-4">
          {groups
            .filter(([, ids]) => ids.length > 0)
            .map(([label, ids]) => (
              <div key={label}>
                <div className={`text-[11px] uppercase tracking-wider mb-2 ${mutedClass}`}>{label}</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {ids.map((id) => {
                    const view = trophyView(id, ctx);
                    if (!view) return null;
                    const at = picked.indexOf(id);
                    return (
                      <button
                        key={id}
                        onClick={() => toggle(id)}
                        disabled={at < 0 && picked.length >= TROPHY_SLOTS}
                        className={`relative flex items-center gap-2 p-2 rounded-sm border text-left disabled:opacity-40 ${
                          at >= 0 ? 'border-orange-500 ring-1 ring-orange-500' : borderClass
                        }`}
                      >
                        <span className="w-14 shrink-0 flex justify-center overflow-hidden [&_img]:w-8 [&_img]:h-8">{view.art}</span>
                        <span className="min-w-0">
                          <span className={`block text-xs font-semibold truncate ${textClass}`}>{view.name}</span>
                          <span className={`block text-[11px] truncate ${mutedClass}`}>{view.caption}</span>
                        </span>
                        {at >= 0 && (
                          <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-orange-500 text-white text-[11px] font-bold flex items-center justify-center">
                            {at + 1}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>

        {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
        <div className="flex gap-2 mt-4 sticky bottom-0 pt-2 light:bg-white dark:bg-zinc-900">
          <button onClick={onClose} className={`flex-1 py-2.5 text-sm font-semibold rounded-sm border ${ghostBtnClass}`}>
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 py-2.5 text-sm font-semibold rounded-sm bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TrophyPicker;
