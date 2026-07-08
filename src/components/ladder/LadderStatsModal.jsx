import { bgCard, bgCardInner, textDark, textLight } from './ladderStyles';

// Personal stats modal, plus the "View Guide" entry into the tutorial review.
const LadderStatsModal = ({ userLadderData, winRate, setShowStatsModal, setShowLadderTutorialReview }) => {
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
            onClick={() => setShowStatsModal(false)}
          >
            <div
              style={{
                background: bgCard,
                padding: '20px',
                borderRadius: '4px',
                minWidth: '300px'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ color: textDark, marginBottom: '15px' }}>My Stats</h3>
              <div style={{ background: bgCardInner, padding: '15px', borderRadius: '4px', marginBottom: '15px' }}>
                <div style={{ marginBottom: '10px' }}>
                  <div style={{ fontSize: '0.7rem', color: textLight, textTransform: 'uppercase', marginBottom: '4px' }}>
                    Games Played
                  </div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: textDark }}>
                    {userLadderData?.gamesPlayed || 0}
                  </div>
                </div>
                <div style={{ marginBottom: '10px' }}>
                  <div style={{ fontSize: '0.7rem', color: textLight, textTransform: 'uppercase', marginBottom: '4px' }}>
                    Win Rate
                  </div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: textDark }}>
                    {winRate}%
                  </div>
                </div>
                <div style={{ marginBottom: '10px' }}>
                  <div style={{ fontSize: '0.7rem', color: textLight, textTransform: 'uppercase', marginBottom: '4px' }}>
                    Current Streak
                  </div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: textDark }}>
                    {userLadderData?.currentStreak || 0}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', color: textLight, textTransform: 'uppercase', marginBottom: '4px' }}>
                    Best Streak
                  </div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: textDark }}>
                    {userLadderData?.bestStreak || 0}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => { setShowStatsModal(false); setShowLadderTutorialReview(true); }}
                  style={{ flex: 1, padding: '8px', background: '#8a7d6b', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer' }}
                >
                  View Guide
                </button>
                <button
                  onClick={() => setShowStatsModal(false)}
                  style={{ flex: 1, padding: '8px', background: '#666', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer' }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
  );
};

export default LadderStatsModal;
