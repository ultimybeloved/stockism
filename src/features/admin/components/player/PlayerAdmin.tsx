// Player file, admin actions tab: the existing edit tools (cash, ladder,
// sync, trade as them, crew, achievements, margin, holdings, cosmetics,
// Discord link, name), the admin history on this player, and delete.
import { useAdminNav } from '../../utils/adminNav';
import { utc } from '../../utils/termFormat';
import UserFinancials from '../users/UserFinancials';
import UserTradeAs from '../users/UserTradeAs';
import UserAdminActions from '../users/UserAdminActions';
import { Empty, Panel } from '../shell/ui';
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
