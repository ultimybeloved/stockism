import type { CSSProperties } from 'react';
import { CORRUPTED_ID, SPLIT_FLAP_ID } from '../../../constants/cosmeticLayers';
import type { CosmeticStyles } from '../../../utils/cosmetics';
import SplitFlap from './SplitFlap';

interface CosmeticNameProps {
  name: string;
  styles: Pick<CosmeticStyles, 'nameClass' | 'nameColor' | 'nameId' | 'flapStyle'>;
  /** Overrides the name color when no name cosmetic is on (crew head color). */
  fallbackColor?: string;
  className?: string;
}

// A player's name wearing their name cosmetic: a plain color, an animated class,
// or one of the names that need their own markup (Split Flap tiles, the torn
// copies Corrupted draws from data-t). Wrap it in the link or span the surface
// needs; the effect lives on this inner span.
const CosmeticName = ({ name, styles, fallbackColor, className = '' }: CosmeticNameProps) => {
  const { nameClass, nameColor, nameId, flapStyle } = styles;
  const cls = `${nameClass} ${className}`.trim();
  if (nameId === SPLIT_FLAP_ID) return <SplitFlap text={name} mode={flapStyle} className={cls} />;
  if (nameId === CORRUPTED_ID) {
    return (
      <span className={cls} data-t={name}>
        {name}
        <i aria-hidden="true" />
      </span>
    );
  }
  const style: CSSProperties | undefined = nameClass ? undefined : { color: nameColor || fallbackColor };
  return (
    <span className={cls || undefined} style={style}>
      {name}
    </span>
  );
};

export default CosmeticName;
