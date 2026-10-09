// Read-only panels for the rename tool: the preflight table, the dry-run
// breakdown, and live phase progress from the journal document.
//
// Split out of RecoveryRenameTicker.jsx to keep both files well under the
// 400-line component limit.

import type { PreflightCheck, RenameJournal, RenameTickerResponse } from '../../../../api/types';
import type { AdminCommonProps } from '../types';

type PanelTheme = Pick<AdminCommonProps, 'textClass' | 'mutedClass'>;

const PHASE_LABELS: Record<string, string> = {
  marketCurrent: 'Market document',
  priceHistory: 'Live price history',
  priceArchive: 'Archived history and daily closes',
  marketDocs: 'Market side documents',
  users: 'Player documents',
  priceAlerts: 'Price alerts',
  trades: 'Trade records',
  limitOrders: 'Limit orders',
  preMarketOrders: 'Pre-market orders',
  ipTracking: 'IP trade tracking',
  feed: 'Activity feed',
};

// What the dry run counts, in the order the phases run.
const BREAKDOWN_ROWS: [string, string][] = [
  ['marketCurrent', 'Market document'],
  ['priceHistory', 'Live price history'],
  ['priceArchive', 'Archived price history'],
  ['users', 'Player documents'],
  ['priceAlerts', 'Price alerts'],
  ['trades', 'Trade records'],
  ['limitOrders', 'Limit orders'],
  ['preMarketOrders', 'Pre-market orders'],
  ['feed', 'Activity feed'],
];

export const PreflightTable = ({
  checks,
  textClass,
  mutedClass,
}: PanelTheme & { checks: PreflightCheck[] | null | undefined }) => {
  if (!checks?.length) return null;
  return (
    <div className="mb-3">
      <p className={`text-xs font-semibold uppercase mb-1.5 ${mutedClass}`}>Preflight</p>
      <div className="rounded-sm border light:border-slate-200 dark:border-slate-700">
        {checks.map((c, i) => (
          <div
            key={c.id}
            className={`flex gap-2 px-2.5 py-1.5 text-xs ${
              i > 0 ? 'light:border-t light:border-slate-200 dark:border-t dark:border-slate-700' : ''
            }`}
          >
            <span className="shrink-0">{c.pass ? '✅' : '❌'}</span>
            <div className="min-w-0">
              <p className={c.pass ? textClass : 'text-red-400 font-semibold'}>{c.label}</p>
              {(!c.pass || c.detail) && <p className={`${mutedClass} mt-0.5 break-words`}>{c.detail}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const DryRunBreakdown = ({
  result,
  textClass,
  mutedClass,
}: PanelTheme & { result: RenameTickerResponse | null }) => {
  if (!result?.breakdown) return null;
  const total = Object.values(result.breakdown).reduce((s, n) => s + (n || 0), 0);
  return (
    <div className="p-3 rounded-sm light:bg-blue-50 light:border light:border-blue-300 dark:bg-blue-900/30 dark:border dark:border-blue-700">
      <p className="text-sm font-semibold mb-2 text-blue-400">🔍 Dry run preview</p>
      <p className={`text-xs mb-2 ${textClass}`}>
        <strong>${result.oldTicker}</strong> → <strong>${result.newTicker}</strong>
      </p>

      <p className={`text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Rewritten</p>
      <div className={`text-xs ${mutedClass} space-y-0.5 mb-2`}>
        {BREAKDOWN_ROWS.map(([key, label]) => (
          <p key={key}>
            {label}: {result.breakdown?.[key] ?? 0}
          </p>
        ))}
        <p className={`font-semibold ${textClass} pt-1`}>{total} documents in total</p>
      </div>

      {/* The old copy claimed this touched ALL Firestore data. It never did. */}
      <p className={`text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Left as history, resolved by alias</p>
      <ul className={`text-xs ${mutedClass} space-y-0.5 list-disc pl-4`}>
        {(result.notRewritten || []).map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
};

export const PhaseProgress = ({ journal, textClass, mutedClass }: PanelTheme & { journal: RenameJournal | null }) => {
  if (!journal?.phases) return null;
  const entries = Object.entries(journal.phases);
  const complete = entries.filter(([, p]) => p.status === 'complete').length;

  return (
    <div className="p-3 rounded-sm mb-3 light:bg-slate-50 light:border light:border-slate-200 dark:bg-slate-900 dark:border dark:border-slate-700">
      <div className="flex justify-between items-baseline mb-2">
        <p className={`text-sm font-semibold ${textClass}`}>
          ${journal.old} → ${journal.new}
        </p>
        <p className={`text-xs ${mutedClass}`}>
          {complete} of {entries.length} phases
        </p>
      </div>
      <div className="space-y-0.5">
        {entries.map(([name, p]) => (
          <div key={name} className="flex justify-between gap-2 text-xs">
            <span className={p.status === 'complete' ? mutedClass : textClass}>
              {p.status === 'complete' ? '✅' : p.status === 'paused' ? '⏸️' : '⬜'} {PHASE_LABELS[name] || name}
            </span>
            <span className={`${mutedClass} shrink-0 tabular-nums`}>{p.done || 0}</span>
          </div>
        ))}
      </div>
      {journal.lastError && <p className="text-xs text-red-400 mt-2 break-words">{journal.lastError}</p>}
    </div>
  );
};
