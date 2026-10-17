import type { CSSProperties } from 'react';
import { getCosmeticStyles } from '../../../../utils/cosmetics';
import CosmeticLayers from '../../../../shared/components/cosmetics/CosmeticLayers';
import CosmeticName from '../../../../shared/components/cosmetics/CosmeticName';
import { GLOW_LAYERS } from '../../../../constants/cosmeticLayers';
import type { Cosmetic } from '../../../../constants/cosmetics';
import type { CosmeticStyle } from '../../../../rules/cosmetics';

// Backdrop scenes (and the Mastery effects) play on a small row, scaled down
// and cropped to the circle, so they move the way they do on the leaderboard.
const SCENE_W = 128;
const SCENE_H = 64;
const SCENE_SCALE = 0.5;
const FX_W = 72;
const FX_H = 30;

interface CosmeticSwatchProps {
  cosmetic: Cosmetic;
  style: CosmeticStyle;
  seedKey?: string | null;
}

// One owned cosmetic in My Look, as a 32px circle: names show "Aa" in the
// name's style, scenes play a cropped mini row, the effects that only fire now
// and then get a badge, and the rest keep their color (and animation class).
const CosmeticSwatch = ({ cosmetic, style, seedKey }: CosmeticSwatchProps) => {
  const looks = getCosmeticStyles({ [cosmetic.type]: cosmetic.id }, null, { seedKey, style });
  const circle = 'cos-swatch block w-full h-full rounded-full';

  if (cosmetic.type === 'nameColor') {
    return (
      <span
        className={`${circle} flex items-center justify-center overflow-hidden text-[13px] font-bold light:bg-slate-100 dark:bg-zinc-800`}
      >
        <CosmeticName name="Aa" styles={looks} />
      </span>
    );
  }

  // Effects that only fire now and then get a badge (styles/cosmetics/swatches.css).
  const fxKey = looks.layers.glow ? GLOW_LAYERS[looks.layers.glow] : '';
  if (fxKey && !fxKey.startsWith('mastery')) return <span className={`${circle} cos-sw cos-sw-${fxKey}`} />;

  // The Masteries rise off the row's top edge: play them on a tiny row low in the circle.
  if (looks.layers.glow) {
    return (
      <span className={`${circle} relative overflow-hidden bg-zinc-900`}>
        <span
          className={looks.rowClass}
          style={
            {
              ...looks.rowStyle,
              position: 'absolute',
              left: '50%',
              bottom: 0,
              width: FX_W,
              height: FX_H,
              transform: `translateX(-50%) scale(${SCENE_SCALE})`,
              transformOrigin: '50% 100%',
            } as CSSProperties
          }
        >
          <CosmeticLayers {...looks.layers} seedKey={seedKey} />
        </span>
      </span>
    );
  }

  if (looks.layers.backdrop) {
    return (
      <span className={`${circle} relative overflow-hidden light:bg-slate-100 dark:bg-zinc-900`}>
        <span
          className={`absolute left-1/2 top-1/2 ${looks.rowClass}`}
          style={
            {
              ...looks.rowStyle,
              position: 'absolute',
              width: SCENE_W,
              height: SCENE_H,
              transform: `translate(-50%, -50%) scale(${SCENE_SCALE})`,
            } as CSSProperties
          }
        >
          <CosmeticLayers {...looks.layers} seedKey={seedKey} />
        </span>
      </span>
    );
  }

  return <span className={`${circle} ${cosmetic.effectClass || ''}`} style={{ backgroundColor: cosmetic.color }} />;
};

export default CosmeticSwatch;
