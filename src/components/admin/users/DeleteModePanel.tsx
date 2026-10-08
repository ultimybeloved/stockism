import { summarizeForDeletion } from '../../../hooks/admin/deletionSummary';
import type { AdminCommonProps } from '../types';
import type { AdminUser } from '../../../hooks/admin/adminShared';
import type { PriceMap } from '../../../types';

type DeleteModePanelProps = Pick<AdminCommonProps, 'darkMode' | 'textClass' | 'mutedClass' | 'loading'> & {
  selectedForDeletion: Set<string>;
  allUsers: AdminUser[];
  prices: PriceMap;
  deleteSelectedUsers: () => void;
};

/** Bulk-delete controls, with a live total of what the selection would remove. */
const DeleteModePanel = ({
  darkMode,
  textClass,
  mutedClass,
  loading,
  selectedForDeletion,
  allUsers,
  prices,
  deleteSelectedUsers,
}: DeleteModePanelProps) => {
  const summary = selectedForDeletion.size > 0 ? summarizeForDeletion(selectedForDeletion, allUsers, prices) : null;

  return (
    <div className={`p-3 rounded-sm border-2 border-red-500 ${darkMode ? 'bg-red-900/20' : 'bg-red-50'}`}>
      <div className="flex justify-between items-center">
        <div>
          <span className="text-red-500 font-semibold">Delete Mode Active</span>
          <span className={`ml-2 ${mutedClass}`}>{selectedForDeletion.size} selected</span>
        </div>
        <button
          onClick={deleteSelectedUsers}
          disabled={loading || selectedForDeletion.size === 0}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-sm disabled:opacity-50"
        >
          {loading ? '...' : `🗑️ Delete ${selectedForDeletion.size} Users`}
        </button>
      </div>

      {summary && (
        <div className={`mt-2 pt-2 border-t ${darkMode ? 'border-red-800' : 'border-red-300'} text-xs`}>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <span className={mutedClass}>Cash: </span>
              <span className="text-green-500 font-semibold">${summary.totalCash.toFixed(2)}</span>
            </div>
            <div>
              <span className={mutedClass}>Shares: </span>
              <span className={`font-semibold ${textClass}`}>{summary.totalShares}</span>
            </div>
            <div>
              <span className={mutedClass}>Value: </span>
              <span className="text-cyan-500 font-semibold">${summary.totalValue.toFixed(2)}</span>
            </div>
          </div>
          {summary.totalShortShares > 0 && (
            <div className="grid grid-cols-3 gap-2 mt-1">
              <div>
                <span className={mutedClass}>Shorts: </span>
                <span className="text-orange-500 font-semibold">{summary.totalShortShares}</span>
              </div>
              <div>
                <span className={mutedClass}>Collateral: </span>
                <span className="text-orange-500 font-semibold">${summary.totalShortCollateral.toFixed(2)}</span>
              </div>
              <div></div>
            </div>
          )}
        </div>
      )}

      <p className={`text-xs ${mutedClass} mt-2`}>
        Click on users to select them for deletion. Admin accounts cannot be deleted.
      </p>
    </div>
  );
};

export default DeleteModePanel;
