import type { AdminCommonProps } from '../types';
import type { IpHealthReport } from '../../../../api/types';

type DefenseHealthCardProps = Pick<AdminCommonProps, 'textClass' | 'mutedClass' | 'loading'> & {
  ipHealth: IpHealthReport | null;
  loadIpHealth: () => void;
};

/** Read-only check that the anti-alt defenses are actually firing in production. */
const DefenseHealthCard = ({ textClass, mutedClass, loading, ipHealth, loadIpHealth }: DefenseHealthCardProps) => (
  <div className="p-3 rounded-sm light:bg-emerald-50 dark:bg-slate-700/50">
    <h3 className={`text-sm font-bold mb-1 ${textClass}`}>Anti-Alt Defense Health</h3>
    <p className={`text-xs mb-2 ${mutedClass}`}>
      Shows whether the alt-account defenses are firing in production: accounts per address, blocked signups in the last
      30 days, and whether real addresses are reaching us at all. Read-only.
    </p>
    <button
      onClick={loadIpHealth}
      disabled={loading}
      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-sm disabled:opacity-50"
    >
      {loading ? 'Checking...' : 'Run Health Check'}
    </button>

    {ipHealth && (
      <div className="mt-3 space-y-2">
        <div className={`text-xs ${textClass}`}>
          <span className="font-semibold">Address coverage:</span>{' '}
          <span
            className={
              ipHealth.signupIpCoverage.coveragePercent >= 90 ? 'text-emerald-500 font-bold' : 'text-red-500 font-bold'
            }
          >
            {ipHealth.signupIpCoverage.coveragePercent}%
          </span>{' '}
          ({ipHealth.signupIpCoverage.missingIp} of {ipHealth.signupIpCoverage.realUsers} accounts have no recorded
          address)
        </div>
        <div className={`text-xs ${textClass}`}>
          <span className="font-semibold">Accounts per address:</span>{' '}
          {Object.entries(ipHealth.ipTracking.accountsPerIpHistogram)
            .map(([k, v]) => `${k}: ${v}`)
            .join(' · ')}{' '}
          ({ipHealth.ipTracking.trackedIPs} addresses tracked, {ipHealth.ipTracking.totalTombstones} deleted-account
          tombstones held)
        </div>
        <div className={`text-xs ${textClass}`}>
          <span className="font-semibold">Blocks last 30 days:</span>{' '}
          {ipHealth.alertsLast30d.total === 0
            ? 'none'
            : Object.entries(ipHealth.alertsLast30d.byType)
                .map(([k, v]) => `${k}: ${v}`)
                .join(' · ')}
        </div>
        <div className={`text-xs ${textClass}`}>
          <span className="font-semibold">Discord wall:</span> {ipHealth.discordWall.pending} flagged and still blocked
          · {ipHealth.discordWall.lifted} verified and lifted
        </div>
        {ipHealth.ipTracking.multiAccountIPs.length > 0 && (
          <div>
            <div className={`text-xs font-semibold mb-1 ${textClass}`}>Addresses with 2+ live accounts:</div>
            <div className="space-y-0.5 max-h-32 overflow-y-auto">
              {ipHealth.ipTracking.multiAccountIPs.map((row, i) => (
                <div key={i} className={`text-xs font-mono ${mutedClass}`}>
                  {row.ip} — {row.liveAccounts} live
                  {row.deletedAccounts > 0 ? `, ${row.deletedAccounts} deleted` : ''}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )}
  </div>
);

export default DefenseHealthCard;
