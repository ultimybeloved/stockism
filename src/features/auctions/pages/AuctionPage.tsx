import { useSession } from '../../../context/AppContext';
import { COSMETIC_MAP, COSMETIC_TYPE_LABELS } from '../../../constants/cosmetics';
import { getCosmeticStyles } from '../../../utils/cosmetics';
import { formatCurrency } from '../../../utils/formatters';
import { themeClasses } from '../../../utils/theme';
import CosmeticName from '../../../shared/components/cosmetics/CosmeticName';
import WornCard from '../components/WornCard';
import BidPanel from '../components/BidPanel';
import { useAuctions, useNow } from '../hooks/useAuctions';

const { cardClass, textClass, mutedClass } = themeClasses;
const label = `text-[11px] uppercase tracking-wider ${mutedClass}`;

// /auction: one-of-a-kind cosmetics, sold once to the highest bidder.
const AuctionPage = ({ onShowLogin }: { onShowLogin: () => void }) => {
  const { userData } = useSession();
  const { live, past, loading } = useAuctions();
  const now = useNow();
  const seed = userData?.displayName || 'Your name here';
  const auction = live[0];
  const item = auction ? COSMETIC_MAP[auction.itemId] : null;

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className={`text-2xl font-bold ${textClass}`}>Auction House</h1>
        <span className={label}>One of a kind</span>
      </div>

      {loading ? (
        <div className={`${cardClass} border rounded-sm p-8 text-center ${mutedClass}`}>Loading...</div>
      ) : !auction || !item ? (
        <div className={`${cardClass} border rounded-sm p-8 text-center`}>
          <p className={`font-semibold ${textClass}`}>No auction right now</p>
          <p className={`text-sm ${mutedClass} mt-1`}>The next one-of-a-kind item goes up soon. Check back.</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px] items-start">
          <section className="space-y-3 min-w-0">
            <WornCard itemId={item.id} seedKey={seed} className="min-h-[220px]">
              <div className="inline-block text-[10px] font-bold tracking-widest px-2 py-0.5 rounded-sm border border-amber-400 text-amber-400 mb-2">
                1 OF 1
              </div>
              <div className={`text-3xl font-bold ${textClass}`}>
                {item.type === 'nameColor' ? (
                  <CosmeticName
                    name={item.name}
                    styles={getCosmeticStyles({ nameColor: item.id }, null, { seedKey: seed })}
                  />
                ) : (
                  item.name
                )}
              </div>
              <div className={`text-sm ${mutedClass}`}>{COSMETIC_TYPE_LABELS[item.type]} · never sold again</div>
            </WornCard>
            <p className={`text-sm ${mutedClass}`}>
              {item.description} Only one player will ever own it. The winner can wear it, show it in their trophy case
              and keep it forever. It never comes back to the shop.
            </p>
          </section>
          <BidPanel auction={auction} now={now} onSignIn={onShowLogin} />
        </div>
      )}

      {past.length > 0 && (
        <section className={`${cardClass} border rounded-sm p-4`}>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className={`font-bold ${textClass}`}>Past one-of-ones</h2>
            <span className={label}>who owns them</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {past.map((a) => {
              const c = COSMETIC_MAP[a.itemId];
              return (
                <WornCard key={a.id} itemId={a.itemId} seedKey={a.winnerName || 'Unsold'} className="min-h-[132px]">
                  <div className={`font-semibold ${textClass}`}>{c?.name || a.itemId}</div>
                  {a.winnerName ? (
                    <>
                      <div className="text-sm font-bold text-amber-400">Sold for {formatCurrency(a.topBid || 0)}</div>
                      <div className={`text-[11px] ${mutedClass}`}>Owned by {a.winnerName}</div>
                    </>
                  ) : (
                    <div className={`text-[11px] ${mutedClass}`}>No bids</div>
                  )}
                </WornCard>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};

export default AuctionPage;
