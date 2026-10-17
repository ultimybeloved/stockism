import { useEffect, type RefObject } from 'react';

// Most cosmetics rest for a few seconds, then do their thing. On the shop's
// preview row that wait would look like nothing happened, so whenever the
// tried-on set changes, each animation skips ahead to just before its first
// visible moment.
//
// Animations are grouped by layer (name, backdrop, effect, the row's own edge)
// and every animation in a layer moves forward by the same amount, so
// staggered sparks and bolts keep their spacing instead of all firing at once.
// A few effects that move all the time but have a big moment later get a fixed
// start instead (JUMP_MS).
const JUMP_MS: Record<string, number> = {
  cosRainX: 7600,
  cosRainY: 7600,
  cosHolo: 4900,
  cosSparkle: 4900,
  cosCash: 3000,
  cosCashPopA: 3000,
  cosCashPopB: 3000,
  // Trading Floor ticks a candle in about a second after you try it on.
  cosCandles: 5000,
};
const MIN_LOOP_MS = 2500;
const LEAD_MS = 300;
const TIMING_KEYS = new Set(['offset', 'computedOffset', 'easing', 'composite']);

const skipIdle = (row: HTMLElement) => {
  const groups: Record<string, [Animation, number][]> = {};
  for (const a of row.getAnimations({ subtree: true })) {
    const name = (a as CSSAnimation).animationName;
    if (name && JUMP_MS[name] != null) {
      a.currentTime = JUMP_MS[name]!;
      continue;
    }
    const effect = a.effect as KeyframeEffect | null;
    if (!effect) continue;
    const timing = effect.getTiming();
    const dur = timing.duration;
    const frames = effect.getKeyframes();
    if (typeof dur !== 'number' || dur < MIN_LOOP_MS || frames.length < 3) continue;
    const first = frames[0]!;
    const props = Object.keys(first).filter((p) => !TIMING_KEYS.has(p));
    let hold = 0;
    for (let i = 1; i < frames.length && props.every((p) => frames[i]![p] === first[p]); i++) {
      hold = frames[i]!.computedOffset as number;
    }
    if (hold <= 0.2) continue;
    const delay = timing.delay || 0;
    // time from now until this animation's first visible moment
    const until = delay >= 0 ? delay + hold * dur : (((hold * dur + delay) % dur) + dur) % dur;
    const el = effect.target as Element | null;
    const layer = el?.closest('.cos-fx') ? 'fx' : el?.closest('.cos-bd') ? 'bd' : el === row ? 'row' : 'name';
    (groups[layer] ||= []).push([a, until]);
  }
  for (const list of Object.values(groups)) {
    const shift = Math.max(0, Math.min(...list.map(([, until]) => until)) - LEAD_MS);
    for (const [a] of list) a.currentTime = shift;
  }
};

export const useInstantPreview = (ref: RefObject<HTMLElement | null>, key: string) => {
  useEffect(() => {
    const row = ref.current;
    if (!row || typeof row.getAnimations !== 'function') return;
    // Wait a frame so the new pieces have started their animations.
    const id = requestAnimationFrame(() => skipIdle(row));
    return () => cancelAnimationFrame(id);
  }, [ref, key]);
};
