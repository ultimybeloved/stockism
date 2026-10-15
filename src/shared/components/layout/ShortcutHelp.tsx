// The keyboard shortcut list, opened with "?".
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useModalFocus } from '../../hooks/useModalFocus';
import { themeClasses } from '../../../utils/theme';
import { MOD_LABEL } from '../../hooks/useShortcuts';

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Anywhere',
    keys: [
      [`${MOD_LABEL} K`, 'Quick search for a stock or page'],
      ['P', 'Your portfolio'],
      ['M', 'The market'],
      ['?', 'This list'],
      ['Esc', 'Close a window or panel'],
    ],
  },
  {
    title: 'Market',
    keys: [
      ['/', 'Search the market'],
      ['← →', 'Previous or next stock in the open stock window'],
      ['B', 'Buy the stock in the open stock window'],
      ['S', 'Sell the stock in the open stock window'],
      ['C', 'Add the stock in the open stock window to a chart comparison'],
      ['Shift + click', 'Add a stock to a chart comparison'],
    ],
  },
  {
    title: 'Stock page',
    keys: [
      ['B', 'Buy'],
      ['S', 'Sell'],
    ],
  },
];

const ShortcutHelp = ({ onClose }: { onClose: () => void }) => {
  const dialogRef = useModalFocus();
  useEscapeKey(onClose);
  const { overlayClass, modalShellClass, textClass, mutedClass } = themeClasses;
  return (
    <div className={`${overlayClass} z-[60]`} onClick={onClose}>
      <div ref={dialogRef} className={`${modalShellClass} max-w-md p-5`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <h2 className={`text-lg font-bold ${textClass}`}>Keyboard shortcuts</h2>
          <button aria-label="Close" onClick={onClose} className={`text-xl ${mutedClass} hover:text-orange-500`}>
            ×
          </button>
        </div>
        {GROUPS.map((g) => (
          <div key={g.title} className="mb-3">
            <h3 className={`text-xs font-semibold uppercase mb-1 ${mutedClass}`}>{g.title}</h3>
            <dl className="space-y-1">
              {g.keys.map(([k, what]) => (
                <div key={k + what} className="flex items-center gap-3 text-sm">
                  <dt className="w-28 shrink-0">
                    <kbd
                      className={`px-1.5 py-0.5 text-xs font-mono rounded-sm border light:border-amber-200 light:bg-amber-50 dark:border-zinc-700 dark:bg-zinc-800 ${textClass}`}
                    >
                      {k}
                    </kbd>
                  </dt>
                  <dd className={textClass}>{what}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ShortcutHelp;
