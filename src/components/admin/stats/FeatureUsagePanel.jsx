import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase';

// Distinct players who touched each system in the last 7 days. Written by
// weeklyMarketSummary (Monday 00:00 UTC) from data it already has in memory, so
// reading it here is one document read and the report itself costs nothing.
// Point of it: find the systems nobody uses, so they can be improved or retired.
const LABELS = {
  trading: 'Trading',
  ladder: 'Ladder game',
  predictions: 'Predictions',
  eventMarket: 'Event markets',
  missions: 'Missions',
  crew: 'Crews',
  crewMissions: 'Crew missions',
  margin: 'Margin',
  limitOrders: 'Limit orders',
  preMarket: 'Pre-market orders',
  ipo: 'IPO buys',
  cosmetics: 'Cosmetics',
  pins: 'Pins',
  dailyCheckin: 'Daily check-in',
  portfolio: 'Dust sweep',
};

const FeatureUsagePanel = ({ darkMode, textClass, mutedClass }) => {
  const [report, setReport] = useState(null);
  const [state, setState] = useState('loading');

  useEffect(() => {
    getDoc(doc(db, 'admin', 'featureUsage'))
      .then(snap => {
        if (snap.exists()) {
          setReport(snap.data());
          setState('ready');
        } else {
          setState('empty');
        }
      })
      .catch(err => {
        console.error('Failed to load feature usage:', err);
        setState('error');
      });
  }, []);

  const rows = report
    ? Object.entries(report.counts || {}).sort((a, b) => b[1] - a[1])
    : [];
  const total = report?.totalUsers || 0;

  return (
    <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-100'}`}>
      <h3 className={`font-semibold ${textClass} mb-1`}>📊 Feature Usage (last 7 days)</h3>
      <p className={`text-xs ${mutedClass} mb-3`}>
        {state === 'ready'
          ? `Distinct players out of ${total}. Updated ${new Date(report.generatedAt).toLocaleDateString()}.`
          : 'Distinct players who used each system.'}
      </p>

      {state === 'loading' && <p className={`text-sm ${mutedClass}`}>Loading...</p>}
      {state === 'error' && <p className="text-sm text-red-400">Could not load the usage report.</p>}
      {state === 'empty' && (
        <p className={`text-sm ${mutedClass}`}>
          No report yet. It is written by the weekly market summary every Monday at 00:00 UTC.
        </p>
      )}

      {state === 'ready' && (
        <div className="space-y-1">
          {rows.map(([key, count]) => {
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            return (
              <div key={key} className="flex items-center gap-2">
                <span className={`text-xs w-36 shrink-0 ${textClass}`}>{LABELS[key] || key}</span>
                <div className={`flex-1 h-3 rounded-sm overflow-hidden ${darkMode ? 'bg-slate-800' : 'bg-slate-300'}`}>
                  <div
                    className={count === 0 ? 'h-full bg-red-500' : 'h-full bg-teal-500'}
                    style={{ width: `${Math.max(pct, count > 0 ? 2 : 0)}%` }}
                  />
                </div>
                <span className={`text-xs w-16 text-right ${count === 0 ? 'text-red-400' : mutedClass}`}>
                  {count} ({pct}%)
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default FeatureUsagePanel;
