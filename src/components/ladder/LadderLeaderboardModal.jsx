import { bgCard, bgCardInner, textDark, textLight } from './ladderStyles';

// Ladder leaderboard modal. Data loading lives in useLadderModals (it fires
// when the modal opens).
const LadderLeaderboardModal = ({ leaderboard, leaderboardLoading, setShowLeaderboardModal }) => {
  return (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.8)',
              zIndex: 10000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            onClick={() => setShowLeaderboardModal(false)}
          >
            <div
              style={{
                background: bgCard,
                padding: '20px',
                borderRadius: '4px',
                minWidth: '400px',
                maxHeight: '80vh',
                overflowY: 'auto'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ color: textDark, marginBottom: '10px' }}>Leaderboard</h3>
              {leaderboardLoading ? (
                <p style={{ color: textLight }}>Loading...</p>
              ) : (
                <div>
                  {leaderboard.map((player, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '8px',
                        marginBottom: '6px',
                        background: bgCardInner,
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.85rem',
                        color: textDark
                      }}
                    >
                      <span>
                        #{idx + 1} {player.username}
                      </span>
                      <span>${player.balance.toLocaleString()} ({player.winRate}%)</span>
                    </div>
                  ))}
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
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
  );
};

export default LadderLeaderboardModal;
