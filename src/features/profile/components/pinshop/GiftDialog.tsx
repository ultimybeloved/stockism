import { useState } from 'react';
import { formatCurrency } from '../../../../utils/formatters';
import { themeClasses } from '../../../../utils/theme';
import type { GiftTarget } from '../../hooks/usePinShop';
import { useModalFocus } from '../../../../shared/hooks/useModalFocus';
import PixelIcon from '../../../../shared/components/PixelIcon';

interface GiftDialogProps {
  gift: GiftTarget;
  cash: number;
  /** Resolves to an error message to show, or null once the gift is sent. */
  onSend: (recipient: string) => Promise<string | null>;
  onClose: () => void;
}

// Gift a shop item or bundle to another player by name. No message box on purpose (see
// functions/src/users/cosmeticGifts.ts); the recipient is told who sent it.
const GiftDialog = ({ gift, cash, onSend, onClose }: GiftDialogProps) => {
  const dialogRef = useModalFocus();
  const { price } = gift;
  const isBundle = gift.kind === 'bundle';
  const { cardClass, textClass, mutedClass, inputClass } = themeClasses;
  const [recipient, setRecipient] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSend = !!recipient.trim() && cash >= price && !sending;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    const err = await onSend(recipient.trim());
    setSending(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <div className="absolute inset-0 bg-black/50 flex items-center justify-center" onClick={onClose}>
      <div
        ref={dialogRef}
        className={`${cardClass} border rounded-sm p-6 m-4 max-w-sm w-full`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={`text-lg font-semibold ${textClass} mb-1`}>
          <PixelIcon name="gift" set="discord" className="w-4 h-4 mr-1.5 align-[-3px]" />
          Gift {isBundle ? `the ${gift.name} bundle` : gift.name}
        </h3>
        <p className={`text-sm ${mutedClass} mb-4`}>
          You pay <span className="text-orange-500 font-semibold">{formatCurrency(price)}</span>.{' '}
          {isBundle && 'Every piece they don’t already own goes '}
          {!isBundle && 'It goes '}straight to their collection and they&apos;ll see it came from you.
        </p>
        <input
          aria-label="Recipient username"
          autoFocus
          value={recipient}
          maxLength={40}
          onChange={(e) => setRecipient(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Player's name"
          className={`w-full px-3 py-2 border rounded-sm mb-2 ${inputClass}`}
        />
        {error && (
          <p role="alert" className="text-xs mb-2 light:text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {cash < price && <p className="text-xs mb-2 light:text-red-600 dark:text-red-400">Not enough cash.</p>}
        <div className="flex gap-3 mt-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-sm border light:border-amber-200 light:text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
          >
            Cancel
          </button>
          <button
            onClick={send}
            disabled={!canSend}
            className="flex-1 py-2 rounded-sm bg-orange-600 hover:bg-orange-700 text-white font-semibold disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send Gift'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GiftDialog;
