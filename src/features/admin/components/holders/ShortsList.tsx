// Every open short against one ticker. Risk numbers come from getShortRisk, the
// same helper that mirrors the force-cover scanner, so a position flagged
// critical here is one the server is about to liquidate.
import type { AdminCommonProps } from '../types';
import type { ShortHolderRow } from '../../hooks/useAdminHolders';

type ShortsListProps = Pick<AdminCommonProps, 'textClass' | 'mutedClass'> & {
  shortsData: ShortHolderRow[];
};

const ShortsList = ({ textClass, mutedClass, shortsData }: ShortsListProps) => {
  if (shortsData.length === 0) return null;

  return (
    <div className="mt-4">
      <h4 className="text-xs font-semibold uppercase text-red-400 mb-2">Short Positions ({shortsData.length})</h4>
      <div className="space-y-1 max-h-80 overflow-y-auto">
        {shortsData.map((s, idx) => (
          <div
            key={s.userId}
            className={`p-2 rounded-sm light:bg-white light:hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 ${
              s.isCritical ? 'border-2 border-red-500' : s.isAtRisk ? 'border border-amber-500' : ''
            }`}
          >
            <div className="flex justify-between items-start">
              <div>
                <span className={`font-semibold ${textClass}`}>
                  {idx === 0 && '🩳 '}
                  {s.displayName}
                </span>
                {s.isCritical ? (
                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-red-600 text-white">LIQUIDATING</span>
                ) : s.isAtRisk ? (
                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-600 text-white">AT RISK</span>
                ) : null}
              </div>
              <div className="text-right">
                <span className="font-bold text-red-400">{s.shares}</span>
                <span className={`text-xs ${mutedClass} ml-1`}>short</span>
                <p className={`text-xs font-semibold ${s.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {s.pnl >= 0 ? '+' : '-'}${Math.abs(s.pnl).toFixed(2)}
                </p>
              </div>
            </div>
            <div className={`text-xs ${mutedClass} mt-1`}>
              Entry: ${s.entryPrice.toFixed(2)} · Margin: ${s.margin.toFixed(2)} · Value: ${s.value.toFixed(2)}
            </div>
            <div className={`text-xs ${mutedClass}`}>
              {s.liquidationPrice != null && <>Force-covers at ${s.liquidationPrice.toFixed(2)}</>}
              {s.equityRatio != null && <> · Equity {(s.equityRatio * 100).toFixed(0)}%</>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ShortsList;
