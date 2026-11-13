import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { startDiscordLoginState, consumeDiscordLoginState } from './discordLoginState';

describe('discordLoginState', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('accepts the code it issued, once', () => {
    const state = startDiscordLoginState();
    expect(state).toMatch(/^[a-f0-9]{32}$/);
    expect(consumeDiscordLoginState(state)).toBe(true);
    expect(consumeDiscordLoginState(state)).toBe(false);
  });

  it('rejects a different or missing code', () => {
    startDiscordLoginState();
    expect(consumeDiscordLoginState('0'.repeat(32))).toBe(false);
    startDiscordLoginState();
    expect(consumeDiscordLoginState(null)).toBe(false);
  });

  it('rejects when nothing was started', () => {
    expect(consumeDiscordLoginState('0'.repeat(32))).toBe(false);
  });

  it('rejects a stale code', () => {
    vi.useFakeTimers();
    const state = startDiscordLoginState();
    vi.advanceTimersByTime(11 * 60 * 1000);
    expect(consumeDiscordLoginState(state)).toBe(false);
  });
});
