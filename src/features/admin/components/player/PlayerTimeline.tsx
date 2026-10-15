// Player file, timeline tab: everything the player did and everything done to
// them, newest first, in one list.
import { useMemo, useState } from 'react';
import { buildTimeline, amountText } from '../../utils/playerTimeline';
import type { TimelineKind } from '../../utils/playerTimeline';
import { utc } from '../../utils/termFormat';
import { Empty, Panel, Tag } from '../shell/ui';
import { signClass, t } from '../shell/terminal';
import type { PlayerFileResponse } from '../../../../api/adminPanelTypes';

const KINDS: { id: TimelineKind; label: string; tone: 'green' | 'cyan' | 'violet' | 'amber' | 'red' | 'dim' }[] = [
  { id: 'trade', label: 'Trades', tone: 'cyan' },
  { id: 'money', label: 'Money', tone: 'green' },
  { id: 'market', label: 'Long-term markets', tone: 'violet' },
  { id: 'gift', label: 'Gifts', tone: 'amber' },
  { id: 'admin', label: 'Admin', tone: 'red' },
  { id: 'note', label: 'Notes', tone: 'amber' },
  { id: 'bell', label: 'Bell', tone: 'dim' },
];
const TONE = Object.fromEntries(KINDS.map((k) => [k.id, k.tone]));
const LABEL: Record<TimelineKind, string> = {
  trade: 'trade',
  money: 'money',
  market: 'market',
  gift: 'gift',
  admin: 'admin',
  note: 'note',
  bell: 'bell',
};

const PlayerTimeline = ({ file }: { file: PlayerFileResponse }) => {
  const all = useMemo(() => buildTimeline(file), [file]);
  const [off, setOff] = useState<Set<TimelineKind>>(new Set());
  const items = all.filter((i) => !off.has(i.kind));

  const toggle = (k: TimelineKind) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <div className="space-y-2">
      <div className="flex gap-1 flex-wrap">
        {KINDS.map((k) => (
          <button key={k.id} className={off.has(k.id) ? t.btn : t.btnGo} onClick={() => toggle(k.id)}>
            {k.label} {all.filter((i) => i.kind === k.id).length}
          </button>
        ))}
      </div>
      <Panel pad={false} title={`${items.length} events`}>
        {items.length === 0 ? (
          <Empty>Nothing to show</Empty>
        ) : (
          <div className="max-h-[68vh] overflow-y-auto">
            <table className="w-full text-sm">
              <tbody>
                {items.map((i, idx) => (
                  <tr key={`${i.at}-${idx}`} className={t.row}>
                    <td className={`${t.td} ${t.num} ${t.muted} w-40`}>{utc(i.at)}</td>
                    <td className={`${t.td} w-20`}>
                      <Tag tone={TONE[i.kind]}>{LABEL[i.kind]}</Tag>
                    </td>
                    <td className={`${t.td} whitespace-normal`}>{i.text}</td>
                    <td className={`${t.td} ${t.num} text-right ${signClass(i.amount)}`}>{amountText(i.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className={`text-xs ${t.dim}`}>
        Built from the newest 400 money entries, 300 trades, and everything else on file. Discord commands are counted
        on the Overview tab.
      </p>
    </div>
  );
};

export default PlayerTimeline;
