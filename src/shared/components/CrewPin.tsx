import { crewPinSrc, pixelatedIfSvg } from '../../constants/crests';

// A crew's small pin: its pixel crest, or its logo for a crew without one.
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
  return <img src={src} alt={alt} className={`object-contain ${className}`} style={pixelatedIfSvg(src)} />;
};

export default CrewPin;
