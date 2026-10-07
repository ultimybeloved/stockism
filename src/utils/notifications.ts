// ============================================
// NOTIFICATION HELPERS (pure — no React, no Firebase)
// Shared by NotificationPanel and NotificationRow.
// ============================================

// Per-type display metadata. `colorKey` maps to a small palette in the row
// component so we never inline duplicate theme strings here.
// Notification types written by the backend (functions/helpers.js writeNotification):
// trade, alert, achievement, margin, system, dividend, loyalty.
export interface NotificationMeta {
  icon: string;
  colorKey: string;
  category: string;
}

export interface AppNotification {
  type?: string;
  message?: string;
  data?: {
    ticker?: string;
    predictionId?: string;
    marketId?: string;
    breakdown?: object;
    reinvestedBreakdown?: object;
    tiers?: object;
    [key: string]: unknown;
  };
}

export const NOTIFICATION_META: Record<string, NotificationMeta> = {
  trade: { icon: '📈', colorKey: 'green', category: 'Trades' },
  alert: { icon: '🔔', colorKey: 'blue', category: 'Alerts' },
  announcement: { icon: '📢', colorKey: 'blue', category: 'Alerts' },
  margin: { icon: '⚠️', colorKey: 'amber', category: 'Alerts' },
  achievement: { icon: '🏆', colorKey: 'gold', category: 'Rewards' },
  dividend: { icon: '💰', colorKey: 'emerald', category: 'Rewards' },
  loyalty: { icon: '🎖️', colorKey: 'gold', category: 'Rewards' },
  system: { icon: '💵', colorKey: 'violet', category: 'Rewards' },
};

const DEFAULT_META: NotificationMeta = { icon: '📢', colorKey: 'gray', category: 'Rewards' };

export const FILTER_TABS = ['All', 'Trades', 'Alerts', 'Rewards'];

// Lookup metadata for a notification, falling back to a safe default for any
// unknown/new type so the UI never breaks.
export const getNotificationMeta = (notification: AppNotification | null | undefined): NotificationMeta =>
  NOTIFICATION_META[notification?.type ?? ''] || DEFAULT_META;

// Which filter tab a notification belongs to.
export const getNotificationCategory = (notification: AppNotification | null | undefined): string =>
  getNotificationMeta(notification).category;

// Where clicking a notification should take the user, or null if there's no
// natural destination (e.g. dividends, which expand to show a breakdown instead).
export const getNotificationRoute = (notification: AppNotification | null | undefined): string | null => {
  const data = notification?.data || {};
  if (data.ticker) return `/stock/${data.ticker}`;
  if (data.predictionId || data.marketId) return '/predictions';
  if (notification?.type === 'achievement') return '/achievements';
  return null;
};

// True when a notification has extra detail worth expanding inline (used to
// decide whether to show the expand affordance). Dividends carry a per-ticker
// breakdown; long messages are also worth expanding past the 2-line clamp.
export const hasExpandableDetail = (notification: AppNotification | null | undefined): boolean => {
  const data = notification?.data || {};
  if (data.breakdown && Object.keys(data.breakdown).length > 0) return true;
  if (data.reinvestedBreakdown && Object.keys(data.reinvestedBreakdown).length > 0) return true;
  // A loyalty digest only has more to show when several holdings levelled up.
  if (data.tiers && Object.keys(data.tiers).length > 1) return true;
  return (notification?.message || '').length > 90;
};
