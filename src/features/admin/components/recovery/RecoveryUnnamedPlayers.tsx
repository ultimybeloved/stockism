// Name the players who never got one. Preview shows the planned names; Apply
// writes them and gives each player one free name change.
import { useState } from 'react';
import { adminNameUnnamedFunction } from '../../../../api/callables';
import type { NameUnnamedResponse } from '../../../../api/types';
import { errorMessage } from '../../../../utils/errors';
import type { AdminCommonProps } from '../types';
import type { ShowMessage } from '../../utils/adminShared';
import AdminIcon from '../AdminIcon';

type Props = Pick<AdminCommonProps, 'textClass' | 'mutedClass'> & { showMessage: ShowMessage };

const RecoveryUnnamedPlayers = ({ textClass, mutedClass, showMessage }: Props) => {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NameUnnamedResponse | null>(null);

  const run = async (dryRun: boolean) => {
    if (!dryRun && !window.confirm(`Rename ${result?.plan.length} players and give each a free name change?`)) return;
    setBusy(true);
    try {
      const { data } = await adminNameUnnamedFunction({ dryRun });
      setResult(data);
      if (!dryRun) showMessage('success', `Named ${data.applied} players. ${data.skipped.length} skipped.`);
    } catch (err) {
      showMessage('error', errorMessage(err));
    }
    setBusy(false);
  };

  const previewed = result?.dryRun && result.plan.length > 0;

  return (
    <div className="p-4 rounded-sm light:bg-white dark:bg-slate-800 border light:border-slate-200 dark:border-slate-700">
      <h3 className={`font-semibold mb-2 ${textClass}`}>
        <AdminIcon name="profile" />
        Unnamed Players
      </h3>
      <p className={`text-sm ${mutedClass} mb-3`}>
        Gives every player with no name (or a name like User or Anonymous) their Discord name, or a random investing
        name. Each one gets a message and one free name change.
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => void run(true)}
          disabled={busy}
          className="flex-1 px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white font-semibold rounded-sm disabled:opacity-50"
        >
          {busy && !previewed ? 'Checking...' : 'Preview'}
        </button>
        <button
          onClick={() => void run(false)}
          disabled={busy || !previewed}
          className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-sm disabled:opacity-50"
        >
          {busy && previewed ? 'Naming...' : 'Apply'}
        </button>
      </div>
      {result && (
        <div className="mt-3 text-xs">
          {result.plan.length === 0 ? (
            <p className={mutedClass}>Every player has a name.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className={mutedClass}>
                  <th className="text-left font-normal py-1">Now</th>
                  <th className="text-left font-normal">New name</th>
                  <th className="text-left font-normal">From</th>
                  {!result.dryRun && <th className="text-left font-normal">Result</th>}
                </tr>
              </thead>
              <tbody>
                {result.plan.map((p) => {
                  const skip = result.skipped.find((s) => s.uid === p.uid);
                  return (
                    <tr key={p.uid} className={textClass}>
                      <td className={`py-0.5 ${mutedClass}`}>{p.from || '(none)'}</td>
                      <td className="font-semibold">{p.to}</td>
                      <td className={mutedClass}>{p.source === 'discord' ? 'Discord' : 'Random'}</td>
                      {!result.dryRun && <td>{skip ? `Skipped: ${skip.reason}` : 'Done'}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};

export default RecoveryUnnamedPlayers;
