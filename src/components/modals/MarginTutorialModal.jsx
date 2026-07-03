import { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { getThemeClasses } from '../../utils/theme';

const STEPS = [
  { id: 1, title: 'What is margin trading?' },
  { id: 2, title: 'Auto-liquidation' },
  { id: 3, title: 'The concentration danger' },
  { id: 4, title: 'Short selling with margin' },
  { id: 5, title: 'Know your numbers' },
  { id: 6, title: 'Acknowledgments' },
];

const CHECKS = [
  'I understand I can lose more money than I put in',
  'I understand my positions can be auto-liquidated without any warning',
  'I understand concentrating everything in one stock is extremely dangerous with margin',
  'I understand short selling with margin carries the highest risk in this game',
  'I accept full responsibility for my margin trades',
];

const MarginTutorialModal = ({ onClose, onComplete, reviewMode = false }) => {
  const { darkMode } = useAppContext();
  const { cardClass, textClass, mutedClass } = getThemeClasses(darkMode);
  const [step, setStep] = useState(1);
  const [checks, setChecks] = useState(Array(CHECKS.length).fill(false));
  const [confirmText, setConfirmText] = useState('');

  const allChecked = checks.every(Boolean);
  const confirmValid = confirmText.trim().toUpperCase() === 'MARGIN';
  const canFinish = allChecked && confirmValid;

  const toggleCheck = (i) => setChecks(prev => prev.map((v, idx) => idx === i ? !v : v));

  const handleComplete = () => {
    onComplete();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className={`w-full max-w-lg max-h-[90vh] ${cardClass} border rounded-sm shadow-xl flex flex-col`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`p-4 border-b ${darkMode ? 'border-zinc-700' : 'border-slate-200'} flex items-center justify-between shrink-0`}>
          <div>
            <p className={`text-xs font-semibold tracking-wide ${mutedClass}`}>
              {reviewMode ? 'MARGIN SAFETY GUIDE' : 'REQUIRED READING — MARGIN TRADING'}
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
                Margin lets you borrow money against your portfolio to trade with more than you actually have.
              </p>
              <div className={`p-3 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-50'} space-y-2`}>
                <p className={`text-sm ${textClass}`}><span className="font-semibold">Example:</span> You have $3,000. With margin, you can borrow up to $3,000 more and trade with $6,000 total.</p>
              </div>
              <div className="space-y-2">
                <div className={`flex gap-2 text-sm ${textClass}`}>
                  <span className="text-orange-500 shrink-0 font-bold">+</span>
                  <span>When trades go your way, your gains are amplified</span>
                </div>
                <div className={`flex gap-2 text-sm ${textClass}`}>
                  <span className="text-red-500 shrink-0 font-bold">−</span>
                  <span>When trades go against you, your losses are amplified. You still owe the borrowed amount regardless.</span>
                </div>
                <div className={`flex gap-2 text-sm ${textClass}`}>
                  <span className="text-red-500 shrink-0 font-bold">−</span>
                  <span>Interest charges 0.5% per day on whatever you've borrowed</span>
                </div>
              </div>
              <div className={`p-3 rounded-sm border ${darkMode ? 'border-amber-700 bg-amber-900/20' : 'border-amber-300 bg-amber-50'}`}>
                <p className={`text-sm font-semibold ${darkMode ? 'text-amber-300' : 'text-amber-800'}`}>
                  Margin amplifies both gains and losses. The borrowed amount always needs to be paid back.
                </p>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className={`p-3 rounded-sm border ${darkMode ? 'border-red-700 bg-red-900/20' : 'border-red-300 bg-red-50'}`}>
                <p className={`text-sm font-bold ${darkMode ? 'text-red-300' : 'text-red-700'}`}>
                  If your equity drops too low, the system will force-close your positions automatically. You do not get a choice.
                </p>
              </div>
              <div className="space-y-3">
                <div className={`p-3 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-50'}`}>
                  <p className={`text-xs font-semibold tracking-wide ${mutedClass} mb-1`}>HOW IT WORKS</p>
                  <p className={`text-sm ${textClass}`}>The system checks every <span className="font-semibold">5 minutes</span>. If your equity ratio (how much of the position value you still own) falls below <span className="font-semibold text-red-500">25%</span>, your short positions are force-covered at whatever the current price is.</p>
                </div>
                <div className={`p-3 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-50'}`}>
                  <p className={`text-xs font-semibold tracking-wide ${mutedClass} mb-1`}>THURSDAY GRACE PERIOD</p>
                  <p className={`text-sm ${textClass}`}>After the weekly market opens at <span className="font-semibold">21:00 UTC Thursday</span>, auto-liquidations are paused until <span className="font-semibold">21:30 UTC</span>. You have 30 minutes before checks resume.</p>
                </div>
                <div className={`p-3 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-50'}`}>
                  <p className={`text-xs font-semibold tracking-wide ${mutedClass} mb-1`}>OUTSIDE THE GRACE PERIOD</p>
                  <p className={`text-sm ${textClass}`}>You have at most 5 minutes between checks. If prices move fast and you aren't watching, you can be liquidated before you even load the page.</p>
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className={`p-3 rounded-sm border-2 ${darkMode ? 'border-red-600 bg-red-900/30' : 'border-red-500 bg-red-50'}`}>
                <p className={`text-sm font-bold ${darkMode ? 'text-red-300' : 'text-red-700'} mb-1`}>
                  ⚠️ This is the scenario that has wiped out traders on this platform.
                </p>
                <p className={`text-sm ${darkMode ? 'text-red-200' : 'text-red-800'}`}>
                  Putting all your cash AND margin into a single stock.
                </p>
              </div>
              <div className={`p-4 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-50'} space-y-2`}>
                <p className={`text-xs font-semibold tracking-wide ${mutedClass}`}>REAL EXAMPLE</p>
                <div className={`space-y-1 text-sm ${textClass}`}>
                  <p>Portfolio: <span className="font-semibold">$5,000</span></p>
                  <p>Borrow via margin: <span className="font-semibold">$5,000</span></p>
                  <p>Put everything into one stock: <span className="font-semibold">$10,000</span></p>
                </div>
                <div className={`mt-3 pt-3 border-t ${darkMode ? 'border-zinc-700' : 'border-slate-200'} space-y-1 text-sm`}>
                  <p className={textClass}>That stock drops <span className="font-semibold text-red-500">50%</span>.</p>
                  <p className={textClass}>Your position is now worth <span className="font-semibold">$5,000</span>.</p>
                  <p className={textClass}>You owe <span className="font-semibold">$5,000</span> in margin.</p>
                  <p className={`font-bold text-red-500`}>Equity: $0. You are bankrupt.</p>
                </div>
              </div>
              <div className="space-y-2">
                <div className={`flex gap-2 text-sm ${textClass}`}>
                  <span className="text-green-500 shrink-0 font-bold">✓</span>
                  <span>Spreading across multiple characters reduces your exposure. One bad move is less likely to wipe everything out.</span>
                </div>
                <div className={`flex gap-2 text-sm ${textClass}`}>
                  <span className="text-green-500 shrink-0 font-bold">✓</span>
                  <span>Never put in more than you can afford to lose entirely.</span>
                </div>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <p className={`text-sm ${textClass}`}>
                Short selling (betting a stock goes down) is already one of the highest-risk strategies. Combining it with margin amplifies that risk further.
              </p>
              <div className="space-y-3">
                <div className={`p-3 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-50'}`}>
                  <p className={`text-xs font-semibold tracking-wide ${mutedClass} mb-1`}>HOW SHORTS LOSE MONEY</p>
                  <p className={`text-sm ${textClass}`}>If you short a stock and its price goes <span className="font-semibold">up</span>, you lose money. There is no ceiling on how high a price can go. A short position can lose more than you put in.</p>
                </div>
                <div className={`p-3 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-50'}`}>
                  <p className={`text-xs font-semibold tracking-wide ${mutedClass} mb-1`}>COORDINATED SHORTING</p>
                  <p className={`text-sm ${textClass}`}>When multiple people short the same character at once, it can trigger a short squeeze — a spike in price that simultaneously liquidates everyone. We have seen this happen. The losses are instant and total.</p>
                </div>
                <div className={`p-3 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-50'}`}>
                  <p className={`text-xs font-semibold tracking-wide ${mutedClass} mb-1`}>THE CAP</p>
                  <p className={`text-sm ${textClass}`}>Your total short exposure cannot exceed your portfolio value (1:1 cap). This limits how much damage is possible, but it still means losing your entire net worth if things go wrong.</p>
                </div>
              </div>
            </>
          )}

          {step === 5 && (
            <>
              <p className={`text-sm ${mutedClass}`}>Know these numbers before you trade with margin.</p>
              <div className="space-y-2">
                {[
                  ['Margin interest rate', '0.5% per day on borrowed amount'],
                  ['Margin call threshold', '25% equity ratio. Below this, auto-liquidation triggers.'],
                  ['Max short exposure', '100% of your portfolio value (1:1 cap)'],
                  ['Grace period', '21:00 to 21:30 UTC Thursday. No liquidations during this window.'],
                  ['Liquidation check', 'Every 5 minutes outside the grace period'],
                  ['After margin call', 'Your cash can go negative. This means bankruptcy.'],
                ].map(([label, value]) => (
                  <div key={label} className={`p-3 rounded-sm flex justify-between gap-3 ${darkMode ? 'bg-zinc-800' : 'bg-slate-50'}`}>
                    <span className={`text-sm font-semibold ${textClass} shrink-0`}>{label}</span>
                    <span className={`text-sm ${mutedClass} text-right`}>{value}</span>
                  </div>
                ))}
              </div>
              <div className={`p-3 rounded-sm border ${darkMode ? 'border-amber-700 bg-amber-900/20' : 'border-amber-300 bg-amber-50'}`}>
                <p className={`text-sm ${darkMode ? 'text-amber-300' : 'text-amber-800'}`}>
                  These rules apply 24/7. The system doesn't care if you're asleep or offline.
                </p>
              </div>
            </>
          )}

          {step === 6 && (
            <>
              <p className={`text-sm ${mutedClass}`}>
                Check each box to confirm you have read and understood the risks. Then type <span className={`font-bold ${textClass}`}>MARGIN</span> to proceed.
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
                <p className={`text-xs ${mutedClass} mb-1`}>Type <span className="font-bold">MARGIN</span> to confirm:</p>
                <input
                  type="text"
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  placeholder="Type MARGIN"
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
          {step > 1 && step < 6 && (
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
          {step < 6 ? (
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
              {reviewMode ? 'Done' : 'I Understand — Continue to Margin'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default MarginTutorialModal;
