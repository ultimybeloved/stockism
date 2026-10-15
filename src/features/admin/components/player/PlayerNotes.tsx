// Player file, notes tab: private notes only admins can see.
import { useState } from 'react';
import { utc } from '../../utils/termFormat';
import { Empty, Panel } from '../shell/ui';
import { t } from '../shell/terminal';
import type { PlayerNote } from '../../../../api/adminPanelTypes';

const PlayerNotes = ({
  notes,
  onAdd,
  onDelete,
}: {
  notes: PlayerNote[];
  onAdd: (text: string) => Promise<boolean>;
  onDelete: (id: string) => void;
}) => {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!text.trim()) return;
    setSaving(true);
    if (await onAdd(text)) setText('');
    setSaving(false);
  };

  return (
    <div className="grid grid-cols-3 gap-3">
      <Panel title="Add a note" className="col-span-1">
        <textarea
          aria-label="Note"
          className={`${t.input} w-full`}
          rows={6}
          maxLength={2000}
          placeholder="Only admins can see this. e.g. Warned about alts on 2026-10-14."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save();
          }}
        />
        <div className="flex items-center justify-between mt-2">
          <span className={`text-xs ${t.dim}`}>Ctrl+Enter to save</span>
          <button className={t.btnGo} onClick={save} disabled={saving || !text.trim()}>
            {saving ? 'Saving' : 'Save note'}
          </button>
        </div>
      </Panel>
      <Panel title={`Notes (${notes.length})`} className="col-span-2" pad={false}>
        {notes.length === 0 ? (
          <Empty>No notes yet</Empty>
        ) : (
          <ul>
            {[...notes]
              .sort((a, b) => b.at - a.at)
              .map((n) => (
                <li key={n.id} className="px-3 py-2 border-b border-[var(--t-line)] group">
                  <div className="flex items-center justify-between">
                    <span className={`${t.num} text-[11px] ${t.muted}`}>{utc(n.at)} UTC</span>
                    <button
                      className={`text-[11px] t-mono uppercase ${t.dim} hover:text-[var(--t-red)] opacity-0 group-hover:opacity-100`}
                      onClick={() => onDelete(n.id)}
                    >
                      Delete
                    </button>
                  </div>
                  <p className="text-sm whitespace-pre-wrap mt-0.5">{n.text}</p>
                </li>
              ))}
          </ul>
        )}
      </Panel>
    </div>
  );
};

export default PlayerNotes;
