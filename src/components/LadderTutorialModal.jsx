import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { getThemeClasses } from '../utils/theme';

const STEPS = [
  { id: 1, title: 'How it works' },
  { id: 2, title: 'The risk' },
  { id: 3, title: 'Losing streaks' },
  { id: 4, title: 'Your balance' },
  { id: 5, title: 'Acknowledgments' },
];

const CHECKS = [
  'I understand the outcome of each game is random',
  'I understand I can lose my entire ladder balance',
  'I understand each game is independent and losing streaks do not predict future results',
  'I accept responsibility for how I use the ladder game',
];

const LadderTutorialModal = ({ onClose, onComplete, reviewMode = false }) => {
  const { darkMode } = useAppContext();
  const { cardClass, textClass, mutedClass } = getThemeClasses(darkMode);
  const [step, setStep] = useState(1);
  const [checks, setChecks] = useState(Array(CHECKS.length).fill(false));
  const [confirmText, setConfirmText] = useState('');

  const allChecked = checks.every(Boolean);
  const confirmValid = confirmText.trim().toUpperCase() === 'LADDER';
  const canFinish = allChecked && confirmValid;

  const toggleCheck = (i) => setChecks(prev => prev.map((v, idx) => idx === i ? !v : v));

  const handleComplete = () => {
    onComplete();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[10001]" onClick={onClose}>
      <div
        className={`w-full max-w-lg max-h-[90vh] ${cardClass} border rounded-sm shadow-xl flex flex-col`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`p-4 border-b ${darkMode ? 'border-zinc-700' : 'border-slate-200'} flex items-center justify-between shrink-0`}>
          <div>
            <p className={`text-xs font-semibold tracking-wide ${mutedClass}`}>
              {reviewMode ? 'LADDER GAME GUIDE' : 'REQUIRED READING — LADDER GAME'}
            </p>
            <h2 className={`text-base font-bold ${textClass} mt-0.5`}>
              {STEPS[step - 1].title}
            </h2>
          </div>
          <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-500 text-xl leading-none`}>×</button>
        </div>

        {/* Progress bar */}
        <div className={`h-1 shrink-0 ${darkMode ? 'bg-zinc-800' : 'bg-slate-100'}`}>
          <div
            className="h-full bg-orange-500 transition-all duration-300"
            style={{ width: `${(step / STEPS.length) * 100}%` }}
          />
        </div>
        <p className={`text-xs text-center py-1 shrink-0 ${mutedClass}`}>Step {step} of {STEPS.length}</p>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {step === 1 && (
            <>
              <p className={`text-sm ${textClass}`}>
                You pick a side (left or right) and a bet (odd or even). The game runs a random ladder. The outcome is random every time.
              </p>
              <div className={`p-3 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-50'}`}>
                <p className={`text-sm ${textClass}`}>If you guessed right, you double your bet. If you guessed wrong, you lose it.</p>
              </div>
              <div className={`p-3 rounded-sm border ${darkMode ? 'border-amber-700 bg-amber-900/20' : 'border-amber-300 bg-amber-50'}`}>
                <p className={`text-sm font-semibold ${darkMode ? 'text-amber-300' : 'text-amber-800'}`}>
                  There is no strategy. Each game has no connection to the one before it.
                </p>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className={`p-3 rounded-sm border ${darkMode ? 'border-red-700 bg-red-900/20' : 'border-red-300 bg-red-50'}`}>
                <p className={`text-sm font-bold ${darkMode ? 'text-red-300' : 'text-red-700'}`}>
                  Each game is 50/50. Winning doubles your money. Losing wipes your bet.
                </p>
              </div>
              <div className={`p-3 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-50'}`}>
                <p className={`text-xs font-semibold tracking-wide ${mutedClass} mb-1`}>EXAMPLE</p>
                <p className={`text-sm ${textClass}`}>If your bets are large relative to your balance, a few losses in a row can drain it fast. A single bad run at high stakes can take you from $5,000 to nothing.</p>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className={`p-3 rounded-sm border-2 ${darkMode ? 'border-red-600 bg-red-900/30' : 'border-red-500 bg-red-50'}`}>
                <p className={`text-sm font-bold ${darkMode ? 'text-red-300' : 'text-red-700'} mb-1`}>
                  Losing several games in a row is normal.
                </p>
                <p className={`text-sm ${darkMode ? 'text-red-200' : 'text-red-800'}`}>
                  Each game is a fresh 50/50 and has no connection to the previous result.
                </p>
              </div>
              <div className={`p-3 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-50'}`}>
                <p className={`text-xs font-semibold tracking-wide ${mutedClass} mb-1`}>WHY THIS MATTERS</p>
                <p className={`text-sm ${textClass}`}>A losing streak does not mean a win is coming. The next game is always 50/50, no matter what happened before.</p>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <p className={`text-sm ${textClass}`}>
                The ladder balance is separate from your main portfolio cash.
              </p>
              <div className="space-y-3">
                <div className={`p-3 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-50'}`}>
                  <p className={`text-xs font-semibold tracking-wide ${mutedClass} mb-1`}>DEPOSITS</p>
                  <p className={`text-sm ${textClass}`}>You move money in using the Transfer button. You can deposit up to $10,000 total into the ladder game.</p>
                </div>
                <div className={`p-3 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-50'}`}>
                  <p className={`text-xs font-semibold tracking-wide ${mutedClass} mb-1`}>WINNINGS</p>
                  <p className={`text-sm ${textClass}`}>Your balance can grow beyond $10,000 through winnings. The deposit cap only applies to transfers in, not to your total balance.</p>
                </div>
                <div className={`p-3 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-50'}`}>
                  <p className={`text-xs font-semibold tracking-wide ${mutedClass} mb-1`}>WITHDRAWALS</p>
                  <p className={`text-sm ${textClass}`}>You can withdraw any amount back to your main cash at any time using the Transfer button.</p>
                </div>
              </div>
            </>
          )}

          {step === 5 && (
            <>
              <p className={`text-sm ${mutedClass}`}>
                Check each box to confirm you have read and understood the risks. Then type <span className={`font-bold ${textClass}`}>LADDER</span> to proceed.
              </p>
              <div className="space-y-2">
                {CHECKS.map((label, i) => (
                  <label
                    key={i}
                    className={`flex items-start gap-3 p-3 rounded-sm cursor-pointer border transition-colors ${
                      checks[i]
                        ? darkMode ? 'border-orange-600 bg-orange-900/20' : 'border-orange-400 bg-orange-50'
                        : darkMode ? 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-600' : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded shrink-0 border-2 flex items-center justify-center mt-0.5 transition-colors ${
                      checks[i] ? 'bg-orange-500 border-orange-500' : darkMode ? 'border-zinc-600' : 'border-slate-300'
                    }`}>
                      {checks[i] && <span className="text-white text-xs font-bold">✓</span>}
                    </div>
                    <input type="checkbox" className="hidden" checked={checks[i]} onChange={() => toggleCheck(i)} />
                    <span className={`text-sm ${textClass}`}>{label}</span>
                  </label>
                ))}
              </div>
              <div className="mt-4">
                <p className={`text-xs ${mutedClass} mb-1`}>Type <span className="font-bold">LADDER</span> to confirm:</p>
                <input
                  type="text"
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  placeholder="Type LADDER"
                  className={`w-full px-3 py-2 rounded-sm border text-sm font-mono ${
                    darkMode
                      ? 'bg-zinc-800 border-zinc-700 text-zinc-100 placeholder-zinc-600'
                      : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'
                  } focus:outline-none focus:border-orange-500`}
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className={`p-4 border-t ${darkMode ? 'border-zinc-700' : 'border-slate-200'} flex gap-3 shrink-0`}>
          {step > 1 && step < 5 && (
            <button
              onClick={() => setStep(s => s - 1)}
              className={`px-4 py-2 text-sm font-semibold rounded-sm ${darkMode ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}
            >
              ← Back
            </button>
          )}
          {step === 1 && (
            <button
              onClick={onClose}
              className={`px-4 py-2 text-sm font-semibold rounded-sm ${darkMode ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}
            >
              {reviewMode ? 'Close' : 'Cancel'}
            </button>
          )}
          <div className="flex-1" />
          {step < 5 ? (
            <button
              onClick={() => setStep(s => s + 1)}
              className="px-5 py-2 text-sm font-semibold rounded-sm bg-orange-600 hover:bg-orange-700 text-white"
            >
              Next →
            </button>
          ) : (
            <button
              onClick={reviewMode ? onClose : handleComplete}
              disabled={!reviewMode && !canFinish}
              className="flex-1 px-5 py-2 text-sm font-semibold rounded-sm bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {reviewMode ? 'Done' : 'Got it, let me play'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default LadderTutorialModal;
