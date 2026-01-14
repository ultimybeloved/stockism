import React, { useState } from 'react';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from './firebase';

// Put your admin user IDs here (your Firebase Auth UID)
// Find your UID in Firebase Console → Authentication → Users
const ADMIN_UIDS = [
'4usiVxPmHLhmitEKH2HfCpbx4Yi1'
];

const AdminPanel = ({ user, predictions, darkMode, onClose }) => {
  const [activeTab, setActiveTab] = useState('create');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  
  // Create prediction form state
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '', '', '']);
  const [daysUntilEnd, setDaysUntilEnd] = useState(7);
  
  // Resolve prediction state
  const [selectedPrediction, setSelectedPrediction] = useState(null);
  const [selectedOutcome, setSelectedOutcome] = useState('');

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
        endsAt: Date.now() + (daysUntilEnd * 24 * 60 * 60 * 1000),
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
            onClick={() => setActiveTab('create')}
            className={`flex-1 py-3 text-sm font-semibold ${activeTab === 'create' ? 'text-teal-500 border-b-2 border-teal-500' : mutedClass}`}
          >
            ➕ Create New
          </button>
          <button
            onClick={() => setActiveTab('resolve')}
            className={`flex-1 py-3 text-sm font-semibold ${activeTab === 'resolve' ? 'text-teal-500 border-b-2 border-teal-500' : mutedClass}`}
          >
            ✅ Resolve ({unresolvedPredictions.length})
          </button>
          <button
            onClick={() => setActiveTab('manage')}
            className={`flex-1 py-3 text-sm font-semibold ${activeTab === 'manage' ? 'text-teal-500 border-b-2 border-teal-500' : mutedClass}`}
          >
            📋 All ({predictions.length})
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
          
          {/* CREATE TAB */}
          {activeTab === 'create' && (
            <div className="space-y-4">
              <div>
                <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Question</label>
                <input
                  type="text"
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  placeholder="Will Tom Lee defeat J this chapter?"
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
                      placeholder={`Option ${idx + 1}${idx < 2 ? ' (required)' : ' (optional)'}`}
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
                  Ends: {new Date(Date.now() + daysUntilEnd * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
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
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
