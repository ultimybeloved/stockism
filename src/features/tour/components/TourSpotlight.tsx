// The tour's dimmed screen with a lit-up window over the part it explains,
// framed by corner brackets like the rare cards. With nothing to light up,
// the whole screen dims.
import type { Box } from '../utils/placement';

const CORNERS = [
  'top-0 left-0 border-t-2 border-l-2',
  'top-0 right-0 border-t-2 border-r-2',
  'bottom-0 left-0 border-b-2 border-l-2',
  'bottom-0 right-0 border-b-2 border-r-2',
];

const SCRIM = 'rgba(0, 0, 0, 0.7)';

export default function TourSpotlight({ hole }: { hole: Box | null }) {
  if (!hole) return <div className="fixed inset-0" style={{ background: SCRIM }} />;
  return (
    <div
      className="fixed rounded-sm pointer-events-none transition-all duration-300 ease-out motion-reduce:transition-none"
      style={{ ...hole, boxShadow: `0 0 0 9999px ${SCRIM}` }}
    >
      {CORNERS.map((c) => (
        <span key={c} className={`absolute w-4 h-4 border-orange-500 ${c}`} />
      ))}
    </div>
  );
}
