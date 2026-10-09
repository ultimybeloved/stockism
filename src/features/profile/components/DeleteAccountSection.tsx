import { useState } from 'react';
import { themeClasses } from '../../../utils/theme';
import type { UserData } from '../../../types';

// The multi-step "delete account" confirmation flow. Owns its own step state.
const DeleteAccountSection = ({
  userData,
  onDeleteAccount,
}: {
  userData: UserData | null;
  onDeleteAccount: (confirmUsername: string) => Promise<void>;
}) => {
  const [deleteStep, setDeleteStep] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [confirmUsername, setConfirmUsername] = useState('');
  const { mutedClass, subtleClass, borderClass } = themeClasses;

  return (
    <div className={`mt-6 pt-4 border-t ${borderClass}`}>
      {deleteStep === 0 && (
        <button
          onClick={() => setDeleteStep(1)}
          className={`text-xs ${mutedClass} hover:text-red-500 transition-colors`}
        >
          🗑️ Delete Account
        </button>
      )}

      {deleteStep === 1 && (
        <div className={`p-3 rounded-sm ${subtleClass}`}>
          <h4 className="font-semibold text-red-500 mb-2">Delete Your Account</h4>
          <p className={`text-sm ${mutedClass} mb-3`}>
            This will permanently delete your account and all associated data including:
          </p>
          <ul className={`text-sm ${mutedClass} mb-3 ml-4 list-disc`}>
            <li>Your username and profile</li>
            <li>All cash and holdings</li>
            <li>Trade history and achievements</li>
            <li>Prediction bets and results</li>
          </ul>
          <p className="text-xs text-red-400 mb-3">This action cannot be undone.</p>
          <div className="flex gap-2">
            <button
              onClick={() => setDeleteStep(0)}
              className="flex-1 py-2 text-sm font-semibold rounded-sm light:bg-slate-200 light:hover:bg-slate-300 light:text-slate-700 dark:bg-zinc-700 dark:hover:bg-zinc-600 dark:text-zinc-200"
            >
              Cancel
            </button>
            <button
              onClick={() => setDeleteStep(2)}
              className="flex-1 py-2 text-sm font-semibold rounded-sm bg-red-600 hover:bg-red-700 text-white"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {deleteStep === 2 && (
        <div className="p-3 rounded-sm border-2 border-red-500 light:bg-red-50 dark:bg-red-900/20">
          <h4 className="font-semibold text-red-500 mb-2">⚠️ Are you sure?</h4>
          <p className={`text-sm ${mutedClass} mb-3`}>
            You're about to permanently delete your account "{userData?.displayName}".
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setDeleteStep(0)}
              className="flex-1 py-2 text-sm font-semibold rounded-sm light:bg-slate-200 light:hover:bg-slate-300 light:text-slate-700 dark:bg-zinc-700 dark:hover:bg-zinc-600 dark:text-zinc-200"
            >
              Cancel
            </button>
            <button
              onClick={() => setDeleteStep(3)}
              className="flex-1 py-2 text-sm font-semibold rounded-sm bg-red-600 hover:bg-red-700 text-white"
            >
              Yes, Delete My Account
            </button>
          </div>
        </div>
      )}

      {deleteStep === 3 && (
        <div className="p-3 rounded-sm border-2 border-red-600 light:bg-red-100 dark:bg-red-900/30">
          <h4 className="font-semibold text-red-600 mb-2">🚨 Are you absolutely certain?</h4>
          <p className="text-sm text-red-500 mb-3">
            Your account and all data will be permanently erased. There is no recovery.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setDeleteStep(0)}
              className="flex-1 py-2 text-sm font-semibold rounded-sm light:bg-slate-200 light:hover:bg-slate-300 light:text-slate-700 dark:bg-zinc-700 dark:hover:bg-zinc-600 dark:text-zinc-200"
            >
              Cancel
            </button>
            <button
              onClick={() => setDeleteStep(4)}
              className="flex-1 py-2 text-sm font-bold rounded-sm bg-red-700 hover:bg-red-800 text-white"
            >
              Continue Deletion
            </button>
          </div>
        </div>
      )}

      {deleteStep === 4 && (
        <div className="p-3 rounded-sm border-2 border-rose-700 light:bg-rose-100 dark:bg-rose-900/40">
          <h4 className="font-semibold text-rose-700 mb-2">⚠️ Point of No Return</h4>
          <p className="text-sm text-rose-600 mb-3">
            After the next step, your account "{userData?.displayName}" will be gone forever.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setDeleteStep(0)}
              className="flex-1 py-2 text-sm font-semibold rounded-sm light:bg-slate-200 light:hover:bg-slate-300 light:text-slate-700 dark:bg-zinc-700 dark:hover:bg-zinc-600 dark:text-zinc-200"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                setDeleteStep(5);
                setConfirmUsername('');
              }}
              className="flex-1 py-2 text-sm font-bold rounded-sm bg-rose-700 hover:bg-rose-800 text-white"
            >
              Proceed to Final Step
            </button>
          </div>
        </div>
      )}

      {deleteStep === 5 && (
        <div className="p-3 rounded-sm border-2 light:border-zinc-800 light:bg-white dark:border-white dark:bg-zinc-950">
          <h4 className="font-semibold mb-2 light:text-zinc-900 dark:text-white">Final Confirmation</h4>
          <p className="text-sm mb-3 light:text-zinc-600 dark:text-zinc-300">
            Type your username <span className="font-bold">{userData?.displayName}</span> to confirm deletion:
          </p>
          <input
            type="text"
            value={confirmUsername}
            onChange={(e) => setConfirmUsername(e.target.value)}
            placeholder="Enter your username"
            className="w-full px-3 py-2 mb-3 rounded-sm border light:bg-zinc-50 light:border-zinc-300 light:text-zinc-900 light:placeholder-zinc-400 dark:bg-zinc-900 dark:border-zinc-600 dark:text-white dark:placeholder-zinc-500"
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                setDeleteStep(0);
                setConfirmUsername('');
              }}
              className="flex-1 py-2 text-sm font-semibold rounded-sm light:bg-slate-200 light:hover:bg-slate-300 light:text-slate-700 dark:bg-zinc-700 dark:hover:bg-zinc-600 dark:text-zinc-200"
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                setDeleting(true);
                try {
                  await onDeleteAccount(confirmUsername);
                } catch (err) {
                  console.error('Failed to delete account:', err);
                  setDeleting(false);
                }
              }}
              disabled={deleting || confirmUsername.toLowerCase() !== userData?.displayName?.toLowerCase()}
              className="flex-1 py-2 text-sm font-bold rounded-sm disabled:opacity-50 light:bg-zinc-900 light:hover:bg-zinc-800 light:text-white dark:bg-white dark:hover:bg-zinc-200 dark:text-zinc-900"
            >
              {deleting ? 'Deleting...' : 'Delete My Account'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DeleteAccountSection;
