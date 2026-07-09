import { useState } from 'react';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db, ipoAnnouncementAlertFunction } from '../../firebase';
import { CHARACTERS } from '../../characters';
import { getNextMarketOpen } from '../../utils/marketHours';
import { formatUTCDateTime } from '../../utils/formatters';

// <input type="datetime-local"> takes local time as "YYYY-MM-DDTHH:mm".
const toLocalInputValue = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

// A start time this far in the past still creates (starting immediately),
// covering the gap between clicking the "Now" preset and clicking Create.
const START_TIME_PAST_TOLERANCE_MS = 5 * 60 * 1000;

// IPO tab: create/cancel IPOs and track eligible characters.
export function useAdminIpo({ showMessage, setLoading }) {
  // IPO state
  const [ipoTicker, setIpoTicker] = useState('');
  const [ipoStartAtInput, setIpoStartAtInput] = useState(() => toLocalInputValue(getNextMarketOpen())); // When IPO buying starts (hype phase runs from creation until then)
  const [ipoDurationHours, setIpoDurationHours] = useState(24); // How long IPO buying lasts
  const [ipoTotalShares, setIpoTotalShares] = useState(150); // Total shares available
  const [ipoMaxPerUser, setIpoMaxPerUser] = useState(10); // Max shares per user
  const [activeIPOs, setActiveIPOs] = useState([]);
  const [completedIPOTickers, setCompletedIPOTickers] = useState([]); // Tickers that have had IPOs

  // Characters eligible for IPO: those with ipoRequired flag OR not yet in the market
  // We'll track which characters have completed IPOs in Firestore
  const ipoEligibleCharacters = CHARACTERS.filter(c => {
    // Check if there's already an active IPO for this character
    const hasActiveIPO = activeIPOs.some(ipo => ipo.ticker === c.ticker && !ipo.priceJumped);
    if (hasActiveIPO) return false;
    
    // Check if character has ipoRequired flag (new characters)
    if (c.ipoRequired) return true;
    
    // Don't show characters that have already completed IPO or are established
    if (completedIPOTickers.includes(c.ticker)) return false;
    
    // For now, only show characters explicitly marked as needing IPO
    return c.ipoRequired === true;
  });

  // Load active IPOs
  const loadIPOs = async () => {
    try {
      const ipoRef = doc(db, 'market', 'ipos');
      const snap = await getDoc(ipoRef);
      if (snap.exists()) {
        const list = snap.data().list || [];
        setActiveIPOs(list);
        // Track which tickers have completed IPOs
        const completed = list.filter(ipo => ipo.priceJumped).map(ipo => ipo.ticker);
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
    if (!ipoTicker) {
      showMessage('error', 'Please select a character');
      return;
    }

    const character = CHARACTERS.find(c => c.ticker === ipoTicker);
    if (!character) {
      showMessage('error', 'Character not found');
      return;
    }

    // Check if IPO already exists for this ticker
    const existingIPO = activeIPOs.find(ipo => ipo.ticker === ipoTicker && !ipo.priceJumped);
    if (existingIPO) {
      showMessage('error', 'An IPO already exists for this character');
      return;
    }

    const startDate = new Date(ipoStartAtInput);
    if (!ipoStartAtInput || isNaN(startDate.getTime())) {
      showMessage('error', 'Pick a valid start date and time');
      return;
    }
    const now = Date.now();
    let ipoStartsAt = startDate.getTime();
    if (ipoStartsAt <= now) {
      if (now - ipoStartsAt > START_TIME_PAST_TOLERANCE_MS) {
        showMessage('error', 'Start time is in the past');
        return;
      }
      ipoStartsAt = now; // "Now" preset: start immediately
    }

    setLoading(true);
    try {
      const ipoRef = doc(db, 'market', 'ipos');
      const snap = await getDoc(ipoRef);
      const currentList = snap.exists() ? (snap.data().list || []) : [];

      const ipoEndsAt = ipoStartsAt + (ipoDurationHours * 60 * 60 * 1000);

      const newIPO = {
        ticker: ipoTicker,
        basePrice: character.basePrice,
        ipoStartsAt,
        ipoEndsAt,
        sharesRemaining: ipoTotalShares,
        totalShares: ipoTotalShares,
        maxPerUser: ipoMaxPerUser,
        priceJumped: false,
        createdAt: now
      };

      if (snap.exists()) {
        await updateDoc(ipoRef, {
          list: [...currentList, newIPO]
        });
      } else {
        await setDoc(ipoRef, {
          list: [newIPO]
        });
      }

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
          maxPerUser: ipoMaxPerUser
        });
      } catch (discordErr) {
        console.error('Failed to send IPO announcement to Discord:', discordErr);
        // Don't block IPO creation if Discord fails
      }

      showMessage('success', `🚀 IPO created for $${ipoTicker}! Hype phase starts now, buying opens ${ipoStartsAt <= now ? 'immediately' : formatUTCDateTime(ipoStartsAt)}`);
      setIpoTicker('');
      loadIPOs();
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to create IPO');
    }
    setLoading(false);
  };

  // Cancel/Delete IPO
  const handleCancelIPO = async (ticker) => {
    if (!window.confirm(`Cancel IPO for $${ticker}? This cannot be undone.`)) return;
    
    setLoading(true);
    try {
      const ipoRef = doc(db, 'market', 'ipos');
      const snap = await getDoc(ipoRef);
      if (snap.exists()) {
        const currentList = snap.data().list || [];
        const updatedList = currentList.filter(ipo => ipo.ticker !== ticker);
        await updateDoc(ipoRef, { list: updatedList });
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
    ipoTicker, setIpoTicker, ipoStartAtInput, setIpoStartAtInput,
    setIpoStartToNow, setIpoStartToNextOpen, ipoDurationHours, setIpoDurationHours,
    ipoTotalShares, setIpoTotalShares, ipoMaxPerUser, setIpoMaxPerUser,
    ipoEligibleCharacters, activeIPOs, loadIPOs, handleCreateIPO, handleCancelIPO,
  };
}
