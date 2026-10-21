// Start and cancel one-of-a-kind auctions. Only one-of-one catalog items that
// nobody owns and that haven't been auctioned can go up (the server checks).
import { useState } from 'react';
import { adminCancelAuctionFunction, adminCreateAuctionFunction } from '../../../../api/callables';
import { COSMETICS } from '../../../../constants/cosmetics';
import { useAuctions } from '../../../auctions/hooks/useAuctions';
import { money } from '../../utils/termFormat';
import { Empty, Panel } from '../shell/ui';
import { t } from '../shell/terminal';

/** Next Wednesday 21:00 UTC, the usual close (before the Thursday halt). */
const nextWednesdayClose = (from = Date.now()) => {
  const d = new Date(from);
  d.setUTCHours(21, 0, 0, 0);
  const add = (3 - d.getUTCDay() + 7) % 7 || (d.getTime() <= from ? 7 : 0);
  d.setUTCDate(d.getUTCDate() + add);
  return d.getTime();
};
const toInput = (ms: number) => new Date(ms).toISOString().slice(0, 16);
const fromInput = (v: string) => Date.parse(`${v}:00Z`);

const AuctionAdmin = () => {
  const { live, past } = useAuctions();
  const items = COSMETICS.filter((c) => c.oneOfOne);
  const [itemId, setItemId] = useState(items[0]?.id || '');
  const [startsAt, setStartsAt] = useState(toInput(Date.now()));
  const [endsAt, setEndsAt] = useState(toInput(nextWednesdayClose()));
  const [startingBid, setStartingBid] = useState('50000');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg(done);
    } catch (err) {
      setMsg((err as { message?: string }).message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Panel title="Live">
        {live.length === 0 ? (
          <Empty>No auction running.</Empty>
        ) : (
          live.map((a) => (
            <div key={a.id} className="flex items-center gap-3 py-1 text-sm">
              <span className="flex-1">
                {a.itemId} · top {a.topBid ? money(a.topBid) : 'none'} · {a.bidCount} bids · ends{' '}
                {new Date(a.endsAt).toISOString().slice(0, 16).replace('T', ' ')} UTC
              </span>
              <button
                className={t.btnDanger}
                disabled={busy}
                onClick={() =>
                  window.confirm('Cancel this auction? The top bid goes back.') &&
                  act(() => adminCancelAuctionFunction({ auctionId: a.id }), 'Cancelled, top bid returned.')
                }
              >
                Cancel
              </button>
            </div>
          ))
        )}
      </Panel>

      <Panel title="Start an auction">
        <div className="grid grid-cols-4 gap-3 items-end">
          <label className="space-y-1">
            <span className={t.label}>Item</span>
            <select className={t.input} value={itemId} onChange={(e) => setItemId(e.target.value)}>
              {items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.id})
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={t.label}>Starts (UTC)</span>
            <input
              type="datetime-local"
              className={t.input}
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className={t.label}>Ends (UTC)</span>
            <input
              type="datetime-local"
              className={t.input}
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className={t.label}>Starting bid</span>
            <input
              className={t.input}
              inputMode="numeric"
              value={startingBid}
              onChange={(e) => setStartingBid(e.target.value)}
            />
          </label>
        </div>
        <div className="flex items-center gap-3 mt-3">
          <button
            className={t.btnGo}
            disabled={busy || !itemId}
            onClick={() =>
              act(
                () =>
                  adminCreateAuctionFunction({
                    itemId,
                    startsAt: fromInput(startsAt),
                    endsAt: fromInput(endsAt),
                    startingBid: Number(startingBid.replace(/[^0-9]/g, '')),
                  }),
                'Auction started.',
              )
            }
          >
            Start auction
          </button>
          {msg && <span className="text-sm">{msg}</span>}
        </div>
      </Panel>

      <Panel title="Finished">
        {past.length === 0 ? (
          <Empty>None yet.</Empty>
        ) : (
          past.map((a) => (
            <div key={a.id} className="text-sm py-0.5">
              {a.itemId} · {a.winnerName ? `${a.winnerName} for ${money(a.topBid || 0)}` : 'no bids'}
            </div>
          ))
        )}
      </Panel>
    </div>
  );
};

export default AuctionAdmin;
