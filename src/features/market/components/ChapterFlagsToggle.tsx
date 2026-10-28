import { useStoredToggle } from '../../../shared/hooks/useStoredToggle';

// Chapter flags crowd long charts, so they start hidden. The choice is shared by
// every chart and kept in the browser.
export const CHAPTER_FLAGS_KEY = 'chartChapterFlags';
export const useChapterFlags = () => useStoredToggle(CHAPTER_FLAGS_KEY);

/** On/off switch for chart chapter flags, styled like one SegmentedSwitch segment. */
const ChapterFlagsToggle = () => {
  const [on, toggle] = useChapterFlags();
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={toggle}
      title="Mark each weekly chapter review on the chart"
      className={`px-2 sm:px-3 py-1.5 text-xs font-semibold whitespace-nowrap rounded-md border light:border-amber-200 dark:border-zinc-800 transition-colors ${
        on
          ? 'shadow-[inset_0_-2px_0_#a855f7] light:bg-amber-100 light:text-slate-900 dark:bg-zinc-800 dark:text-zinc-50'
          : 'light:text-zinc-500 light:hover:bg-amber-50 light:hover:text-slate-800 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200'
      }`}
    >
      Chapter flags
    </button>
  );
};

export default ChapterFlagsToggle;
