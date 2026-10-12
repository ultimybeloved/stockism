import { PIXELATED } from '../../constants/crests';

// A pixel-art site icon from public/pins/ui/ (drawn by scripts/pixel-ui.cjs),
// used where the site once showed an emoji. Decorative unless given alt text.
const PixelIcon = ({ name, className = 'w-4 h-4', alt = '' }: { name: string; className?: string; alt?: string }) => (
  <img
    src={`/pins/ui/${name}.svg`}
    alt={alt}
    aria-hidden={alt ? undefined : true}
    className={`inline-block shrink-0 ${className}`}
    style={PIXELATED}
    draggable={false}
  />
);

export default PixelIcon;
