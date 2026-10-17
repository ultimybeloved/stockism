// 8-bit sound effects, made in code with Web Audio (no sound files). Off
// unless the player turns them on in Settings; the choice and the volume are
// kept per device in localStorage.

export type SoundName =
  | 'buy'
  | 'sell'
  | 'short'
  | 'cover'
  | 'limit'
  | 'error'
  | 'coin'
  | 'achievement'
  | 'levelup'
  | 'purchase'
  | 'sparkle'
  | 'notify'
  | 'alert'
  | 'margin'
  | 'rung'
  | 'ladderWin'
  | 'ladderLose';

const ENABLED_KEY = 'stockism.sounds';
const VOLUME_KEY = 'stockism.soundVolume';
const DEFAULT_VOLUME = 0.5;
// A background sound (a notification landing) skips itself if another sound
// played this recently: the action that caused it already made its own.
const BACKGROUND_QUIET_MS = 3000;

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the setting just won't stick */
  }
};

export const soundsEnabled = () => read(ENABLED_KEY) === 'on';
export const soundVolume = () => {
  const v = Number(read(VOLUME_KEY));
  return read(VOLUME_KEY) !== null && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_VOLUME;
};
export const setSoundsEnabled = (on: boolean) => write(ENABLED_KEY, on ? 'on' : 'off');
export const setSoundVolume = (v: number) => write(VOLUME_KEY, String(v));

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let lastPlayed = 0;

const audio = () => {
  if (!ctx) {
    const Ctor =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  master!.gain.value = soundVolume();
  return ctx;
};

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// One note: wave, pitch in Hz (or [from, to] for a slide), start offset, length, loudness.
function tone(
  c: AudioContext,
  type: OscillatorType,
  freq: number | [number, number],
  at: number,
  len: number,
  vol: number,
) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  const t = c.currentTime + at;
  if (Array.isArray(freq)) {
    o.frequency.setValueAtTime(freq[0], t);
    o.frequency.exponentialRampToValueAtTime(freq[1], t + len);
  } else o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + len + 0.02);
}

// A short fading burst of noise (the stamp, the register drawer).
function noise(c: AudioContext, at: number, len: number, vol: number, highpass: number) {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = c.createBufferSource();
  s.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = highpass;
  const g = c.createGain();
  g.gain.value = vol;
  s.connect(f).connect(g).connect(master!);
  s.start(c.currentTime + at);
}

const sq = (c: AudioContext, n: number, at: number, len: number, vol = 0.12) =>
  tone(c, 'square', midi(n), at, len, vol);
const coin = (c: AudioContext, at = 0) => {
  sq(c, 83, at, 0.06, 0.1);
  sq(c, 88, at + 0.06, 0.3, 0.1);
};

const SOUNDS: Record<SoundName, (c: AudioContext) => void> = {
  buy: (c) => {
    sq(c, 72, 0, 0.07);
    sq(c, 79, 0.07, 0.12);
  },
  sell: (c) => {
    sq(c, 83, 0, 0.06);
    sq(c, 88, 0.06, 0.25);
  },
  short: (c) => {
    sq(c, 76, 0, 0.07);
    sq(c, 69, 0.07, 0.14);
  },
  cover: (c) => {
    tone(c, 'triangle', midi(67), 0, 0.05, 0.3);
    tone(c, 'triangle', midi(72), 0.05, 0.1, 0.3);
  },
  limit: (c) => {
    noise(c, 0, 0.04, 0.25, 2000);
    tone(c, 'triangle', midi(60), 0, 0.08, 0.3);
  },
  error: (c) => {
    tone(c, 'square', 110, 0, 0.09, 0.1);
    tone(c, 'square', 104, 0.12, 0.14, 0.1);
  },
  coin: (c) => coin(c),
  achievement: (c) => [72, 76, 79, 84].forEach((n, i) => sq(c, n, i * 0.08, i === 3 ? 0.35 : 0.09, 0.1)),
  levelup: (c) => {
    [60, 64, 67, 72, 76, 79].forEach((n, i) => sq(c, n, i * 0.06, 0.08, 0.09));
    sq(c, 84, 0.38, 0.5, 0.1);
    tone(c, 'triangle', midi(72), 0.38, 0.5, 0.25);
  },
  purchase: (c) => {
    noise(c, 0, 0.08, 0.15, 3000);
    sq(c, 88, 0.05, 0.08, 0.08);
    sq(c, 91, 0.12, 0.35, 0.08);
  },
  sparkle: (c) => [88, 91, 95, 100].forEach((n, i) => tone(c, 'sine', midi(n), i * 0.05, 0.2, 0.15)),
  notify: (c) => {
    tone(c, 'sine', midi(81), 0, 0.15, 0.2);
    tone(c, 'sine', midi(88), 0.09, 0.3, 0.18);
  },
  alert: (c) => [84, 88, 91].forEach((n, i) => tone(c, 'triangle', midi(n), i * 0.11, 0.25, 0.3)),
  margin: (c) => {
    for (let i = 0; i < 3; i++) {
      sq(c, 76, i * 0.28, 0.13, 0.08);
      sq(c, 71, i * 0.28 + 0.14, 0.13, 0.08);
    }
  },
  rung: (c) => sq(c, 72, 0, 0.04, 0.08),
  ladderWin: (c) => {
    [72, 74, 76, 79, 84].forEach((n, i) => sq(c, n, i * 0.06, 0.07, 0.1));
    coin(c, 0.33);
  },
  ladderLose: (c) => {
    tone(c, 'square', [midi(67), midi(55)], 0, 0.35, 0.1);
    tone(c, 'square', [midi(62), midi(48)], 0.35, 0.5, 0.1);
  },
};

/**
 * Play a sound if the player has sounds on. `background` marks sounds nobody
 * directly caused (a notification arriving); those stay quiet right after
 * another sound so one action never plays twice.
 */
export function playSound(name: SoundName, { background = false, force = false } = {}) {
  if (!force && !soundsEnabled()) return;
  const now = Date.now();
  if (background && now - lastPlayed < BACKGROUND_QUIET_MS) return;
  try {
    const c = audio();
    if (!c) return;
    SOUNDS[name](c);
    lastPlayed = now;
  } catch {
    /* sound is decoration: never let it break anything */
  }
}
