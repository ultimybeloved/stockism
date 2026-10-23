import { useState } from 'react';
import { crewPinSrc, pixelatedIfSvg } from '../../constants/crests';
import { useRivalryGlow } from '../hooks/useRivalryGlow';

// The rivalry winners' soft gold glow. Wider on big crests so it still reads.
const GLOW_SMALL = 'drop-shadow(0 0 2px #feae34) drop-shadow(0 0 4px #f77622)';
const GLOW_BIG = 'drop-shadow(0 0 4px #feae34) drop-shadow(0 0 10px #f77622)';

// A crew's small pin: its pixel crest, or its logo for a crew without one. It
// glows for the week after the crew wins its rivalry.
const CrewPin = ({
  crew,
  className = 'w-4 h-4',
  alt = '',
}: {
  crew?: { id: string; icon?: string };
  className?: string;
  alt?: string;
}) => {
  const src = crewPinSrc(crew);
  const glow = useRivalryGlow(crew?.id);
  const [big, setBig] = useState(false);
  return (
    <img
      src={src}
      alt={alt}
      className={`object-contain ${className}`}
      style={{ ...pixelatedIfSvg(src), ...(glow ? { filter: big ? GLOW_BIG : GLOW_SMALL } : {}) }}
      title={glow ? 'Won its rivalry last week' : undefined}
      onLoad={(e) => setBig(e.currentTarget.clientWidth >= 32)}
    />
  );
};

export default CrewPin;
