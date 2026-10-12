// Pixel-art crew crests (public/pins/crests/, drawn by scripts/pixel-crests.cjs).
// They replace a crew's logo only where it shows as a small pin next to a
// name; the full logo stays everywhere a crew is shown large.
import type { CSSProperties } from 'react';

const CRESTED = new Set([
  'ALLIED',
  'BIG_DEAL',
  'FIST_GANG',
  'GOD_DOG',
  'HOSTEL',
  'KITAE_UNION',
  'SECRET_FRIENDS',
  'WORKERS',
  'WTJC',
  'YAMAZAKI',
]);

/** The crew's pin image: its pixel crest, or its logo for a crew without one. */
export const crewPinSrc = (crew: { id: string; icon?: string }): string | undefined =>
  CRESTED.has(crew.id) ? `/pins/crests/${crew.id.toLowerCase()}.svg` : crew.icon;

export const CREW_HEAD_PIN = '/pins/crests/crew_head.svg';

/** Keeps pixel art crisp when the browser scales it. */
export const PIXELATED: CSSProperties = { imageRendering: 'pixelated' };
