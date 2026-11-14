import { useRef, useState } from 'react';

/** Pictures are drawn at twice the on-page size so they stay sharp when posted. */
export const SHARE_PIXEL_RATIO = 2;

// Copy needs the image clipboard (most current browsers; not older Firefox).
const canCopyImage = () => typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;

// Turns a piece of the page into a picture a player can post: Copy image and
// Save image (the share sheet on phones, a download on computers). Attach `ref`
// to the element to draw. Render that element only while `busy` if it is a
// hidden fixed-width copy, so a phone and a computer get the same picture.
// `finishCanvas` can touch up the drawn picture (the Weekly Slip punches its
// side notches there).
export function useShareImage(fileName: string, finishCanvas?: (canvas: HTMLCanvasElement) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<'' | 'copy' | 'save'>('');
  const [note, setNote] = useState('');

  const drawImage = async () => {
    const { toCanvas } = await import('html-to-image');
    // Let a hidden copy mount and lay out first.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (!ref.current) throw new Error('nothing to draw');
    const canvas = await toCanvas(ref.current, { pixelRatio: SHARE_PIXEL_RATIO, cacheBust: true });
    finishCanvas?.(canvas);
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

  return { ref, busy, note, setNote, canCopy: canCopyImage(), copyImage, saveImage };
}
