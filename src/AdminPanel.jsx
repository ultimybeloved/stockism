import React, { useState } from 'react';
import { doc, updateDoc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { CHARACTERS } from './characters';

// Put your admin user IDs here (your Firebase Auth UID)
// Find your UID in Firebase Console → Authentication → Users
const ADMIN_UIDS = [
  '4usiVxPmHLhmitEKH2HfCpbx4Yi1'
];

const AdminPanel = ({ user, predictions, prices, darkMode, onClose }) => {
  const [activeTab, setActiveTab] = useState('create');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  
  // Create prediction form state
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '', '', '']);
  const [daysUntilEnd, setDaysUntilEnd] = useState(7);
  
  // Calculate end time at 8:55 AM CST on target day
  const getEndTime = (days) => {
    const now = new Date();
    const target = new Date(now);
    target.setDate(target.getDate() + days);
    // Set to 8:55 AM CST (CST is UTC-6)
    // 8:55 AM CST = 14:55 UTC
    target.setUTCHours(14, 55, 0, 0);
    return target.getTime();
  };
  
  const endDate = new Date(getEndTime(daysUntilEnd));
  
  // Resolve prediction state
  const [selectedPrediction, setSelectedPrediction] = useState(null);
  const [selectedOutcome, setSelectedOutcome] = useState('');

  // Price adjustment state
  const [selectedTicker, setSelectedTicker] = useState('');
  const [adjustmentType, setAdjustmentType] = useState('set'); // 'set' or 'percent'
  const [newPrice, setNewPrice] = useState('');
  const [percentChange, setPercentChange] = useState('');
  
  // Recovery tool state
  const [recoveryPredictionId, setRecoveryPredictionId] = useState('');
  const [recoveryBets, setRecoveryBets] = useState([]);
  const [recoveryWinner, setRecoveryWinner] = useState('');
  const [recoveryOptions, setRecoveryOptions] = useState([]);

  const isAdmin = user && ADMIN_UIDS.includes(user.uid);

  const cardClass = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300';
  const textClass = darkMode ? 'text-slate-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-slate-400' : 'text-slate-500';
  const inputClass = darkMode 
    ? 'bg-slate-900 border-slate-600 text-slate-100' 
    : 'bg-white border-slate-300 text-slate-900';

  const showMessage = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  // Adjust character price
  const handlePriceAdjustment = async () => {
    if (!selectedTicker) {
      showMessage('error', 'Please select a character');
      return;
    }

    const currentPrice = prices[selectedTicker];
    if (!currentPrice) {
      showMessage('error', 'Could not get current price');
      return;
    }

    let targetPrice;
    if (adjustmentType === 'set') {
      targetPrice = parseFloat(newPrice);
      if (isNaN(targetPrice) || targetPrice <= 0) {
        showMessage('error', 'Please enter a valid price');
        return;
      }
    } else {
      const percent = parseFloat(percentChange);
      if (isNaN(percent)) {
        showMessage('error', 'Please enter a valid percentage');
        return;
      }
      targetPrice = currentPrice * (1 + percent / 100);
      if (targetPrice <= 0) {
        showMessage('error', 'Resulting price would be negative');
        return;
      }
    }

    targetPrice = Math.round(targetPrice * 100) / 100;

    setLoading(true);
    try {
      const marketRef = doc(db, 'market', 'current');
      const snap = await getDoc(marketRef);
      
      if (snap.exists()) {
        const data = snap.data();
        const currentHistory = data.priceHistory?.[selectedTicker] || [];
        const now = Date.now();
        
        // Add to price history for natural chart appearance
        const updatedHistory = [...currentHistory, { timestamp: now, price: targetPrice }].slice(-1000);
        
        await updateDoc(marketRef, {
          [`prices.${selectedTicker}`]: targetPrice,
          [`priceHistory.${selectedTicker}`]: updatedHistory
        });

        const character = CHARACTERS.find(c => c.ticker === selectedTicker);
        const changePercent = ((targetPrice - currentPrice) / currentPrice * 100).toFixed(1);
        const direction = targetPrice > currentPrice ? '📈' : '📉';
        
        showMessage('success', `${direction} ${character?.name || selectedTicker}: $${currentPrice.toFixed(2)} → $${targetPrice.toFixed(2)} (${changePercent > 0 ? '+' : ''}${changePercent}%)`);
        
        // Reset form
        setSelectedTicker('');
        setNewPrice('');
        setPercentChange('');
      }
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to adjust price');
    }
    setLoading(false);
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

    setLoading(true);
    try {
      const predictionsRef = doc(db, 'predictions', 'current');
      const snap = await getDoc(predictionsRef);
      const currentList = snap.exists() ? (snap.data().list || []) : [];

      // Generate new ID
      const maxId = currentList.reduce((max, p) => {
        const num = parseInt(p.id.replace('pred_', '')) || 0;
        return Math.max(max, num);
      }, 0);
      const newId = `pred_${maxId + 1}`;

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
        createdAt: Date.now()
      };

      await updateDoc(predictionsRef, {
        list: [...currentList, newPrediction]
      });

      showMessage('success', `Created prediction: "${question.trim()}"`);
      setQuestion('');
      setOptions(['', '', '', '']);
      setDaysUntilEnd(7);
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to create prediction');
    }
    setLoading(false);
  };

  // Resolve prediction
  const handleResolvePrediction = async () => {
    if (!selectedPrediction || !selectedOutcome) {
      showMessage('error', 'Please select a prediction and winning option');
      return;
    }

    setLoading(true);
    try {
      const predictionsRef = doc(db, 'predictions', 'current');
      const snap = await getDoc(predictionsRef);
      const currentList = snap.exists() ? (snap.data().list || []) : [];

      const updatedList = currentList.map(p => {
        if (p.id === selectedPrediction.id) {
          return {
            ...p,
            resolved: true,
            outcome: selectedOutcome
          };
        }
        return p;
      });

      await updateDoc(predictionsRef, { list: updatedList });

      showMessage('success', `Resolved! Winner: "${selectedOutcome}"`);
      setSelectedPrediction(null);
      setSelectedOutcome('');
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to resolve prediction');
    }
    setLoading(false);
  };

  // Delete prediction
  const handleDeletePrediction = async (predictionId) => {
    if (!confirm('Are you sure you want to delete this prediction?')) return;

    setLoading(true);
    try {
      const predictionsRef = doc(db, 'predictions', 'current');
      const snap = await getDoc(predictionsRef);
      const currentList = snap.exists() ? (snap.data().list || []) : [];

      const updatedList = currentList.filter(p => p.id !== predictionId);

      await updateDoc(predictionsRef, { list: updatedList });

      showMessage('success', 'Prediction deleted');
      setSelectedPrediction(null);
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to delete prediction');
    }
    setLoading(false);
  };

  // Scan all users for bets on a specific prediction ID
  const handleScanForBets = async () => {
    if (!recoveryPredictionId.trim()) {
      showMessage('error', 'Please enter a prediction ID (e.g., pred_1)');
      return;
    }

    setLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);
      
      const bets = [];
      const optionsFound = new Set();
      
      snapshot.forEach(doc => {
        const userData = doc.data();
        const userBet = userData.bets?.[recoveryPredictionId.trim()];
        if (userBet) {
          bets.push({
            userId: doc.id,
            displayName: userData.displayName || 'Unknown',
            option: userBet.option,
            amount: userBet.amount,
            paid: userBet.paid || false,
            payout: userBet.payout || 0,
            cash: userData.cash || 0
          });
          optionsFound.add(userBet.option);
        }
      });

      setRecoveryBets(bets);
      setRecoveryOptions(Array.from(optionsFound));
      
      if (bets.length === 0) {
        showMessage('error', `No bets found for prediction "${recoveryPredictionId}"`);
      } else {
        showMessage('success', `Found ${bets.length} bets across ${optionsFound.size} options`);
      }
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to scan users');
    }
    setLoading(false);
  };

  // Process payouts for recovered prediction
  const handleProcessRecovery = async (action) => {
    if (recoveryBets.length === 0) {
      showMessage('error', 'No bets to process');
      return;
    }

    if (action === 'payout' && !recoveryWinner) {
      showMessage('error', 'Please select a winning option');
      return;
    }

    const predId = recoveryPredictionId.trim();
    
    setLoading(true);
    try {
      // Calculate total pool and winning pool
      const totalPool = recoveryBets.reduce((sum, bet) => sum + bet.amount, 0);
      const winningPool = action === 'payout' 
        ? recoveryBets.filter(b => b.option === recoveryWinner).reduce((sum, bet) => sum + bet.amount, 0)
        : 0;

      console.log('Processing recovery:', { action, totalPool, winningPool, recoveryWinner, betsCount: recoveryBets.length });

      let processed = 0;
      
      for (const bet of recoveryBets) {
        if (bet.paid) {
          console.log('Skipping already paid bet:', bet.displayName);
          continue;
        }
        
        const userRef = doc(db, 'users', bet.userId);
        
        try {
          if (action === 'refund') {
            // Refund: give back original bet amount
            await updateDoc(userRef, {
              cash: bet.cash + bet.amount,
              [`bets.${predId}.paid`]: true,
              [`bets.${predId}.payout`]: bet.amount,
              [`bets.${predId}.refunded`]: true
            });
            console.log('Refunded:', bet.displayName, bet.amount);
            processed++;
          } else if (action === 'payout') {
            // Payout: winners split the pot
            if (bet.option === recoveryWinner && winningPool > 0) {
              const userShare = bet.amount / winningPool;
              const payout = Math.round(userShare * totalPool * 100) / 100;
              await updateDoc(userRef, {
                cash: bet.cash + payout,
                [`bets.${predId}.paid`]: true,
                [`bets.${predId}.payout`]: payout
              });
              console.log('Paid winner:', bet.displayName, payout);
            } else {
              // Losers get nothing but mark as paid
              await updateDoc(userRef, {
                [`bets.${predId}.paid`]: true,
                [`bets.${predId}.payout`]: 0
              });
              console.log('Marked loser as paid:', bet.displayName);
            }
            processed++;
          }
        } catch (userErr) {
          console.error('Error processing user:', bet.displayName, userErr);
        }
      }

      showMessage('success', `${action === 'refund' ? 'Refunded' : 'Paid out'} ${processed} users!`);
      setRecoveryBets([]);
      setRecoveryWinner('');
      setRecoveryOptions([]);
      setRecoveryPredictionId('');
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed to process: ${err.message}`);
    }
    setLoading(false);
  };

  // Check admin access
  if (!isAdmin) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
        <div className={`w-full max-w-md ${cardClass} border rounded-sm shadow-xl p-6 text-center`} onClick={e => e.stopPropagation()}>
          <p className="text-red-500 text-lg mb-4">🔒 Admin Access Required</p>
          <p className={mutedClass}>Your UID: <code className="text-xs bg-slate-700 px-2 py-1 rounded">{user?.uid || 'Not logged in'}</code></p>
          <p className={`text-xs ${mutedClass} mt-2`}>Add this UID to ADMIN_UIDS in AdminPanel.jsx</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 bg-slate-600 text-white rounded-sm">Close</button>
        </div>
      </div>
    );
  }

  const unresolvedPredictions = predictions.filter(p => !p.resolved);

  // Sort characters by name for the dropdown
  const sortedCharacters = [...CHARACTERS].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-2xl ${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[90vh] flex flex-col`}
        onClick={e => e.stopPropagation()}>
        
        {/* Header */}
        <div className={`p-4 border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>🔧 Admin Panel</h2>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-teal-600 text-xl`}>×</button>
          </div>
        </div>

        {/* Tabs */}
        <div className={`flex border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <button
            onClick={() => setActiveTab('prices')}
            className={`flex-1 py-3 text-sm font-semibold ${activeTab === 'prices' ? 'text-teal-500 border-b-2 border-teal-500' : mutedClass}`}
          >
            💰 Prices
          </button>
          <button
            onClick={() => setActiveTab('create')}
            className={`flex-1 py-3 text-sm font-semibold ${activeTab === 'create' ? 'text-teal-500 border-b-2 border-teal-500' : mutedClass}`}
          >
            ➕ Prediction
          </button>
          <button
            onClick={() => setActiveTab('resolve')}
            className={`flex-1 py-3 text-sm font-semibold ${activeTab === 'resolve' ? 'text-teal-500 border-b-2 border-teal-500' : mutedClass}`}
          >
            ✅ Resolve ({unresolvedPredictions.length})
          </button>
          <button
            onClick={() => setActiveTab('recover')}
            className={`flex-1 py-3 text-sm font-semibold ${activeTab === 'recover' ? 'text-amber-500 border-b-2 border-amber-500' : mutedClass}`}
          >
            🔧 Recover
          </button>
          <button
            onClick={() => setActiveTab('manage')}
            className={`flex-1 py-3 text-sm font-semibold ${activeTab === 'manage' ? 'text-teal-500 border-b-2 border-teal-500' : mutedClass}`}
          >
            📋 All
          </button>
        </div>

        {/* Message */}
        {message && (
          <div className={`mx-4 mt-4 p-3 rounded-sm text-sm font-semibold ${
            message.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
          }`}>
            {message.text}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          
          {/* PRICES TAB */}
          {activeTab === 'prices' && (
            <div className="space-y-4">
              <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-100'}`}>
                <p className={`text-sm ${mutedClass} mb-2`}>
                  📊 Manually adjust character prices. Use this for story events (deaths, power-ups, etc.)
                </p>
              </div>

              <div>
                <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Select Character</label>
                <select
                  value={selectedTicker}
                  onChange={e => setSelectedTicker(e.target.value)}
                  className={`w-full px-3 py-2 border rounded-sm ${inputClass}`}
                >
                  <option value="">-- Select Character --</option>
                  {sortedCharacters.map(c => (
                    <option key={c.ticker} value={c.ticker}>
                      {c.name} (${c.ticker}) - Current: ${(prices[c.ticker] || c.basePrice).toFixed(2)}
                    </option>
                  ))}
                </select>
              </div>

              {selectedTicker && (
                <>
                  <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700' : 'bg-slate-200'}`}>
                    <div className="flex justify-between items-center">
                      <span className={textClass}>Current Price:</span>
                      <span className={`text-lg font-bold ${textClass}`}>
                        ${(prices[selectedTicker] || 0).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className={`block text-xs font-semibold uppercase mb-2 ${mutedClass}`}>Adjustment Type</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setAdjustmentType('set')}
                        className={`flex-1 py-2 text-sm font-semibold rounded-sm ${
                          adjustmentType === 'set' ? 'bg-teal-600 text-white' : darkMode ? 'bg-slate-700 text-slate-300' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        Set Price
                      </button>
                      <button
                        onClick={() => setAdjustmentType('percent')}
                        className={`flex-1 py-2 text-sm font-semibold rounded-sm ${
                          adjustmentType === 'percent' ? 'bg-teal-600 text-white' : darkMode ? 'bg-slate-700 text-slate-300' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        % Change
                      </button>
                    </div>
                  </div>

                  {adjustmentType === 'set' ? (
                    <div>
                      <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>New Price ($)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={newPrice}
                        onChange={e => setNewPrice(e.target.value)}
                        placeholder="Enter new price..."
                        className={`w-full px-3 py-2 border rounded-sm ${inputClass}`}
                      />
                    </div>
                  ) : (
                    <div>
                      <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Percentage Change</label>
                      <input
                        type="number"
                        step="1"
                        value={percentChange}
                        onChange={e => setPercentChange(e.target.value)}
                        placeholder="e.g. -20 for -20%, 50 for +50%"
                        className={`w-full px-3 py-2 border rounded-sm ${inputClass}`}
                      />
                      <div className="flex gap-2 mt-2">
                        {[-50, -25, -10, 10, 25, 50].map(pct => (
                          <button
                            key={pct}
                            onClick={() => setPercentChange(pct.toString())}
                            className={`flex-1 py-1.5 text-xs font-semibold rounded-sm ${
                              pct < 0 ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
                            } text-white`}
                          >
                            {pct > 0 ? '+' : ''}{pct}%
                          </button>
                        ))}
                      </div>
                      {percentChange && (
                        <p className={`text-sm ${mutedClass} mt-2`}>
                          Preview: ${(prices[selectedTicker] || 0).toFixed(2)} → $
                          {(Math.round((prices[selectedTicker] || 0) * (1 + parseFloat(percentChange || 0) / 100) * 100) / 100).toFixed(2)}
                        </p>
                      )}
                    </div>
                  )}

                  <button
                    onClick={handlePriceAdjustment}
                    disabled={loading}
                    className="w-full py-3 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-sm disabled:opacity-50"
                  >
                    {loading ? 'Updating...' : '💰 Apply Price Change'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* CREATE TAB */}
          {activeTab === 'create' && (
            <div className="space-y-4">
              <div>
                <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Question</label>
                <input
                  type="text"
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  placeholder=""
                  className={`w-full px-3 py-2 border rounded-sm ${inputClass}`}
                />
              </div>

              <div>
                <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Options (2-4)</label>
                <div className="space-y-2">
                  {options.map((opt, idx) => (
                    <input
                      key={idx}
                      type="text"
                      value={opt}
                      onChange={e => {
                        const newOpts = [...options];
                        newOpts[idx] = e.target.value;
                        setOptions(newOpts);
                      }}
                      placeholder={idx < 2 ? '(required)' : '(optional)'}
                      className={`w-full px-3 py-2 border rounded-sm ${inputClass}`}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Days Until Betting Ends</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="1"
                    max="14"
                    value={daysUntilEnd}
                    onChange={e => setDaysUntilEnd(parseInt(e.target.value))}
                    className="flex-1"
                  />
                  <span className={`text-lg font-semibold ${textClass} w-20`}>{daysUntilEnd} days</span>
                </div>
                <p className={`text-xs ${mutedClass} mt-1`}>
                  Ends: {endDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} at 8:55 AM CST
                </p>
              </div>

              <button
                onClick={handleCreatePrediction}
                disabled={loading}
                className="w-full py-3 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-sm disabled:opacity-50"
              >
                {loading ? 'Creating...' : '➕ Create Prediction'}
              </button>
            </div>
          )}

          {/* RESOLVE TAB */}
          {activeTab === 'resolve' && (
            <div className="space-y-4">
              {unresolvedPredictions.length === 0 ? (
                <p className={`text-center py-8 ${mutedClass}`}>No predictions to resolve</p>
              ) : (
                <>
                  <div>
                    <label className={`block text-xs font-semibold uppercase mb-2 ${mutedClass}`}>Select Prediction</label>
                    <div className="space-y-2">
                      {unresolvedPredictions.map(p => (
                        <button
                          key={p.id}
                          onClick={() => { setSelectedPrediction(p); setSelectedOutcome(''); }}
                          className={`w-full p-3 text-left rounded-sm border transition-all ${
                            selectedPrediction?.id === p.id
                              ? 'border-teal-500 bg-teal-500/10'
                              : darkMode ? 'border-slate-600 hover:border-slate-500' : 'border-slate-300 hover:border-slate-400'
                          }`}
                        >
                          <div className={`font-semibold ${textClass}`}>{p.question}</div>
                          <div className={`text-xs ${mutedClass} mt-1`}>
                            {p.options.join(' • ')} | Pool: ${Object.values(p.pools || {}).reduce((a, b) => a + b, 0).toFixed(0)}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {selectedPrediction && (
                    <div>
                      <label className={`block text-xs font-semibold uppercase mb-2 ${mutedClass}`}>Select Winner</label>
                      <div className="grid grid-cols-2 gap-2">
                        {selectedPrediction.options.map(opt => (
                          <button
                            key={opt}
                            onClick={() => setSelectedOutcome(opt)}
                            className={`p-3 rounded-sm border-2 font-semibold transition-all ${
                              selectedOutcome === opt
                                ? 'border-green-500 bg-green-500 text-white'
                                : darkMode ? 'border-slate-600 text-slate-300 hover:border-green-500' : 'border-slate-300 hover:border-green-500'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedPrediction && selectedOutcome && (
                    <button
                      onClick={handleResolvePrediction}
                      disabled={loading}
                      className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-sm disabled:opacity-50"
                    >
                      {loading ? 'Resolving...' : `✅ Confirm Winner: "${selectedOutcome}"`}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* MANAGE TAB */}
          {activeTab === 'manage' && (
            <div className="space-y-3">
              {predictions.length === 0 ? (
                <p className={`text-center py-8 ${mutedClass}`}>No predictions yet</p>
              ) : (
                predictions.map(p => (
                  <div key={p.id} className={`p-3 rounded-sm border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-semibold ${p.resolved ? 'text-green-500' : 'text-amber-500'}`}>
                            {p.resolved ? '✅ Resolved' : '⏳ Active'}
                          </span>
                          <span className={`text-xs ${mutedClass}`}>{p.id}</span>
                        </div>
                        <div className={`font-semibold ${textClass} mt-1`}>{p.question}</div>
                        <div className={`text-xs ${mutedClass} mt-1`}>
                          Options: {p.options.join(', ')}
                        </div>
                        {p.resolved && (
                          <div className="text-xs text-green-500 mt-1">Winner: {p.outcome}</div>
                        )}
                        <div className={`text-xs ${mutedClass} mt-1`}>
                          Pool: ${Object.values(p.pools || {}).reduce((a, b) => a + b, 0).toFixed(0)}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeletePrediction(p.id)}
                        disabled={loading}
                        className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded-sm"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* RECOVER TAB */}
          {activeTab === 'recover' && (
            <div className="space-y-4">
              <div className={`p-3 rounded-sm ${darkMode ? 'bg-amber-900/20 border border-amber-700' : 'bg-amber-50 border border-amber-200'}`}>
                <p className={`text-sm text-amber-500`}>
                  ⚠️ Use this to recover bets from a lost/deleted prediction. 
                  Enter the prediction ID to find all users who placed bets.
                </p>
              </div>

              <div>
                <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Prediction ID</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={recoveryPredictionId}
                    onChange={e => setRecoveryPredictionId(e.target.value)}
                    placeholder="pred_1"
                    className={`flex-1 px-3 py-2 border rounded-sm ${inputClass}`}
                  />
                  <button
                    onClick={handleScanForBets}
                    disabled={loading}
                    className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-sm disabled:opacity-50"
                  >
                    {loading ? '...' : '🔍 Scan'}
                  </button>
                </div>
              </div>

              {recoveryBets.length > 0 && (
                <>
                  <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-100'}`}>
                    <h4 className={`font-semibold ${textClass} mb-2`}>Found {recoveryBets.length} Bets</h4>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {recoveryBets.map((bet, i) => (
                        <div key={i} className={`text-sm flex justify-between ${bet.paid ? 'text-slate-500' : textClass}`}>
                          <span className={bet.paid ? 'line-through' : ''}>{bet.displayName}</span>
                          <span>
                            <span className="text-teal-500">${bet.amount}</span>
                            {' on '}
                            <span className="font-semibold">{bet.option}</span>
                            {bet.paid && (
                              <span className={`ml-2 text-xs ${bet.payout > 0 ? 'text-green-500' : 'text-red-400'}`}>
                                {bet.payout > 0 ? `(won $${bet.payout.toFixed(2)})` : '(lost)'}
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className={`mt-2 pt-2 border-t ${darkMode ? 'border-slate-600' : 'border-slate-300'}`}>
                      <div className="flex justify-between text-sm">
                        <span className={mutedClass}>Total Pool:</span>
                        <span className={`font-bold ${textClass}`}>
                          ${recoveryBets.reduce((sum, b) => sum + b.amount, 0).toFixed(2)}
                        </span>
                      </div>
                      <div className={`text-xs ${mutedClass} mt-1`}>
                        Options: {recoveryOptions.join(', ')}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className={`block text-xs font-semibold uppercase mb-2 ${mutedClass}`}>Select Winner (for payout)</label>
                    <div className="flex flex-wrap gap-2">
                      {recoveryOptions.map(opt => (
                        <button
                          key={opt}
                          onClick={() => setRecoveryWinner(opt)}
                          className={`px-4 py-2 rounded-sm border-2 font-semibold transition-all ${
                            recoveryWinner === opt
                              ? 'border-green-500 bg-green-500 text-white'
                              : darkMode ? 'border-slate-600 text-slate-300 hover:border-green-500' : 'border-slate-300 hover:border-green-500'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleProcessRecovery('refund')}
                      disabled={loading}
                      className="py-3 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-sm disabled:opacity-50"
                    >
                      {loading ? '...' : '💰 Refund All'}
                    </button>
                    <button
                      onClick={() => handleProcessRecovery('payout')}
                      disabled={loading || !recoveryWinner}
                      className="py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-sm disabled:opacity-50"
                    >
                      {loading ? '...' : `✅ Payout Winners`}
                    </button>
                  </div>
                  
                  <p className={`text-xs ${mutedClass}`}>
                    <strong>Refund All:</strong> Returns original bet amount to everyone.<br/>
                    <strong>Payout Winners:</strong> Winners split the total pool (select winner first).
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
