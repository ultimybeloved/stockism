import { useState } from 'react';
import { createPortal } from 'react-dom';
import { themeClasses } from '../../../utils/theme';
import { useSession } from '../../../context/AppContext';
import { useEscapeKey } from '../../../shared/hooks/useEscapeKey';
import { useModalFocus } from '../../../shared/hooks/useModalFocus';
import { useShareImage } from '../../../shared/hooks/useShareImage';
import { inviteLink } from '../../../rules/recruiting';
import StockShareCard, { SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH, type StockShareCardProps } from './StockShareCard';

// The preview box: the picture as it will be posted, with Copy image, Save
// image and Copy link. The preview shrinks to fit a phone; the picture itself
// is always drawn from a hidden full-size copy.
const ShareModal = ({ card, onClose }: { card: StockShareCardProps; onClose: () => void }) => {
  useEscapeKey(onClose);
  const dialogRef = useModalFocus();
  const { userData } = useSession();
  const { ref, busy, note, setNote, canCopy, copyImage, saveImage } = useShareImage(`stockism-${card.ticker}.png`);
  const { overlayClass, modalShellClass, textClass, mutedClass, ghostBtnClass } = themeClasses;
  const btn = `px-3 py-1.5 text-xs font-semibold rounded-sm border ${ghostBtnClass} disabled:opacity-50`;
  // 16px of overlay padding and 16px of box padding on each side.
  const scale = Math.min(1, (window.innerWidth - 64) / SHARE_CARD_WIDTH);
  const link = inviteLink(userData?.displayName, `/stock/${card.ticker}`);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setNote('Link copied');
    } catch {
      setNote('Could not copy the link');
    }
    window.setTimeout(() => setNote(''), 2500);
  };

  return (
    <div className={`${overlayClass} z-50`} onClick={onClose}>
      <div
        ref={dialogRef}
        className={`${modalShellClass} p-4`}
        style={{ maxWidth: SHARE_CARD_WIDTH * scale + 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={`text-base font-semibold ${textClass} mb-1`}>Share ${card.ticker}</h2>
        <p className={`text-xs ${mutedClass} mb-3`}>
          Post the picture anywhere.
          {userData?.displayName
            ? ' The link is your invite link: anyone who joins through it counts as your recruit.'
            : ''}
        </p>
        <div style={{ width: SHARE_CARD_WIDTH * scale, height: SHARE_CARD_HEIGHT * scale }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            <StockShareCard {...card} />
          </div>
        </div>
        {busy && (
          <div aria-hidden className="fixed top-0 -left-[10000px]">
            <StockShareCard ref={ref} {...card} />
          </div>
        )}
        <div className="mt-3 flex items-center justify-end flex-wrap gap-2">
          {note && <span className={`text-xs ${mutedClass} mr-auto`}>{note}</span>}
          {canCopy && (
            <button onClick={() => void copyImage()} disabled={!!busy} className={btn}>
              {busy === 'copy' ? 'Copying...' : 'Copy image'}
            </button>
          )}
          <button onClick={() => void saveImage()} disabled={!!busy} className={btn}>
            {busy === 'save' ? 'Saving...' : 'Save image'}
          </button>
          <button onClick={() => void copyLink()} className={btn}>
            Copy link
          </button>
          <button onClick={onClose} className={btn}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

/** The Share button on a stock page. It owns its preview box. */
const StockShare = (card: StockShareCardProps) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`px-2.5 py-1 text-xs font-semibold rounded-sm border ${themeClasses.ghostBtnClass}`}
      >
        Share
      </button>
      {open && createPortal(<ShareModal card={card} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
};

export default StockShare;
