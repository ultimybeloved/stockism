// The public-only part of a profile: the 30-day chart, a few stats and what
// they hold (tickers only, never share counts). A private profile gets one line
// saying so instead.
import { Link } from 'react-router-dom';
import { CHARACTER_MAP } from '../../../../characters';
import { formatCompactCurrency } from '../../../../utils/formatters';
import { themeClasses } from '../../../../utils/theme';
import SimpleLineChart from '../../../../shared/components/charts/SimpleLineChart';
import PixelIcon from '../../../../shared/components/PixelIcon';
import type { PublicProfile } from '../../../../api/types';

const { cardClass, textClass, mutedClass, borderClass } = themeClasses;
const label = `text-[11px] uppercase tracking-wider ${mutedClass}`;

export const PrivateNote = () => (
  <section className={`${cardClass} border rounded-sm p-4 flex items-center gap-3`}>
    <PixelIcon name="lock" className="w-6 h-6 shrink-0" />
    <p className={`text-sm ${mutedClass}`}>Holdings, the chart, and trading stats are private.</p>
  </section>
);

const ProfileTrading = ({ profile }: { profile: PublicProfile }) => {
  const data = (profile.portfolioHistory || []).map((p) => ({ timestamp: p.timestamp, price: p.value }));
  const s = profile.stats;
  const top = profile.topHoldings || [];
  const stats = [
    ['All-time high', formatCompactCurrency(s?.peakPortfolioValue || 0)],
    ['Trades', (s?.totalTrades || 0).toLocaleString()],
    s?.checkinStreak > 1 ? ['Check-in streak', `${s.checkinStreak} days`] : ['Check-ins', (s?.totalCheckins || 0).toLocaleString()],
  ];

  return (
    <section className={`${cardClass} border rounded-sm p-4 space-y-4`}>
      <div className="flex items-baseline justify-between">
        <h2 className={`font-bold ${textClass}`}>Trading</h2>
        {data.length >= 2 && <span className={label}>last 30 days</span>}
      </div>
      {data.length >= 2 && <SimpleLineChart data={data} width={1000} height={80} />}
      <div className="grid grid-cols-3 gap-2 text-center">
        {stats.map(([k, v]) => (
          <div key={k}>
            <div className={`font-bold ${textClass}`}>{v}</div>
            <div className={label}>{k}</div>
          </div>
        ))}
      </div>
      {(profile.holdingTickers.length > 0 || profile.shortTickers.length > 0) && (
        <div>
          <div className={`${label} mb-2`}>Holds</div>
          <div className="flex flex-wrap gap-1.5">
            {[...top, ...profile.holdingTickers.filter((t) => !top.includes(t))].map((t) => (
              <Link
                key={t}
                to={`/stock/${t}`}
                className={`px-2 py-1 rounded-sm border ${borderClass} text-xs font-mono hover:border-orange-500 ${
                  top.includes(t) ? 'font-bold text-orange-500' : mutedClass
                }`}
              >
                ${t}
                {top.includes(t) && CHARACTER_MAP[t] && !CHARACTER_MAP[t].isETF && (
                  <span className={`ml-1 font-sans font-normal ${mutedClass}`}>{CHARACTER_MAP[t].name}</span>
                )}
              </Link>
            ))}
            {profile.shortTickers.map((t) => (
              <Link
                key={`short-${t}`}
                to={`/stock/${t}`}
                className="px-2 py-1 rounded-sm border border-red-500/40 text-xs font-mono text-red-500"
              >
                short ${t}
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

export default ProfileTrading;
