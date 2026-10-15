// Weekly changes: every price the admin set by hand in one week, as a card to
// save as an image or copy as a Reddit table. Reads the admin history, so it
// only knows about weeks since that started (2026-10-12).
import { useMemo, useRef, useState } from 'react';
import { adminListLogFunction } from '../../../../api/callables';
import { useAdminLoad } from '../../hooks/useAdminLoad';
import { CHARACTER_MAP } from '../../../../characters';
import { summarizeWeek, toRedditMarkdown, weekLabel, weekWindow } from '../../utils/weeklyChanges';
import { pct, money2, utc } from '../../utils/termFormat';
import { Empty, Panel } from '../shell/ui';
import { signClass, t } from '../shell/terminal';
import WeeklyCard from './WeeklyCard';

const HISTORY_START = Date.parse('2026-10-12T00:00:00Z');

const names: Record<string, string> = Object.fromEntries(Object.values(CHARACTER_MAP).map((c) => [c.ticker, c.name]));

const WeeklyChanges = () => {
  const { data, error, loading, load } = useAdminLoad(() => adminListLogFunction({}));
  const [back, setBack] = useState(0);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const week = useMemo(() => weekWindow(back), [back]);
  const rows = useMemo(() => summarizeWeek(data?.entries || [], week), [data, week]);
  const inProgress = week.end > Date.now();

  const flash = (msg: string) => {
    setNote(msg);
    window.setTimeout(() => setNote(''), 2500);
  };

  const saveImage = async () => {
    if (!cardRef.current) return;
    setSaving(true);
    try {
      const { toPng } = await import('html-to-image');
      const url = await toPng(cardRef.current, { pixelRatio: 2, cacheBust: true });
      const a = document.createElement('a');
      a.href = url;
      a.download = `stockism-changes-${new Date(week.end).toISOString().slice(0, 10)}.png`;
      a.click();
      flash('Image saved');
    } catch {
      flash('Could not save the image');
    } finally {
      setSaving(false);
    }
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(toRedditMarkdown(rows, week, names));
      flash('Copied. Paste it into a Reddit post in Markdown mode.');
    } catch {
      flash('Could not copy');
    }
  };

  if (!data) return <Empty>{error ? `Could not load: ${error}` : 'Loading your changes...'}</Empty>;

  return (
    <div className="space-y-3">
      <div className={`${t.panel} flex flex-wrap items-center gap-2 p-3`}>
        <button type="button" className={t.btn} onClick={() => setBack(back + 1)} aria-label="Earlier week">
          ‹
        </button>
        <button
          type="button"
          className={t.btn}
          onClick={() => setBack(back - 1)}
          disabled={back <= -1}
          aria-label="Later week"
        >
          ›
        </button>
        <div className="ml-2">
          <div className={`${t.text} font-semibold`}>
            {weekLabel(week)} {inProgress && <span className={t.amber}>(still going)</span>}
          </div>
          <div className={`${t.num} text-[11px] ${t.muted}`}>
            {utc(week.start)} to {utc(week.end)} UTC
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {note && <span className={`${t.num} text-[11px] ${t.green}`}>{note}</span>}
          <button type="button" className={t.btn} onClick={() => void load()} disabled={loading}>
            Reload
          </button>
          <button type="button" className={t.btn} onClick={() => void copyText()} disabled={!rows.length}>
            Copy for Reddit
          </button>
          <button type="button" className={t.btnGo} onClick={() => void saveImage()} disabled={!rows.length || saving}>
            {saving ? 'Saving...' : 'Save image'}
          </button>
        </div>
      </div>

      {week.start < HISTORY_START && (
        <p className={`${t.num} text-[11px] ${t.amber}`}>
          Your change history only goes back to Oct 12, 2026, so this week may be missing changes.
        </p>
      )}

      {rows.length === 0 ? (
        <Empty>No price changes by you this week.</Empty>
      ) : (
        <div className="flex flex-wrap items-start gap-3">
          <div className="overflow-x-auto">
            <WeeklyCard ref={cardRef} rows={rows} week={week} names={names} />
          </div>
          <Panel title="Your edits" className="min-w-[18rem] flex-1" pad={false}>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={t.th}>Stock</th>
                  <th className={`${t.th} text-right`}>Before</th>
                  <th className={`${t.th} text-right`}>After</th>
                  <th className={`${t.th} text-right`}>You set</th>
                  <th className={`${t.th} text-right`}>Total</th>
                  <th className={`${t.th} text-right`}>Edits</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.ticker} className={t.row}>
                    <td className={`${t.td} ${t.text}`}>${r.ticker}</td>
                    <td className={`${t.td} ${t.num} text-right ${t.muted}`}>{money2(r.from)}</td>
                    <td className={`${t.td} ${t.num} text-right ${t.text}`}>{money2(r.to)}</td>
                    <td className={`${t.td} ${t.num} text-right ${t.muted}`}>{pct(r.directPercent, 2)}</td>
                    <td className={`${t.td} ${t.num} text-right ${signClass(r.percent)}`}>{pct(r.percent, 2)}</td>
                    <td className={`${t.td} ${t.num} text-right ${t.muted}`}>{r.edits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={`px-2 py-2 text-[11px] ${t.dim}`}>
              Total is what the card shows: your edits plus the knock-on from linked stocks you adjusted. Player trading
              in between is left out. Stocks only dragged along are not listed.
            </p>
          </Panel>
        </div>
      )}
    </div>
  );
};

export default WeeklyChanges;
