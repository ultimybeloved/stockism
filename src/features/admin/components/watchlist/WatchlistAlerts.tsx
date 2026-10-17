import AdminIcon, { type AdminIconName } from '../AdminIcon';
import type { AdminCommonProps } from '../types';
import type { WatchlistAlert } from '../../../../api/types';

const ALERT_ICONS: Record<string, AdminIconName> = {
  alt_suspected: 'inspect',
  account_blocked: 'blocked',
  account_linked: 'link',
  new_ip_detected: 'globe',
  duplicate_username: 'nametag',
  user_added: 'eye',
  user_removed: 'error',
  ip_added: 'mappin',
};

const ALERT_COLORS: Record<string, string> = {
  account_blocked: 'text-red-400',
  account_linked: 'text-orange-400',
  new_ip_detected: 'text-yellow-400',
  duplicate_username: 'text-pink-400',
};

const alertColor = (alert: WatchlistAlert) => {
  if (alert.type === 'alt_suspected') return alert.severity === 'high' ? 'text-red-400' : 'text-amber-400';
  return ALERT_COLORS[alert.type] || 'text-blue-400';
};

type WatchlistAlertsProps = Pick<AdminCommonProps, 'textClass' | 'mutedClass'> & {
  alerts: WatchlistAlert[];
  markAlertReviewed: (alertId: string) => void;
  markAllAlertsReviewed: () => void;
};

const WatchlistAlerts = ({
  textClass,
  mutedClass,
  alerts,
  markAlertReviewed,
  markAllAlertsReviewed,
}: WatchlistAlertsProps) => {
  if (alerts.length === 0) return null;
  const unreviewed = alerts.filter((a) => a.reviewed === false).length;
  return (
    <div className="p-3 rounded-sm light:bg-yellow-50 dark:bg-slate-700/50">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className={`text-sm font-bold ${textClass}`}>Recent Alerts ({alerts.length})</h3>
        {unreviewed > 0 && (
          <button
            onClick={markAllAlertsReviewed}
            className="px-2 py-1 text-xs font-semibold rounded-sm bg-amber-600 hover:bg-amber-700 text-white"
          >
            Mark all as reviewed
          </button>
        )}
      </div>
      <div className="space-y-1 max-h-60 overflow-y-auto">
        {alerts.map((alert) => (
          <div key={alert.id} className={`text-xs p-1.5 rounded light:bg-white dark:bg-slate-800 ${mutedClass}`}>
            <span className={`font-semibold ${alertColor(alert)}`}>
              <AdminIcon name={ALERT_ICONS[alert.type] || 'missions'} className="w-4 h-4 inline-block align-[-3px]" />
            </span>{' '}
            {alert.details}
            <span className="ml-1 opacity-50">{alert.timestamp ? new Date(alert.timestamp).toLocaleString() : ''}</span>
            {alert.reviewed === false && (
              <button
                onClick={() => markAlertReviewed(alert.id)}
                className="ml-2 underline opacity-70 hover:opacity-100"
              >
                mark reviewed
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default WatchlistAlerts;
