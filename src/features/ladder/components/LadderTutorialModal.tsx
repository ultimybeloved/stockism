import { useState } from 'react';

import { themeClasses } from '../../../utils/theme';

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

const LadderTutorialModal = ({
  onClose,
  onComplete,
  reviewMode = false,
}: {
  onClose: () => void;
  onComplete: () => void;
  reviewMode?: boolean;
}) => {
  const { textClass, mutedClass, overlayHeavyClass, modalShellClass, cardEdgeClass } = themeClasses;
  const [step, setStep] = useState(1);
  const [checks, setChecks] = useState(Array(CHECKS.length).fill(false));
  const [confirmText, setConfirmText] = useState('');

  const allChecked = checks.every(Boolean);
  const confirmValid = confirmText.trim().toUpperCase() === 'LADDER';
  const canFinish = allChecked && confirmValid;

  const toggleCheck = (i: number) => setChecks((prev) => prev.map((v, idx) => (idx === i ? !v : v)));

  const handleComplete = () => {
    onComplete();
    onClose();
  };

  return (
    <div className={`${overlayHeavyClass} z-[10001]`} onClick={onClose}>
      <div className={`${modalShellClass} max-w-lg max-h-[90vh] flex flex-col`} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={`p-4 border-b ${cardEdgeClass} flex items-center justify-between shrink-0`}>
          <div>
            <p className={`text-xs font-semibold tracking-wide ${mutedClass}`}>
              {reviewMode ? 'LADDER GAME GUIDE' : 'REQUIRED READING: LADDER GAME'}
            </p>
            <h2 className={`text-base font-bold ${textClass} mt-0.5`}>{STEPS[step - 1]!.title}</h2>
          </div>
          <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-500 text-xl leading-none`}>
            ×
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 shrink-0 light:bg-slate-100 dark:bg-zinc-800">
          <div
            className="h-full bg-orange-500 transition-all duration-300"
            style={{ width: `${(step / STEPS.length) * 100}%` }}
          />
        </div>
        <p className={`text-xs text-center py-1 shrink-0 ${mutedClass}`}>
          Step {step} of {STEPS.length}
        </p>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {step === 1 && (
            <>
              <p className={`text-sm ${textClass}`}>
                You pick a side (left or right) and a bet (odd or even). The game runs a random ladder. The outcome is
                random every time.
              </p>
              <div className="p-3 rounded-sm light:bg-slate-50 dark:bg-zinc-800">
                <p className={`text-sm ${textClass}`}>
                  If you guessed right, you double your bet. If you guessed wrong, you lose it.
                </p>
              </div>
              <div className="p-3 rounded-sm border light:border-amber-300 light:bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20">
                <p className="text-sm font-semibold light:text-amber-800 dark:text-amber-300">
                  There is no strategy. Each game has no connection to the one before it.
                </p>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="p-3 rounded-sm border light:border-red-300 light:bg-red-50 dark:border-red-700 dark:bg-red-900/20">
                <p className="text-sm font-bold light:text-red-700 dark:text-red-300">
                  Each game is 50/50. Winning doubles your money. Losing wipes your bet.
                </p>
              </div>
              <div className="p-3 rounded-sm light:bg-slate-50 dark:bg-zinc-800">
                <p className={`text-xs font-semibold tracking-wide ${mutedClass} mb-1`}>EXAMPLE</p>
                <p className={`text-sm ${textClass}`}>
                  If your bets are large relative to your balance, a few losses in a row can drain it fast. A single bad
                  run at high stakes can take you from $5,000 to nothing.
                </p>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="p-3 rounded-sm border-2 light:border-red-500 light:bg-red-50 dark:border-red-600 dark:bg-red-900/30">
                <p className="text-sm font-bold light:text-red-700 dark:text-red-300 mb-1">
                  Losing several games in a row is normal.
                </p>
                <p className="text-sm light:text-red-800 dark:text-red-200">
                  Each game is a fresh 50/50 and has no connection to the previous result.
                </p>
              </div>
              <div className="p-3 rounded-sm light:bg-slate-50 dark:bg-zinc-800">
                <p className={`text-xs font-semibold tracking-wide ${mutedClass} mb-1`}>WHY THIS MATTERS</p>
                <p className={`text-sm ${textClass}`}>
                  A losing streak does not mean a win is coming. The next game is always 50/50, no matter what happened
                  before.
                </p>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <p className={`text-sm ${textClass}`}>The ladder balance is separate from your main portfolio cash.</p>
              <div className="space-y-3">
                <div className="p-3 rounded-sm light:bg-slate-50 dark:bg-zinc-800">
                  <p className={`text-xs font-semibold tracking-wide ${mutedClass} mb-1`}>DEPOSITS</p>
                  <p className={`text-sm ${textClass}`}>
                    You move money in using the Transfer button. A deposit can&apos;t take your ladder balance past
                    $10,000, or past what you have invested in stocks, and at most $10,000 can go in per 12 hours. New
                    accounts start with lower limits that grow over their first week.
                  </p>
                </div>
                <div className="p-3 rounded-sm light:bg-slate-50 dark:bg-zinc-800">
                  <p className={`text-xs font-semibold tracking-wide ${mutedClass} mb-1`}>WINNINGS</p>
                  <p className={`text-sm ${textClass}`}>
                    Your balance can grow beyond $10,000 through winnings. The deposit cap only applies to transfers in,
                    not to your total balance.
                  </p>
                </div>
                <div className="p-3 rounded-sm light:bg-slate-50 dark:bg-zinc-800">
                  <p className={`text-xs font-semibold tracking-wide ${mutedClass} mb-1`}>WITHDRAWALS</p>
                  <p className={`text-sm ${textClass}`}>
                    You can withdraw back to your main cash at any time using the Transfer button, but withdrawals are
                    taxed: 5% on money you deposited coming back, 15% to 45% on winnings (the rate climbs with the total
                    winnings you have taken out so far), and an extra 15% if you deposited in the last 12 hours. The
                    Transfer screen shows the exact amount before you confirm.
                  </p>
                </div>
              </div>
            </>
          )}

          {step === 5 && (
            <>
              <p className={`text-sm ${mutedClass}`}>
                Check each box to confirm you have read and understood the risks. Then type{' '}
                <span className={`font-bold ${textClass}`}>LADDER</span> to proceed.
              </p>
              <div className="space-y-2">
                {CHECKS.map((label, i) => (
                  <label
                    key={i}
                    className={`flex items-start gap-3 p-3 rounded-sm cursor-pointer border transition-colors ${
                      checks[i]
                        ? 'light:border-orange-400 light:bg-orange-50 dark:border-orange-600 dark:bg-orange-900/20'
                        : 'light:border-slate-200 light:bg-slate-50 light:hover:border-slate-300 dark:border-zinc-700 dark:bg-zinc-800/50 dark:hover:border-zinc-600'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded shrink-0 border-2 flex items-center justify-center mt-0.5 transition-colors ${
                        checks[i] ? 'bg-orange-500 border-orange-500' : 'light:border-slate-300 dark:border-zinc-600'
                      }`}
                    >
                      {checks[i] && <span className="text-white text-xs font-bold">✓</span>}
                    </div>
                    <input type="checkbox" className="hidden" checked={checks[i]} onChange={() => toggleCheck(i)} />
                    <span className={`text-sm ${textClass}`}>{label}</span>
                  </label>
                ))}
              </div>
              <div className="mt-4">
                <p className={`text-xs ${mutedClass} mb-1`}>
                  Type <span className="font-bold">LADDER</span> to confirm:
                </p>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="Type LADDER"
                  className="w-full px-3 py-2 rounded-sm border text-sm font-mono light:bg-white light:border-slate-300 light:text-slate-900 light:placeholder-slate-400 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100 dark:placeholder-zinc-600 focus:outline-none focus:border-orange-500"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t light:border-slate-200 dark:border-zinc-700 flex gap-3 shrink-0">
          {step > 1 && step < 5 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="px-4 py-2 text-sm font-semibold rounded-sm light:bg-slate-200 light:hover:bg-slate-300 light:text-slate-700 dark:bg-zinc-700 dark:hover:bg-zinc-600 dark:text-zinc-200"
            >
              ← Back
            </button>
          )}
          {step === 1 && (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold rounded-sm light:bg-slate-200 light:hover:bg-slate-300 light:text-slate-700 dark:bg-zinc-700 dark:hover:bg-zinc-600 dark:text-zinc-200"
            >
              {reviewMode ? 'Close' : 'Cancel'}
            </button>
          )}
          <div className="flex-1" />
          {step < 5 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
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
