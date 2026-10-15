// Players: the table of everyone, or one player's file when one is open.
import PlayerTable from './PlayerTable';
import PlayerFile from '../player/PlayerFile';
import type { PlayerAdminProps } from '../player/PlayerAdmin';

type Props = Omit<PlayerAdminProps, 'file' | 'onChanged' | 'selectedUser'> & {
  showMessage: (type: string, text: string) => void;
};

const PlayersSection = (props: Props) => {
  const { userList, common, showMessage } = props;
  const selected = userList.selectedUser;

  if (selected) {
    return <PlayerFile {...props} selectedUser={selected} onClose={() => userList.selectUser(null)} />;
  }
  return (
    <PlayerTable
      allUsers={userList.allUsers}
      loadedAt={userList.loadedAt}
      loading={common.loading}
      handleLoadAllUsers={userList.handleLoadAllUsers}
      showMessage={showMessage}
      onPaid={(uids, amount) =>
        userList.setAllUsers((prev) =>
          prev.map((u) =>
            uids.includes(u.id) ? { ...u, cash: u.cash + amount, grantedValue: (u.grantedValue || 0) + amount } : u,
          ),
        )
      }
    />
  );
};

export default PlayersSection;
