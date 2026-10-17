import { memo } from 'react';
import { BACKDROP_LAYERS, GLOW_LAYERS } from '../../../constants/cosmeticLayers';
import { BD_MARKUP, FX_MARKUP } from '../../../constants/cosmeticMarkup';
import { banknoteSerial } from '../../../utils/cosmeticSeeds';
import TerminalQuotes from './TerminalQuotes';

interface CosmeticLayersProps {
  /** Equipped (or tried-on) backdrop id, from getCosmeticStyles().layers. */
  backdrop: string | null;
  /** Equipped (or tried-on) effect id. */
  glow: string | null;
  /** The player's name: seeds the Terminal quotes and the Banknote serial. */
  seedKey?: string | null;
}

// The scene's markup. Static strings from constants/cosmeticMarkup, plus the
// Banknote serial, which is only letters and digits.
const sceneHtml = (key: string, seedKey: string | null | undefined) => {
  if (key !== 'banknote') return BD_MARKUP[key] || '';
  const serial = banknoteSerial(seedKey);
  return `${BD_MARKUP.banknote}<i class="serial s1">${serial}</i><i class="serial s2">${serial}</i>`;
};

// The backdrop scene under a row's text and the effect over it, for the
// cosmetics that draw more than a color (effects.css explains how the layers
// stack). Put it first inside the row; the row takes getCosmeticStyles'
// rowClass, which makes room for it.
const CosmeticLayers = ({ backdrop, glow, seedKey }: CosmeticLayersProps) => {
  const bdKey = backdrop != null ? BACKDROP_LAYERS[backdrop] : undefined;
  const fxKey = glow != null ? GLOW_LAYERS[glow] : undefined;
  return (
    <>
      {bdKey === 'terminal' ? (
        <div className="cos-bd" aria-hidden="true">
          <TerminalQuotes seedKey={seedKey} />
        </div>
      ) : (
        bdKey !== undefined && (
          <div className="cos-bd" aria-hidden="true" dangerouslySetInnerHTML={{ __html: sceneHtml(bdKey, seedKey) }} />
        )
      )}
      {fxKey !== undefined && (
        <div className="cos-fx" aria-hidden="true" dangerouslySetInnerHTML={{ __html: FX_MARKUP[fxKey] || '' }} />
      )}
    </>
  );
};

export default memo(CosmeticLayers);
