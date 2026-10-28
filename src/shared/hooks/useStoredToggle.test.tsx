// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStoredToggle } from './useStoredToggle';

describe('useStoredToggle', () => {
  beforeEach(() => localStorage.clear());

  it('starts at the default and keeps the choice', () => {
    const { result } = renderHook(() => useStoredToggle('test-a'));
    expect(result.current[0]).toBe(false);
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem('toggle:test-a')).toBe('1');
  });

  it('updates every user of the same key together', () => {
    const one = renderHook(() => useStoredToggle('test-b'));
    const two = renderHook(() => useStoredToggle('test-b'));
    act(() => one.result.current[1]());
    expect(two.result.current[0]).toBe(true);
  });
});
