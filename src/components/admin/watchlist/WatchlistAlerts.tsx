import type { AdminCommonProps } from '../types';
import type { WatchlistAlert } from '../../../api/types';

const ALERT_ICONS: Record<string, string> = {
  alt_suspected: '🕵️',
  account_blocked: '🚫',
  account_linked: '🔗',
  new_ip_detected: '🌐',
  duplicate_username: '📛',
  user_added: '👁️',
  user_removed: '❌',
  ip_added: '📍',
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

type WatchlistAlertsProps = Pick<AdminCommonProps, 'darkMode' | 'textClass' | 'mutedClass'> & {
  alerts: WatchlistAlert[];
  markAlertReviewed: (alertId: string) => void;
};

const WatchlistAlerts = ({ darkMode, textClass, mutedClass, alerts, markAlertReviewed }: WatchlistAlertsProps) => {
  if (alerts.length === 0) return null;
  return (
    <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-yellow-50'}`}>
      <h3 className={`text-sm font-bold mb-2 ${textClass}`}>Recent Alerts ({alerts.length})</h3>
      <div className="space-y-1 max-h-60 overflow-y-auto">
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className={`text-xs p-1.5 rounded ${darkMode ? 'bg-slate-800' : 'bg-white'} ${mutedClass}`}
          >
            <span className={`font-semibold ${alertColor(alert)}`}>{ALERT_ICONS[alert.type] || '📋'}</span>{' '}
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
