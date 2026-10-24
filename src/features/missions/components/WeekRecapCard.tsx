import { useRef, useState } from 'react';
import type { WeeklyRecap } from '../../../rules/weeklyRecap';
import { themeClasses } from '../../../utils/theme';
import WeekRecapSlip, { NOTCH_RADIUS, PERFORATION_Y, SLIP_WIDTH } from './WeekRecapSlip';

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

// Copy needs the image clipboard (most current browsers; not older Firefox).
const canCopy = () => typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;

// The Weekly Slip: last week's summary, from the recap the server stores at the
// Thursday reopen, with Copy image, Save image (the share sheet on phones) and
// Close below it. Both draw a hidden copy at SLIP_WIDTH, so a phone and a
// computer get the same picture whatever width the slip has on screen.
export default function WeekRecapCard({ recap, onClose }: { recap: WeeklyRecap; onClose?: () => void }) {
  const slipRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<'' | 'copy' | 'save'>('');
  const [note, setNote] = useState('');
  const { mutedClass, ghostBtnClass } = themeClasses;
  const fileName = `stockism-week-${recap.weekId}.png`;
  const btn = `px-2.5 py-1 text-xs font-semibold rounded-sm border ${ghostBtnClass} disabled:opacity-50`;

  const drawImage = async () => {
    const { toCanvas } = await import('html-to-image');
    // Let the hidden copy mount and lay out first.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (!slipRef.current) throw new Error('no slip');
    const canvas = await toCanvas(slipRef.current, { pixelRatio: PIXEL_RATIO, cacheBust: true });
    punchNotches(canvas);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('no image');
    return blob;
  };

  const finish = () => {
    setBusy('');
    window.setTimeout(() => setNote(''), 2500);
  };

  const copyImage = async () => {
    setBusy('copy');
    try {
      // The clipboard item gets the image as a promise, so Safari still counts it as part of the click.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': drawImage() })]);
      setNote('Image copied');
    } catch {
      setNote('Could not copy the image');
    } finally {
      finish();
    }
  };

  const saveImage = async () => {
    setBusy('save');
    try {
      const blob = await drawImage();
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
      finish();
    }
  };

  return (
    <div style={{ maxWidth: SLIP_WIDTH }} className="mx-auto">
      <WeekRecapSlip recap={recap} />
      {busy && (
        <div aria-hidden className="fixed top-0 -left-[10000px]" style={{ width: SLIP_WIDTH }}>
          <WeekRecapSlip ref={slipRef} recap={recap} />
        </div>
      )}
      <div className="mt-2 flex items-center justify-end gap-2">
        {note && <span className={`text-xs ${mutedClass}`}>{note}</span>}
        {canCopy() && (
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
