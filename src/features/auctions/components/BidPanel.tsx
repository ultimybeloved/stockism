import { useState } from 'react';
import { useSession } from '../../../context/AppContext';
import { placeAuctionBidFunction } from '../../../api/callables';
import { minimumBid, type Auction } from '../../../rules/auctions';
import { formatCurrency } from '../../../utils/formatters';
import { themeClasses } from '../../../utils/theme';

const { cardClass, textClass, mutedClass, inputClass } = themeClasses;
const label = `text-[11px] uppercase tracking-wider ${mutedClass}`;

/** "1d 04:12" / "04:12:09" / "0:42", or null once it's over. */
export const timeLeft = (ms: number) => {
  if (ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  if (d > 0) return `${d}d ${hh}:${mm}`;
  if (s >= 3600) return `${hh}:${mm}:${ss}`;
  return `${Math.floor(s / 60)}:${ss}`;
};

const endLabel = (ms: number) =>
  new Date(ms).toLocaleString('en-US', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }) + ' UTC';

const ago = (at: number, now: number) => {
  const m = Math.floor((now - at) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
};

const BidPanel = ({ auction, now, onSignIn }: { auction: Auction; now: number; onSignIn: () => void }) => {
  const { user, userData, showNotification } = useSession();
  const min = minimumBid(auction);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const myNumber = (userData?.auctionNumbers as Record<string, number> | undefined)?.[auction.id];
  const imTop = myNumber != null && auction.topBidder === myNumber;
  const started = now >= auction.startsAt;
  const left = timeLeft(auction.endsAt - now);
  const who = (n: number | null) => (n == null ? '' : n === myNumber ? 'You' : `Bidder #${n}`);

  const bid = async () => {
    const value = Math.floor(Number(String(amount || min).replace(/[^0-9.]/g, '')));
    setBusy(true);
    try {
      await placeAuctionBidFunction({ auctionId: auction.id, amount: value });
      showNotification(
        'success',
        `Bid placed: ${formatCurrency(value)}. It's held from your cash until someone outbids you.`,
      );
      setAmount('');
    } catch (err) {
      showNotification('error', (err as { message?: string }).message || "Couldn't place that bid.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className={`${cardClass} border rounded-sm p-4 space-y-4`}>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <div className={label}>{auction.topBid ? 'Top bid' : 'Starting bid'}</div>
          <div className={`text-2xl font-bold truncate ${textClass}`}>
            {formatCurrency(auction.topBid ?? auction.startingBid)}
          </div>
          <div className={`text-xs ${imTop ? 'text-emerald-500 font-semibold' : mutedClass}`}>
            {auction.topBid ? (imTop ? "You're winning" : who(auction.topBidder)) : 'No bids yet'}
          </div>
        </div>
        <div className="text-right">
          <div className={label}>{started ? 'Ends in' : 'Starts in'}</div>
          <div className={`text-2xl font-bold tabular-nums ${textClass}`}>
            {started ? left || 'Ending' : timeLeft(auction.startsAt - now)}
          </div>
          <div className={`text-xs ${mutedClass}`}>{endLabel(started ? auction.endsAt : auction.startsAt)}</div>
        </div>
      </div>

      {started && left && (
        <div>
          <div className={`${label} mb-1`}>Your bid</div>
          {user ? (
            <div className="flex gap-2">
              <input
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={min.toLocaleString('en-US')}
                className={`flex-1 min-w-0 px-3 py-2 rounded-sm border ${inputClass} font-semibold`}
              />
              <button
                onClick={bid}
                disabled={busy}
                className="px-4 py-2 rounded-sm bg-orange-500 text-white font-semibold hover:bg-orange-600 disabled:opacity-50"
              >
                {busy ? '...' : 'Bid'}
              </button>
            </div>
          ) : (
            <button onClick={onSignIn} className="w-full py-2 rounded-sm bg-orange-500 text-white font-semibold">
              Sign in to bid
            </button>
          )}
          <p className={`text-[11px] mt-1.5 ${mutedClass}`}>
            At least {formatCurrency(min)}
            {auction.topBid ? ' (5% over the top bid)' : ''}. Your bid is held from your cash until someone outbids you,
            then it comes straight back. A bid in the last 5 minutes adds 5 more.
          </p>
          {user && <p className={`text-[11px] mt-1 ${mutedClass}`}>Your cash: {formatCurrency(userData?.cash || 0)}</p>}
        </div>
      )}

      <div>
        <div className={`${label} mb-2`}>Bids {auction.bidCount > 0 && `(${auction.bidCount})`}</div>
        {auction.bids.length === 0 ? (
          <p className={`text-sm ${mutedClass}`}>Be the first.</p>
        ) : (
          <ul className="space-y-1.5 max-h-72 overflow-y-auto">
            {auction.bids.map((b, i) => (
              <li key={`${b.at}-${b.n}`} className="flex justify-between gap-2 text-sm">
                <span className={i === 0 ? `font-semibold ${textClass}` : mutedClass}>{who(b.n)}</span>
                <span className={`tabular-nums ${i === 0 ? `font-semibold ${textClass}` : mutedClass}`}>
                  {formatCurrency(b.amount)} <span className="text-[11px]">{ago(b.at, now)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
};

export default BidPanel;
