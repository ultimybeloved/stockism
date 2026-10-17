import { useSyncExternalStore } from 'react';
import { SOUNDS_CHANGED_EVENT, soundsEnabled } from '../../utils/sounds';

// Whether sound effects are on, kept live wherever the switch is flipped
// (the header button, Settings, or another tab).
const subscribe = (onChange: () => void) => {
  window.addEventListener(SOUNDS_CHANGED_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(SOUNDS_CHANGED_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
};

export const useSoundsEnabled = () => useSyncExternalStore(subscribe, soundsEnabled, () => false);
