// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { playSound, setSoundVolume, setSoundsEnabled, soundVolume, soundsEnabled } from './sounds';

describe('sound settings', () => {
  beforeEach(() => localStorage.clear());

  it('starts off with a middle volume', () => {
    expect(soundsEnabled()).toBe(false);
    expect(soundVolume()).toBe(0.5);
  });

  it('remembers the switch and the volume', () => {
    setSoundsEnabled(true);
    setSoundVolume(0.8);
    expect(soundsEnabled()).toBe(true);
    expect(soundVolume()).toBe(0.8);
    setSoundsEnabled(false);
    expect(soundsEnabled()).toBe(false);
  });

  it('clamps a bad stored volume', () => {
    localStorage.setItem('stockism.soundVolume', '7');
    expect(soundVolume()).toBe(1);
  });

  it('never throws, with or without audio support', () => {
    setSoundsEnabled(true);
    expect(() => playSound('buy')).not.toThrow();
    expect(() => playSound('notify', { background: true })).not.toThrow();
  });
});
