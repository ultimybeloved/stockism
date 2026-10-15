// Player file, admin actions tab: the existing edit tools (cash, ladder,
// sync, trade as them, crew, achievements, margin, holdings, cosmetics,
// Discord link, name), the admin history on this player, and delete.
import { useState } from 'react';
import { adminMarketGuardFunction } from '../../../../api/callables';
import { errorMessage } from '../../../../utils/errors';
import { useAdminNav } from '../../utils/adminNav';
import { utc } from '../../utils/termFormat';
import UserFinancials from '../users/UserFinancials';
import UserTradeAs from '../users/UserTradeAs';
import UserAdminActions from '../users/UserAdminActions';
import { Empty, Panel, Tag } from '../shell/ui';
import { t } from '../shell/terminal';
import type { AdminCommonProps } from '../types';
import type { AdminUser } from '../../utils/adminShared';
import type { PriceMap } from '../../../../types';
import type { PlayerFileResponse } from '../../../../api/adminPanelTypes';
import type { useAdminUserList } from '../../hooks/useAdminUserList';
import type { useAdminUserOps } from '../../hooks/useAdminUserOps';
import type { useAdminCosmetics } from '../../hooks/useAdminCosmetics';
import type { useAdminPortfolioSync } from '../../hooks/useAdminPortfolioSync';
import type { useAdminUserDeletion } from '../../hooks/useAdminUserDeletion';

export interface PlayerAdminProps {
  common: AdminCommonProps;
  prices: PriceMap;
  selectedUser: AdminUser;
  file: PlayerFileResponse | null;
  onChanged: () => void;
  userList: ReturnType<typeof useAdminUserList>;
  userOps: ReturnType<typeof useAdminUserOps>;
  cosmetics: ReturnType<typeof useAdminCosmetics>;
  portfolioSync: ReturnType<typeof useAdminPortfolioSync>;
  userDeletion: ReturnType<typeof useAdminUserDeletion>;
}

const s = (v: unknown) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

const PlayerAdmin = ({
  common,
  prices,
  selectedUser,
  file,
  onChanged,
  userList,
  userOps,
  cosmetics,
  portfolioSync,
  userDeletion,
}: PlayerAdminProps) => {
  const nav = useAdminNav();
  const { textClass, mutedClass, inputClass, loading } = common;
  const name = selectedUser.displayName || selectedUser.username || '';
  const actions = [...(file?.adminActions || [])].sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
  const [guardBusy, setGuardBusy] = useState(false);
  const [guardError, setGuardError] = useState<string | null>(null);

  const toggleGuard = async () => {
    const confirmed = !file?.confirmedManipulator;
    const question = confirmed
      ? `Confirm ${name} as a manipulator? The bot will push back on their pumps and dumps.`
      : `Take ${name} off the confirmed list?`;
    if (!window.confirm(question)) return;
    setGuardBusy(true);
    setGuardError(null);
    try {
      await adminMarketGuardFunction({ action: 'set', uid: selectedUser.id, confirmed });
      onChanged();
    } catch (err) {
      setGuardError(errorMessage(err));
    } finally {
      setGuardBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-2 gap-3 items-start">
      <div className="space-y-3">
        <Panel title="Money">
          <div className="flex gap-2 mb-3">
            <button
              className={t.btnGo}
              disabled={loading}
              onClick={() => userOps.handleSetCash(selectedUser.id, name, selectedUser.cash)}
            >
              Edit cash
            </button>
            <button
              className={t.btn}
              disabled={loading}
              onClick={() => userOps.handleTransferToLadder(selectedUser.id, name)}
            >
              Move to or from ladder
            </button>
          </div>
          <UserFinancials
            textClass={textClass}
            mutedClass={mutedClass}
            loading={loading}
            prices={prices}
            selectedUser={selectedUser}
            calculateLivePortfolioValue={userList.calculateLivePortfolioValue}
            handleSyncSingleUser={portfolioSync.handleSyncSingleUser}
          />
        </Panel>
        <Panel title="Trade as this player">
          <UserTradeAs mutedClass={mutedClass} inputClass={inputClass} selectedUser={selectedUser} />
        </Panel>
        <Panel title={`Admin history on this player (${actions.length})`} pad={false}>
          {actions.length === 0 ? (
            <Empty>No admin actions recorded</Empty>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <tbody>
                  {actions.map((a) => (
                    <tr key={a.id} className={t.row}>
                      <td className={`${t.td} ${t.num} ${t.muted}`}>{utc(a.at)}</td>
                      <td className={t.td}>{s(a.action).replace(/_/g, ' ')}</td>
                      <td className={`${t.td} whitespace-normal text-xs ${t.muted} max-w-xs break-all`}>
                        {a.before !== undefined && a.before !== null ? `${s(a.before).slice(0, 80)} → ` : ''}
                        {s(a.after).slice(0, 80)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title="Market guard">
          <div className="flex items-center gap-3">
            {file?.confirmedManipulator ? <Tag tone="red">confirmed manipulator</Tag> : <Tag>not confirmed</Tag>}
            <button
              className={file?.confirmedManipulator ? t.btn : t.btnDanger}
              disabled={loading || guardBusy || !file}
              onClick={toggleGuard}
            >
              {file?.confirmedManipulator ? 'Remove from list' : 'Confirm as manipulator'}
            </button>
          </div>
          <p className={`text-xs ${t.muted} mt-2`}>
            The bot pushes back on pumps and dumps by confirmed players, and the stabilizer stops lifting stocks they
            bought the bottom of. Full list under Market guard.
          </p>
          {guardError && <p className={`text-xs ${t.red} mt-1`}>{guardError}</p>}
        </Panel>
        <Panel title="Danger">
          <button
            className={t.btnDanger}
            disabled={loading}
            onClick={async () => {
              if (await userDeletion.deleteUser(selectedUser)) {
                userList.setSelectedUser(null);
                nav.goTo('players');
              }
            }}
          >
            Delete this account
          </button>
          <p className={`text-xs ${t.muted} mt-2`}>Asks twice and shows what goes with it. Cannot be undone.</p>
        </Panel>
      </div>

      <Panel title="Edit">
        <UserAdminActions
          textClass={textClass}
          mutedClass={mutedClass}
          inputClass={inputClass}
          loading={loading}
          selectedUser={selectedUser}
          {...userOps}
          {...cosmetics}
        />
      </Panel>
    </div>
  );
};

export default PlayerAdmin;
