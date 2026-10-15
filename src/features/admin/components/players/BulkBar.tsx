// Bulk actions on the players ticked in the table: grant cash (memo required,
// same rules as a single cash edit) or send a bell message, optionally by
// Discord DM too.
import { useState } from 'react';
import { adminBulkActionFunction } from '../../../../api/callables';
import { errorMessage } from '../../../../utils/errors';
import { money } from '../../utils/termFormat';
import { t } from '../shell/terminal';

const BulkBar = ({
  uids,
  onClear,
  showMessage,
  onPaid,
}: {
  uids: string[];
  onClear: () => void;
  showMessage: (type: string, text: string) => void;
  /** Players who got the cash, so the table can show it without a reload. */
  onPaid: (uids: string[], amount: number) => void;
}) => {
  const [mode, setMode] = useState<'cash' | 'message' | null>(null);
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [discord, setDiscord] = useState(false);
  const [busy, setBusy] = useState(false);

  const n = uids.length;
  const each = Number(amount);

  const run = async () => {
    if (mode === 'cash') {
      if (!(each > 0) || !memo.trim()) return showMessage('error', 'Enter an amount and a memo');
      if (!window.confirm(`Give ${money(each)} to each of ${n} players (${money(each * n)} total)?\n\nMemo: ${memo}`))
        return;
    }
    if (mode === 'message') {
      if (!title.trim() || !message.trim()) return showMessage('error', 'Write a title and a message');
      if (!window.confirm(`Send "${title}" to ${n} players${discord ? ' (bell and Discord DM)' : ''}?`)) return;
    }
    setBusy(true);
    try {
      const { data } =
        mode === 'cash'
          ? await adminBulkActionFunction({ action: 'cash', uids, amount: each, memo })
          : await adminBulkActionFunction({ action: 'message', uids, title, message, discord });
      if (mode === 'cash') {
        const failed = new Set(data.failed.map((f) => f.uid));
        onPaid(
          uids.filter((u) => !failed.has(u)),
          each,
        );
      }
      const failedNote = data.failed.length ? ` ${data.failed.length} failed: ${data.failed[0]!.reason}` : '';
      showMessage(
        data.failed.length ? 'error' : 'success',
        mode === 'cash'
          ? `Paid ${data.done} players ${money(each)} each.${failedNote}`
          : `Sent to ${data.done} players${discord ? `, ${data.dms || 0} by DM` : ''}.${failedNote}`,
      );
      setMode(null);
      setAmount('');
      setMemo('');
      setTitle('');
      setMessage('');
    } catch (err) {
      showMessage('error', errorMessage(err));
    }
    setBusy(false);
  };

  return (
    <div className="border border-[var(--t-green)] bg-[var(--t-panel2)] p-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className={`${t.num} text-sm ${t.green}`}>{n} selected</span>
        <button className={mode === 'cash' ? t.btnGo : t.btn} onClick={() => setMode(mode === 'cash' ? null : 'cash')}>
          Grant cash
        </button>
        <button
          className={mode === 'message' ? t.btnGo : t.btn}
          onClick={() => setMode(mode === 'message' ? null : 'message')}
        >
          Send message
        </button>
        <button className={`${t.btn} ml-auto`} onClick={onClear}>
          Clear selection
        </button>
      </div>
      {mode === 'cash' && (
        <div className="flex items-center gap-2">
          <input
            aria-label="Amount each"
            className={`${t.input} w-36`}
            placeholder="Amount each"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          />
          <input
            aria-label="Memo"
            className={`${t.input} flex-1`}
            placeholder="Memo (private, required): why are they getting this?"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
          <span className={`${t.num} text-xs ${t.muted}`}>{each > 0 ? `${money(each * n)} total` : ''}</span>
          <button className={t.btnGo} onClick={run} disabled={busy}>
            {busy ? 'Paying' : 'Pay'}
          </button>
        </div>
      )}
      {mode === 'message' && (
        <div className="space-y-2">
          <input
            aria-label="Title"
            className={`${t.input} w-full`}
            placeholder="Title"
            maxLength={80}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            aria-label="Message"
            className={`${t.input} w-full`}
            rows={3}
            maxLength={600}
            placeholder="Message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={discord} onChange={(e) => setDiscord(e.target.checked)} />
              Also send as a Discord DM to linked players
            </label>
            <button className={`${t.btnGo} ml-auto`} onClick={run} disabled={busy}>
              {busy ? 'Sending' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BulkBar;
