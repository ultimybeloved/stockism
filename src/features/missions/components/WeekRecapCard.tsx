import type { WeeklyRecap } from '../../../rules/weeklyRecap';
import { themeClasses } from '../../../utils/theme';
import { SHARE_PIXEL_RATIO, useShareImage } from '../../../shared/hooks/useShareImage';
import WeekRecapSlip, { NOTCH_RADIUS, PERFORATION_Y, SLIP_WIDTH } from './WeekRecapSlip';

/** Cut the slip's side notches out of the picture (it can't keep the page's mask). */
const punchNotches = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.globalCompositeOperation = 'destination-out';
  for (const x of [0, canvas.width]) {
    ctx.beginPath();
    ctx.arc(x, PERFORATION_Y * SHARE_PIXEL_RATIO, NOTCH_RADIUS * SHARE_PIXEL_RATIO, 0, Math.PI * 2);
    ctx.fill();
  }
};

// The Weekly Slip: last week's summary, from the recap the server stores at the
// Thursday reopen, with Copy image, Save image (the share sheet on phones) and
// Close below it. Both draw a hidden copy at SLIP_WIDTH, so a phone and a
// computer get the same picture whatever width the slip has on screen.
export default function WeekRecapCard({ recap, onClose }: { recap: WeeklyRecap; onClose?: () => void }) {
  const { ref, busy, note, canCopy, copyImage, saveImage } = useShareImage(
    `stockism-week-${recap.weekId}.png`,
    punchNotches,
  );
  const { mutedClass, ghostBtnClass } = themeClasses;
  const btn = `px-2.5 py-1 text-xs font-semibold rounded-sm border ${ghostBtnClass} disabled:opacity-50`;

  return (
    <div style={{ maxWidth: SLIP_WIDTH }} className="mx-auto">
      <WeekRecapSlip recap={recap} />
      {busy && (
        <div aria-hidden className="fixed top-0 -left-[10000px]" style={{ width: SLIP_WIDTH }}>
          <WeekRecapSlip ref={ref} recap={recap} />
        </div>
      )}
      <div className="mt-2 flex items-center justify-end gap-2">
        {note && <span className={`text-xs ${mutedClass}`}>{note}</span>}
        {canCopy && (
          <button onClick={() => void copyImage()} disabled={!!busy} className={btn}>
            {busy === 'copy' ? 'Copying...' : 'Copy image'}
          </button>
        )}
        <button onClick={() => void saveImage()} disabled={!!busy} className={btn}>
          {busy === 'save' ? 'Saving...' : 'Save image'}
        </button>
        {onClose && (
          <button onClick={onClose} className={btn} title="Find it again on the Missions page">
            Close
          </button>
        )}
      </div>
    </div>
  );
}
