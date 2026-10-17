import { PIXELATED } from '../../constants/crests';

interface PixelIconProps {
  name: string;
  className?: string;
  alt?: string;
  /** Another folder under public/pins: the bot's icons, the admin set, or the crests. */
  set?: 'ui' | 'discord' | 'admin' | 'crests';
}

// A pixel-art site icon from public/pins/ui/ (drawn by scripts/pixel-ui.cjs),
// used where the site once showed an emoji. Decorative unless given alt text.
const PixelIcon = ({ name, className = 'w-4 h-4', alt = '', set = 'ui' }: PixelIconProps) => (
  <img
    src={`/pins/${set}/${name}.svg`}
    alt={alt}
    aria-hidden={alt ? undefined : true}
    className={`inline-block shrink-0 ${className}`}
    style={PIXELATED}
    draggable={false}
  />
);

export default PixelIcon;
