import { useState } from 'react';
import { logPanelAction } from '../utils/panelLog';
import { doc, getDoc, setDoc, runTransaction, arrayUnion } from 'firebase/firestore';
import { db } from '../../../firebase';
import { ipoAnnouncementAlertFunction } from '../../../api/callables';
import { CHARACTERS } from '../../../characters';
import { getNextMarketOpen } from '../../../utils/marketHours';
import { formatDateTime } from '../../../utils/localTime';

import { toLocalInputValue, validateIpoDraft } from '../utils/ipoValidation';
import type { AdminHookDeps } from '../utils/adminShared';
import type { IPO } from '../../../types';

// IPO tab: create/cancel IPOs and track eligible characters.
export function useAdminIpo({ showMessage, setLoading }: Pick<AdminHookDeps, 'showMessage' | 'setLoading'>) {
  // IPO state
  const [ipoTicker, setIpoTicker] = useState('');
  const [ipoStartAtInput, setIpoStartAtInput] = useState(() => toLocalInputValue(getNextMarketOpen())); // When IPO buying starts (hype phase runs from creation until then)
  const [ipoDurationHours, setIpoDurationHours] = useState(24); // How long IPO buying lasts
  const [ipoTotalShares, setIpoTotalShares] = useState(150); // Total shares available
  const [ipoMaxPerUser, setIpoMaxPerUser] = useState(10); // Max shares per user
  const [activeIPOs, setActiveIPOs] = useState<IPO[]>([]);
  const [completedIPOTickers, setCompletedIPOTickers] = useState<string[]>([]); // Tickers that have had IPOs

  // Characters eligible for IPO: those with ipoRequired flag OR not yet in the market
  // We'll track which characters have completed IPOs in Firestore
  const ipoEligibleCharacters = CHARACTERS.filter((c) => {
    // Check if there's already an active IPO for this character
    const hasActiveIPO = activeIPOs.some((ipo) => ipo.ticker === c.ticker && !ipo.priceJumped);
    if (hasActiveIPO) return false;

    // Check if character has ipoRequired flag (new characters)
    if (c.ipoRequired) return true;

    // Don't show characters that have already completed IPO or are established
    if (completedIPOTickers.includes(c.ticker)) return false;

    // For now, only show characters explicitly marked as needing IPO
    return false;
  });

  // Load active IPOs
  const loadIPOs = async () => {
    try {
      const ipoRef = doc(db, 'market', 'ipos');
      const snap = await getDoc(ipoRef);
      if (snap.exists()) {
        const list: IPO[] = snap.data().list || [];
        setActiveIPOs(list);
        // Track which tickers have completed IPOs
        const completed = list.filter((ipo) => ipo.priceJumped).map((ipo) => ipo.ticker);
        setCompletedIPOTickers(completed);
      } else {
        setActiveIPOs([]);
        setCompletedIPOTickers([]);
      }
    } catch (err) {
      console.error('Failed to load IPOs:', err);
    }
  };

  // Create new IPO
  const handleCreateIPO = async () => {
    const now = Date.now();
    const draft = validateIpoDraft({ ipoTicker, ipoStartAtInput, activeIPOs, now });
    if (draft.error !== undefined) {
      showMessage('error', draft.error);
      return;
    }
    const { character, ipoStartsAt } = draft;

    setLoading(true);
    try {
      const ipoRef = doc(db, 'market', 'ipos');

      const ipoEndsAt = ipoStartsAt + ipoDurationHours * 60 * 60 * 1000;

      const newIPO = {
        ticker: ipoTicker,
        basePrice: character.basePrice,
        ipoStartsAt,
        ipoEndsAt,
        sharesRemaining: ipoTotalShares,
        totalShares: ipoTotalShares,
        maxPerUser: ipoMaxPerUser,
        priceJumped: false,
        createdAt: now,
      };

      // Appended, not rewritten from an earlier read: IPO buys update this list
      // too, and a rewrite put back sharesRemaining from before them (oversold).
      await setDoc(ipoRef, { list: arrayUnion(newIPO) }, { merge: true });

      await logPanelAction({ action: 'create_ipo', after: newIPO });

      // Send Discord announcement
      try {
        await ipoAnnouncementAlertFunction({
          ticker: ipoTicker,
          characterName: character.name,
          ipoPrice: character.basePrice,
          postIpoPrice: Math.round(character.basePrice * 1.15 * 100) / 100,
          startsAt: ipoStartsAt,
          endsAt: ipoEndsAt,
          totalShares: ipoTotalShares,
          maxPerUser: ipoMaxPerUser,
        });
      } catch (discordErr) {
        console.error('Failed to send IPO announcement to Discord:', discordErr);
        // Don't block IPO creation if Discord fails
      }

      showMessage(
        'success',
        `🚀 IPO created for $${ipoTicker}! Hype phase starts now, buying opens ${ipoStartsAt <= now ? 'immediately' : formatDateTime(ipoStartsAt)}`,
      );
      setIpoTicker('');
      loadIPOs();
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to create IPO');
    }
    setLoading(false);
  };

  // Cancel/Delete IPO
  const handleCancelIPO = async (ticker: string) => {
    if (!window.confirm(`Cancel IPO for $${ticker}? This cannot be undone.`)) return;

    setLoading(true);
    try {
      const ipoRef = doc(db, 'market', 'ipos');
      // One transaction: an IPO buy landing mid-cancel must be seen by the check
      // below, and must not be erased by the rewrite.
      const outcome = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ipoRef);
        if (!snap.exists()) return { sold: 0, before: null as IPO | null, done: false };
        const currentList: IPO[] = snap.data().list || [];
        // Once anyone has bought in, cancelling strands them: they paid, their
        // shares are locked, and the launch never comes. There is no refund path.
        const ipo = currentList.find((i) => i.ticker === ticker) || null;
        const sold = ipo && ipo.totalShares != null ? ipo.totalShares - (ipo.sharesRemaining ?? ipo.totalShares) : 0;
        if (sold > 0) return { sold, before: ipo, done: false };
        tx.update(ipoRef, { list: currentList.filter((i) => i.ticker !== ticker) });
        return { sold: 0, before: ipo, done: true };
      });
      if (outcome.sold > 0) {
        showMessage('error', `${outcome.sold} shares of $${ticker} are already sold, so this IPO can't be cancelled.`);
      } else if (outcome.done) {
        await logPanelAction({ action: 'cancel_ipo', before: outcome.before || { ticker } });
        showMessage('success', `Cancelled IPO for $${ticker}`);
        loadIPOs();
      }
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to cancel IPO');
    }
    setLoading(false);
  };

  // Start-time presets for the create form
  const setIpoStartToNow = () => setIpoStartAtInput(toLocalInputValue(new Date()));
  const setIpoStartToNextOpen = () => setIpoStartAtInput(toLocalInputValue(getNextMarketOpen()));

  return {
    ipoTicker,
    setIpoTicker,
    ipoStartAtInput,
    setIpoStartAtInput,
    setIpoStartToNow,
    setIpoStartToNextOpen,
    ipoDurationHours,
    setIpoDurationHours,
    ipoTotalShares,
    setIpoTotalShares,
    ipoMaxPerUser,
    setIpoMaxPerUser,
    ipoEligibleCharacters,
    activeIPOs,
    loadIPOs,
    handleCreateIPO,
    handleCancelIPO,
  };
}
