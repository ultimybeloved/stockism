import type { CSSProperties } from 'react';
import { COSMETIC_MAP } from '../constants/cosmetics';
import { BACKDROP_LAYERS, GLOW_LAYERS } from '../constants/cosmeticLayers';
import { frameSeed, BULLBEAR_FRAME_ID, type CosmeticStyle, type FrameTrend } from '../rules/cosmetics';
import { tickerTapeStyle } from './tickerTape';
import type { ActiveCosmetics, SeasonTitle, UserData } from '../types';

// Resolve a user's equipped cosmetics into ready-to-apply pieces. Centralizes the
// COSMETIC_MAP lookups and the animated-vs-static logic that used to be copy-pasted
// across the profile header, profile modal, and leaderboard row.
//
// - Static name and glow colors come back as `nameColor` / `glowColor` (the
//   caller builds the exact inline glow, so each surface keeps its own
//   intensity).
// - Animated cosmetics come back as CSS classes: `nameClass` for the name,
//   `rowClass` for the row (glows, frames, backdrops, the plain backdrop tint).
// - Backdrops and effects that draw a scene come back in `layers`: render
//   <CosmeticLayers {...layers} seedKey=.../> first inside the row. Animated
//   backdrops are dark scenes, so rowClass also carries `dark` (the row keeps
//   dark-mode text in light mode) and `cos-busy` (a soft text shadow).
// Apply `rowStyle` (frame seed, ticker tape, backdrop tint color) to the row's
// style and `frameTrend` as its data-trend attribute.
//
// `ownedCosmetics` is optional: server payloads (leaderboard, public profile)
// arrive pre-filtered to owned items, so callers rendering them pass nothing.
// Callers with the full user doc (own profile header) pass the owned list so
// an unowned equip never renders, even for the owner.
//
// `frame` (optional) personalises things: `seedKey` (the player's name) offsets
// frame animations so identical frames never move in step and seeds the
// per-player backdrops; `trend` drives the Bull / Bear frame; `style` is the
// player's cosmetic style choices (rules/cosmetics).
export const getCosmeticStyles = (
  activeCosmetics: ActiveCosmetics | null | undefined = {},
  ownedCosmetics: string[] | null | undefined = null,
  frame: { seedKey?: string | null; trend?: FrameTrend | 'split'; style?: CosmeticStyle | null } = {},
) => {
  let ac: ActiveCosmetics = activeCosmetics && typeof activeCosmetics === 'object' ? activeCosmetics : {};
  if (Array.isArray(ownedCosmetics)) {
    ac = Object.fromEntries(Object.entries(ac).filter(([, id]) => id == null || ownedCosmetics.includes(id)));
  }
  const nameC = ac.nameColor ? COSMETIC_MAP[ac.nameColor] : null;
  const glowC = ac.rowGlow ? COSMETIC_MAP[ac.rowGlow] : null;
  const backC = ac.rowBackdrop ? COSMETIC_MAP[ac.rowBackdrop] : null;
  const frameC = ac.rowFrame ? COSMETIC_MAP[ac.rowFrame] : null;
  const style = frame.style || {};

  const glowLayer = glowC && glowC.id in GLOW_LAYERS ? glowC.id : null;
  const backdropLayer = backC && backC.id in BACKDROP_LAYERS ? backC.id : null;
  // Plain color backdrops paint a tint on the row itself.
  const tint = backC && !backC.effectClass ? backC.color : undefined;
  const trend = frameC?.id === BULLBEAR_FRAME_ID && style.bullbear === 'split' ? 'split' : frame.trend;

  return {
    // Static name color (animated name effects render via nameClass instead).
    nameColor: nameC && !nameC.effectClass ? nameC.color : undefined,
    nameClass: nameC?.effectClass || '',
    /** The equipped name's id, for the names CosmeticName draws itself. */
    nameId: nameC?.id || null,
    // Static glow base color — caller applies its own alpha/spread.
    glowColor: glowC && !glowC.effectClass ? glowC.color : undefined,
    /** A plain color backdrop is equipped (its tint comes with rowClass/rowStyle). */
    backdropColor: backC ? backC.color : undefined,
    // Animated glow, frame and backdrop classes (the row needs `position: relative`).
    rowClass: [
      glowC?.effectClass,
      frameC?.effectClass,
      backC?.effectClass,
      glowLayer || backdropLayer ? 'cos-row' : '',
      backdropLayer ? 'dark cos-busy' : '',
      tint ? (style.tint === 'solid' ? 'cos-tint-solid' : 'cos-tint-fade') : '',
    ]
      .filter(Boolean)
      .join(' '),
    rowStyle: {
      ...(frameC?.effectClass
        ? {
            ...seedStyle(frame.seedKey),
            ...(frameC.id === TICKER_FRAME_ID ? tickerTapeStyle(frame.seedKey) : {}),
          }
        : {}),
      ...(tint ? { '--cos-tint': tint } : {}),
    } as CSSProperties,
    frameTrend: frameC?.effectClass ? trend || undefined : undefined,
    layers: { backdrop: backdropLayer, glow: glowLayer },
    flapStyle: style.flap || 'random',
  };
};

export type CosmeticStyles = ReturnType<typeof getCosmeticStyles>;

const TICKER_FRAME_ID = 'frame_ticker';

const seedStyle = (key: string | null | undefined): CSSProperties => {
  const { seconds, degrees } = frameSeed(key);
  return { '--cos-seed': seconds, '--cos-start': `${degrees}deg` } as CSSProperties;
};

// The season tier a title belongs to, read off its id (adminEndSeason ends every
// season title id with the tier), or null for a plain title.
export const titleTier = (id: string | null | undefined) =>
  /_(bronze|silver|gold|platinum|diamond)$/.exec(id || '')?.[1] ?? null;

// The season title to show under a player's name, or null.
//
// Server payloads (leaderboard, public profile) already arrive as a validated
// { id, text } on `title`. The own-profile surfaces hold the raw user doc
// instead, where activeTitle is client-writable — so an unowned equip is dropped
// here the same way the server drops it, and the label comes from titleMeta,
// which only adminEndSeason writes.
export const getActiveTitle = (userData: UserData | null | undefined): SeasonTitle | null => {
  if (userData?.title) return userData.title;
  const id = userData?.activeTitle;
  if (typeof id !== 'string' || !id) return null;
  if (!Array.isArray(userData?.ownedTitles) || !userData.ownedTitles.includes(id)) return null;
  return { id, text: userData?.titleMeta?.[id] || id };
};
