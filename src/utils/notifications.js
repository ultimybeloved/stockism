// ============================================
// NOTIFICATION HELPERS (pure — no React, no Firebase)
// Shared by NotificationPanel and NotificationRow.
// ============================================

// Per-type display metadata. `colorKey` maps to a small palette in the row
// component so we never inline duplicate theme strings here.
// Notification types written by the backend (functions/helpers.js writeNotification):
// trade, alert, achievement, margin, system, dividend.
export const NOTIFICATION_META = {
  trade:       { icon: '📈', colorKey: 'green',   category: 'Trades' },
  alert:       { icon: '🔔', colorKey: 'blue',    category: 'Alerts' },
  margin:      { icon: '⚠️', colorKey: 'amber',   category: 'Alerts' },
  achievement: { icon: '🏆', colorKey: 'gold',    category: 'Rewards' },
  dividend:    { icon: '💰', colorKey: 'emerald', category: 'Rewards' },
  system:      { icon: '💵', colorKey: 'violet',  category: 'Rewards' },
};

const DEFAULT_META = { icon: '📢', colorKey: 'gray', category: 'Rewards' };

export const FILTER_TABS = ['All', 'Trades', 'Alerts', 'Rewards'];

// Lookup metadata for a notification, falling back to a safe default for any
// unknown/new type so the UI never breaks.
export const getNotificationMeta = (notification) =>
  NOTIFICATION_META[notification?.type] || DEFAULT_META;

// Which filter tab a notification belongs to.
export const getNotificationCategory = (notification) =>
  getNotificationMeta(notification).category;

// Where clicking a notification should take the user, or null if there's no
// natural destination (e.g. dividends, which expand to show a breakdown instead).
export const getNotificationRoute = (notification) => {
  const data = notification?.data || {};
  if (data.ticker) return `/stock/${data.ticker}`;
  if (data.predictionId || data.marketId) return '/predictions';
  if (notification?.type === 'achievement') return '/achievements';
  return null;
};

// True when a notification has extra detail worth expanding inline (used to
// decide whether to show the expand affordance). Dividends carry a per-ticker
// breakdown; long messages are also worth expanding past the 2-line clamp.
export const hasExpandableDetail = (notification) => {
  const data = notification?.data || {};
  if (data.breakdown && Object.keys(data.breakdown).length > 0) return true;
  if (data.reinvestedBreakdown && Object.keys(data.reinvestedBreakdown).length > 0) return true;
  return (notification?.message || '').length > 90;
};
