import { describe, it, expect } from 'vitest';
import {
  getNotificationRoute,
  getNotificationCategory,
  getNotificationMeta,
  hasExpandableDetail,
} from './notifications';

describe('getNotificationRoute', () => {
  it('routes ticker notifications to the stock page', () => {
    expect(getNotificationRoute({ type: 'trade', data: { ticker: 'KTAE' } })).toBe('/stock/KTAE');
    expect(getNotificationRoute({ type: 'alert', data: { ticker: 'GUN', price: 5 } })).toBe('/stock/GUN');
  });

  it('routes prediction/market payouts to the predictions page', () => {
    expect(getNotificationRoute({ type: 'system', data: { predictionId: 'p1' } })).toBe('/predictions');
    expect(getNotificationRoute({ type: 'system', data: { marketId: 'm1' } })).toBe('/predictions');
  });

  it('routes achievements to the achievements page when no ticker is present', () => {
    expect(getNotificationRoute({ type: 'achievement', data: {} })).toBe('/achievements');
  });

  it('prefers the stock page when a ticker is present even for other types', () => {
    expect(getNotificationRoute({ type: 'margin', data: { ticker: 'SHNG' } })).toBe('/stock/SHNG');
  });

  it('returns null when there is no natural destination (e.g. dividends)', () => {
    expect(getNotificationRoute({ type: 'dividend', data: { total: 50 } })).toBeNull();
    expect(getNotificationRoute({ type: 'system', data: {} })).toBeNull();
    expect(getNotificationRoute({})).toBeNull();
  });
});

describe('getNotificationCategory', () => {
  it('maps each type to its filter tab', () => {
    expect(getNotificationCategory({ type: 'trade' })).toBe('Trades');
    expect(getNotificationCategory({ type: 'alert' })).toBe('Alerts');
    expect(getNotificationCategory({ type: 'margin' })).toBe('Alerts');
    expect(getNotificationCategory({ type: 'achievement' })).toBe('Rewards');
    expect(getNotificationCategory({ type: 'dividend' })).toBe('Rewards');
    expect(getNotificationCategory({ type: 'system' })).toBe('Rewards');
  });

  it('falls back to Rewards for unknown types', () => {
    expect(getNotificationCategory({ type: 'mystery' })).toBe('Rewards');
    expect(getNotificationCategory({})).toBe('Rewards');
  });
});

describe('getNotificationMeta', () => {
  it('returns an icon for every known type and a default otherwise', () => {
    expect(getNotificationMeta({ type: 'trade' }).icon).toBe('📈');
    expect(getNotificationMeta({ type: 'dividend' }).icon).toBe('💰');
    expect(getNotificationMeta({ type: 'unknown' }).icon).toBe('📢');
  });
});

describe('hasExpandableDetail', () => {
  it('is true for dividend breakdowns', () => {
    expect(hasExpandableDetail({ type: 'dividend', data: { breakdown: { KTAE: 10 } } })).toBe(true);
  });

  it('is true for long messages', () => {
    expect(hasExpandableDetail({ message: 'x'.repeat(120) })).toBe(true);
  });

  it('is false for short messages with no breakdown', () => {
    expect(hasExpandableDetail({ message: 'Short one', data: {} })).toBe(false);
  });
});
