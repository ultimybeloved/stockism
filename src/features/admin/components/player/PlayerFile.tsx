// One player's complete file: a header with the key facts, then tabs for
// overview, holdings, money, trades, timeline, security, notes and admin
// actions. Data comes from adminGetPlayerFile; the admin actions use the full
// user document the player list loads (selectedUser).
import { useState } from 'react';
import { ADMIN_UIDS } from '../../../../constants';
import { CREW_MAP } from '../../../../crews';
import { usePlayerFile } from '../../hooks/usePlayerFile';
import { netWorth } from '../../utils/playerRows';
import { ago, money, utc } from '../../utils/termFormat';
import { Empty, SubTabs, Tag } from '../shell/ui';
import { t } from '../shell/terminal';
import PlayerOverview from './PlayerOverview';
import PlayerHoldings from './PlayerHoldings';
import PlayerMoney from './PlayerMoney';
import PlayerTrades from './PlayerTrades';
import PlayerTimeline from './PlayerTimeline';
import PlayerSecurity from './PlayerSecurity';
import PlayerNotes from './PlayerNotes';
import PlayerAdmin from './PlayerAdmin';
import type { PlayerAdminProps } from './PlayerAdmin';
import type { PriceMap } from '../../../../types';
import type { AdminUser } from '../../utils/adminShared';

interface Props extends Omit<PlayerAdminProps, 'file' | 'onChanged'> {
  selectedUser: AdminUser;
  prices: PriceMap;
  onClose: () => void;
  showMessage: (type: string, text: string) => void;
}

const PlayerFile = (props: Props) => {
  const { selectedUser, prices, onClose, showMessage } = props;
  const [tab, setTab] = useState('overview');
  const { file, loading, error, reload, addNote, deleteNote } = usePlayerFile(selectedUser.id, showMessage);
  const [copied, setCopied] = useState(false);

  const u = file?.user || selectedUser;
  const crew = u.crew ? CREW_MAP[u.crew] : null;

  const copy = () => {
    void navigator.clipboard.writeText(selectedUser.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="space-y-3">
      <div className={`${t.panel} p-3`}>
        <div className="flex items-start gap-4">
          <button className={t.btn} onClick={onClose}>
            ← Players
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold truncate">{u.displayName}</h2>
              {ADMIN_UIDS.includes(selectedUser.id) && <Tag tone="amber">admin</Tag>}
              {!!u.isBanned && <Tag tone="red">banned</Tag>}
              {u.isBot && <Tag>bot</Tag>}
              {u.isBankrupt && <Tag tone="red">bankrupt</Tag>}
              {u.isCrewHead && <Tag tone="amber">crew head</Tag>}
              {u.isPublic === false && <Tag>private profile</Tag>}
              {u.discordId ? <Tag tone="violet">discord linked</Tag> : <Tag tone="amber">no discord</Tag>}
              {file?.watched && <Tag tone="red">on watchlist</Tag>}
              {file?.confirmedManipulator && <Tag tone="red">confirmed manipulator</Tag>}
              {file && file.notes.length > 0 && (
                <Tag tone="cyan">
                  {file.notes.length} note{file.notes.length === 1 ? '' : 's'}
                </Tag>
              )}
            </div>
            <div className={`flex flex-wrap gap-x-5 gap-y-0.5 mt-1 text-xs ${t.muted}`}>
              <button className={`${t.num} hover:text-[var(--t-text)]`} onClick={copy} title="Copy ID">
                {selectedUser.id} {copied ? '(copied)' : ''}
              </button>
              {file?.auth?.email && <span>{file.auth.email}</span>}
              {u.discordId && (
                <span>
                  Discord {u.discordUsername ? `@${u.discordUsername}` : ''}{' '}
                  <span className={t.num}>{u.discordId}</span>
                </span>
              )}
              {crew && (
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2" style={{ background: crew.color }} /> {crew.name}
                </span>
              )}
              <span>Joined {utc(u.createdAt)}</span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className={t.label}>Net worth</div>
            <div className={`${t.num} text-2xl ${t.green}`}>{money(netWorth(u))}</div>
            <div className={`${t.num} text-[11px] ${t.muted}`}>
              cash {money(u.cash)} · seen {ago(u.lastSynced || u.lastActive)} ago
            </div>
          </div>
          <button className={t.btn} onClick={reload} disabled={loading}>
            {loading ? 'Loading' : 'Reload'}
          </button>
        </div>
      </div>

      <SubTabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'holdings', label: 'Holdings' },
          { id: 'money', label: 'Money', count: file?.ledger.length },
          { id: 'trades', label: 'Trades', count: file?.trades.length },
          { id: 'timeline', label: 'Timeline' },
          { id: 'security', label: 'Security' },
          { id: 'notes', label: 'Notes', count: file?.notes.length },
          { id: 'admin', label: 'Admin actions' },
        ]}
      />

      {tab === 'admin' ? (
        <PlayerAdmin {...props} file={file} onChanged={reload} />
      ) : !file ? (
        <Empty>{error ? `Could not load this player: ${error}` : 'Loading the player file...'}</Empty>
      ) : (
        <>
          {tab === 'overview' && <PlayerOverview file={file} prices={prices} />}
          {tab === 'holdings' && <PlayerHoldings file={file} prices={prices} />}
          {tab === 'money' && <PlayerMoney file={file} />}
          {tab === 'trades' && <PlayerTrades file={file} />}
          {tab === 'timeline' && <PlayerTimeline file={file} />}
          {tab === 'security' && <PlayerSecurity file={file} />}
          {tab === 'notes' && <PlayerNotes notes={file.notes} onAdd={addNote} onDelete={deleteNote} />}
        </>
      )}
    </div>
  );
};

export default PlayerFile;
