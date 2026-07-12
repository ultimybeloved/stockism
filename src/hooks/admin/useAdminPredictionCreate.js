import { useState } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db, broadcastNotificationFunction } from '../../firebase';
import {
  EVENT_AMM_LIQUIDITY, MS_PER_HOUR,
  EVENT_OPENING_ODDS_MIN_PCT, EVENT_OPENING_ODDS_MAX_PCT,
} from '../../constants/economy';
import { lmsrSeedQ } from '../../utils/calculations';

// Predictions tab: the create-new-prediction form (weekly cash + event AMM).
export function useAdminPredictionCreate({ showMessage, setLoading }) {
  // Create prediction form state
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['Yes', 'No', '', '', '', '']);
  const [daysUntilEnd, setDaysUntilEnd] = useState(7);
  const [mayExtend, setMayExtend] = useState(false);
  
  // Calculate end time at 13:55 UTC (7:55 AM CST) on target day (5 min before chapter release)
  const getEndTime = (days) => {
    const now = new Date();
    const target = new Date(now);
    target.setDate(target.getDate() + days);
    target.setUTCHours(13, 55, 0, 0);
    return target.getTime();
  };
  
  const endDate = new Date(getEndTime(daysUntilEnd));

  const [predictionType, setPredictionType] = useState('weekly'); // 'weekly' (cash) | 'event' (long-term AMM)
  const [seedLiquidity, setSeedLiquidity] = useState(EVENT_AMM_LIQUIDITY);
  const [openDelayHours, setOpenDelayHours] = useState(0); // announce-before-open delay; 0 = open immediately
  const [openingOdds, setOpeningOdds] = useState(['', '', '', '', '', '']); // % per option slot; all blank = even odds

  // Opening odds for the filled-in option slots. Returns { pcts } (null = even
  // odds) or { error }. Entered odds must all be present, in range, and sum to 100.
  const resolveOpeningOdds = (pairs) => {
    const entered = pairs.filter((p) => p.pct !== '' && p.pct !== null && p.pct !== undefined);
    if (entered.length === 0) return { pcts: null };
    if (entered.length < pairs.length) {
      return { error: 'Set an opening % for every option (or clear them all for even odds).' };
    }
    const pcts = pairs.map((p) => Number(p.pct));
    if (pcts.some((n) => !Number.isFinite(n) || n < EVENT_OPENING_ODDS_MIN_PCT || n > EVENT_OPENING_ODDS_MAX_PCT)) {
      return { error: `Each opening % must be between ${EVENT_OPENING_ODDS_MIN_PCT} and ${EVENT_OPENING_ODDS_MAX_PCT}.` };
    }
    const sum = pcts.reduce((a, c) => a + c, 0);
    if (Math.abs(sum - 100) > 0.01) {
      return { error: `Opening odds must total 100% (currently ${Math.round(sum * 100) / 100}%).` };
    }
    return { pcts };
  };

  // Announce a new prediction/market through every user's notification bell.
  // Fail-soft: the prediction is already created, a failed announcement only warns.
  const announcePrediction = async (title, message, predictionId) => {
    try {
      await broadcastNotificationFunction({ title, message, predictionId });
    } catch (err) {
      console.error('Prediction announcement failed:', err);
      showMessage('error', 'Prediction created, but the notification broadcast failed.');
    }
  };

  // Create new prediction
  const handleCreatePrediction = async () => {
    if (!question.trim()) {
      showMessage('error', 'Please enter a question');
      return;
    }

    const validOptions = options.filter(o => o.trim());
    if (validOptions.length < 2) {
      showMessage('error', 'Please enter at least 2 options');
      return;
    }

    // Event markets: turn admin-entered opening odds into AMM seed quantities.
    let seedQ = null;
    if (predictionType === 'event') {
      const pairs = options
        .map((o, i) => ({ name: o.trim(), pct: String(openingOdds[i] ?? '').trim() }))
        .filter((p) => p.name);
      const { pcts, error } = resolveOpeningOdds(pairs);
      if (error) {
        showMessage('error', error);
        return;
      }
      if (pcts) seedQ = lmsrSeedQ(pcts, Number(seedLiquidity) || EVENT_AMM_LIQUIDITY);
    }

    setLoading(true);
    try {
      const predictionsRef = doc(db, 'predictions', 'current');
      const snap = await getDoc(predictionsRef);
      const currentList = snap.exists() ? (snap.data().list || []) : [];

      if (predictionType === 'event') {
        const cleanOptions = validOptions.map(o => o.trim());
        const b = Number(seedLiquidity) || EVENT_AMM_LIQUIDITY;
        const delay = Number(openDelayHours) || 0;
        const opensAt = delay > 0 ? Date.now() + Math.round(delay * MS_PER_HOUR) : null;
        const q0 = seedQ || cleanOptions.map(() => 0);
        const eventMarket = {
          id: `evt_${Date.now()}`,
          type: 'event',
          question: question.trim(),
          outcomes: cleanOptions,
          options: cleanOptions, // mirror so the admin list/resolve UI works unchanged
          q: q0,
          seedQ: q0, // starting point; settlement measures the AMM's net take from here
          b,
          seededLiquidity: b,
          volume: 0,
          createdAt: Date.now(),
          resolved: false,
          outcome: null,
          settled: false,
          ...(opensAt && { opensAt }), // announced-but-locked until this time
        };
        await updateDoc(predictionsRef, { list: [...currentList, eventMarket] });
        showMessage('success', opensAt
          ? `Created long-term market: "${question.trim()}" — opens ${new Date(opensAt).toLocaleString()}`
          : `Created long-term market: "${question.trim()}"`);
        await announcePrediction(
          '🔮 New long-term market!',
          opensAt
            ? `"${question.trim()}" opens ${new Date(opensAt).toLocaleString()}. Buy outcome shares on the Predictions page.`
            : `"${question.trim()}" is live now. Buy outcome shares on the Predictions page.`,
          eventMarket.id
        );
        setQuestion('');
        setOptions(['Yes', 'No', '', '', '', '']);
        setOpenDelayHours(0);
        setOpeningOdds(['', '', '', '', '', '']);
        setLoading(false);
        return;
      }

      // Generate unique ID using timestamp
      const newId = `pred_${Date.now()}`;

      // Create pools object
      const pools = {};
      validOptions.forEach(opt => {
        pools[opt.trim()] = 0;
      });

      const newPrediction = {
        id: newId,
        question: question.trim(),
        options: validOptions.map(o => o.trim()),
        pools,
        endsAt: getEndTime(daysUntilEnd),
        resolved: false,
        outcome: null,
        payoutsProcessed: false,
        createdAt: Date.now(),
        ...(mayExtend && { mayExtend: true })
      };

      await updateDoc(predictionsRef, {
        list: [...currentList, newPrediction]
      });

      showMessage('success', `Created prediction: "${question.trim()}"`);
      await announcePrediction(
        '🔮 New weekly prediction!',
        `"${question.trim()}" is live. Place your bet on the Predictions page.`,
        newId
      );
      setQuestion('');
      setOptions(['Yes', 'No', '', '', '', '']);
      setDaysUntilEnd(7);
      setMayExtend(false);
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to create prediction');
    }
    setLoading(false);
  };

  return {
    question, setQuestion, options, setOptions, daysUntilEnd, setDaysUntilEnd,
    mayExtend, setMayExtend, endDate, getEndTime, handleCreatePrediction,
    predictionType, setPredictionType, seedLiquidity, setSeedLiquidity,
    openDelayHours, setOpenDelayHours, openingOdds, setOpeningOdds,
  };
}
