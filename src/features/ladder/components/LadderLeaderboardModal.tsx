import { useState } from 'react';
import { bgCard, bgCardInner, btnGray, textDark, textLight } from './ladderStyles';
import { useModalFocus } from '../../../shared/hooks/useModalFocus';
import type { LadderBoard, LadderLeader } from '../../../api/types';

// Ladder leaderboard modal. Data loading lives in useLadderModals (it fires
// when the modal opens and whenever the board changes).
const BOARDS: { key: LadderBoard; label: string }[] = [
  { key: 'net', label: 'Net Winnings' },
  { key: 'streak', label: 'Best Streak' },
  { key: 'games', label: 'Games' },
];

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString()}`;

// The number each board ranks on, then the supporting detail.
const rowValue = (board: LadderBoard, p: LadderLeader): [string, string] => {
  if (board === 'streak') return [`${p.bestStreak ?? 0} wins`, `${p.winRate ?? 0}% win rate`];
  if (board === 'games') return [(p.gamesPlayed ?? 0).toLocaleString(), `${p.winRate ?? 0}% win rate`];
  return [money(p.netWinnings ?? 0), `${(p.gamesPlayed ?? 0).toLocaleString()} games`];
};

interface LadderLeaderboardModalProps {
  leaderboard: LadderLeader[];
  leaderboardLoading: boolean;
  board: LadderBoard;
  setBoard: (board: LadderBoard) => void;
  setShowLeaderboardModal: (show: boolean) => void;
}

const LadderLeaderboardModal = ({
  leaderboard,
  leaderboardLoading,
  board,
  setBoard,
  setShowLeaderboardModal,
}: LadderLeaderboardModalProps) => {
  const dialogRef = useModalFocus();
  const [hovered, setHovered] = useState<LadderBoard | null>(null);
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.8)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={() => setShowLeaderboardModal(false)}
    >
      <div
        ref={dialogRef}
        style={{
          background: bgCard,
          padding: '20px',
          borderRadius: '4px',
          width: 'min(440px, calc(100vw - 32px))',
          maxHeight: '80vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ color: textDark, marginBottom: '10px' }}>Leaderboard</h3>
        <div role="tablist" style={{ display: 'flex', borderBottom: `2px solid ${btnGray}`, marginBottom: '10px' }}>
          {BOARDS.map(({ key, label }) => {
            const active = key === board;
            return (
              <button
                key={key}
                role="tab"
                aria-selected={active}
                onClick={() => setBoard(key)}
                onMouseEnter={() => setHovered(key)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  flex: 1,
                  padding: '8px 4px',
                  marginBottom: '-2px',
                  background: active ? bgCardInner : hovered === key ? 'rgba(0,0,0,0.05)' : 'transparent',
                  color: active ? textDark : textLight,
                  border: 'none',
                  borderBottom: `2px solid ${active ? textDark : 'transparent'}`,
                  fontWeight: 700,
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        {leaderboardLoading ? (
          <p style={{ color: textLight }}>Loading...</p>
        ) : leaderboard.length === 0 ? (
          <p style={{ color: textLight }}>Nobody here yet.</p>
        ) : (
          <div>
            {leaderboard.map((player, idx) => {
              const [main, detail] = rowValue(board, player);
              return (
                <div
                  key={player.userId ?? idx}
                  style={{
                    padding: '8px',
                    marginBottom: '6px',
                    background: bgCardInner,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '0.85rem',
                    color: textDark,
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    #{idx + 1} {player.username}
                  </span>
                  <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <strong>{main}</strong> <span style={{ color: textLight, fontSize: '0.75rem' }}>{detail}</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <button
          onClick={() => setShowLeaderboardModal(false)}
          style={{
            width: '100%',
            padding: '8px',
            marginTop: '10px',
            background: '#666',
            color: '#fff',
            border: 'none',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
};

export default LadderLeaderboardModal;
