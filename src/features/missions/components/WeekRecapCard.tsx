import { useRef, useState } from 'react';
import type { WeeklyRecap } from '../../../rules/weeklyRecap';
import { themeClasses } from '../../../utils/theme';
import WeekRecapSlip, { NOTCH_RADIUS, PERFORATION_Y } from './WeekRecapSlip';

const PIXEL_RATIO = 2;

/** Cut the slip's side notches out of the picture (it can't keep the page's mask). */
const punchNotches = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.globalCompositeOperation = 'destination-out';
  for (const x of [0, canvas.width]) {
    ctx.beginPath();
    ctx.arc(x, PERFORATION_Y * PIXEL_RATIO, NOTCH_RADIUS * PIXEL_RATIO, 0, Math.PI * 2);
    ctx.fill();
  }
};

// The Weekly Slip: last week's summary, from the recap the server stores at the
// Thursday reopen, with Save image (the share sheet on phones) and Close
// below it. The slip is capped in width, so the picture never comes out a strip.
export default function WeekRecapCard({ recap, onClose }: { recap: WeeklyRecap; onClose?: () => void }) {
  const slipRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const { mutedClass, ghostBtnClass } = themeClasses;
  const fileName = `stockism-week-${recap.weekId}.png`;
  const btn = `px-2.5 py-1 text-xs font-semibold rounded-sm border ${ghostBtnClass} disabled:opacity-50`;

  const saveImage = async () => {
    if (!slipRef.current) return;
    setSaving(true);
    try {
      const { toCanvas } = await import('html-to-image');
      const canvas = await toCanvas(slipRef.current, { pixelRatio: PIXEL_RATIO, cacheBust: true });
      punchNotches(canvas);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('no image');
      const file = new File([blob], fileName, { type: 'image/png' });
      // Phones get the share sheet (save to photos, send to Discord); computers download it.
      if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] }).catch(() => {});
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 10000);
        setNote('Image saved');
      }
    } catch {
      setNote('Could not save the image');
    } finally {
      setSaving(false);
      window.setTimeout(() => setNote(''), 2500);
    }
  };

  return (
    <div className="max-w-[720px] mx-auto">
      <WeekRecapSlip ref={slipRef} recap={recap} />
      <div className="mt-2 flex items-center justify-end gap-2">
        {note && <span className={`text-xs ${mutedClass}`}>{note}</span>}
        <button onClick={() => void saveImage()} disabled={saving} className={btn}>
          {saving ? 'Saving...' : 'Save image'}
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
