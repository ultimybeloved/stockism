import { bgCard, bgCardInner, textDark, cornerBrown } from './ladderStyles';

// Side panel: balance/bet inputs, the Transfer/Leaderboard/My Stats buttons,
// and the recent global result history. Render-only.
const LadderSidePanel = ({
  displayBalance, userLadderData, betAmount, setBetAmount,
  setTransferTab, setShowTransferModal, setShowLeaderboardModal, setShowStatsModal,
  frozenHistory, globalHistory,
}) => {
  return (
          <div className="ladder-side-panel" style={{ width: '182px', display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                background: bgCard,
                border: '5px solid #fff',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                flex: 1
              }}
            >
              {/* Corner accents */}
              <div
                style={{
                  position: 'absolute',
                  top: '-5px',
                  left: '-5px',
                  width: 'calc(100% + 10px)',
                  height: 'calc(100% + 10px)',
                  pointerEvents: 'none',
                  background: `
                    linear-gradient(135deg, ${cornerBrown} 20px, transparent 20px) top left,
                    linear-gradient(225deg, ${cornerBrown} 20px, transparent 20px) top right,
                    linear-gradient(45deg, ${cornerBrown} 20px, transparent 20px) bottom left,
                    linear-gradient(315deg, ${cornerBrown} 20px, transparent 20px) bottom right
                  `,
                  backgroundSize: '50% 50%',
                  backgroundRepeat: 'no-repeat',
                  clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, 5px 5px, 5px calc(100% - 5px), calc(100% - 5px) calc(100% - 5px), calc(100% - 5px) 5px, 5px 5px)'
                }}
              />

              <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                {/* Header */}
                <div
                  style={{
                    background: '#af905b',
                    padding: '8px 10px',
                    display: 'flex',
                    justifyContent: 'space-around',
                    margin: '8px 8px 0 8px'
                  }}
                >
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#fff', textTransform: 'uppercase' }}>
                    Total
                  </span>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#fff', textTransform: 'uppercase' }}>
                    Bet
                  </span>
                </div>

                {/* Balance & Bet */}
                <div style={{ display: 'flex', padding: '10px 8px', gap: '6px', justifyContent: 'center' }}>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 700, color: textDark }}>
                      ${Math.floor(displayBalance ?? userLadderData?.balance ?? 500).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={betAmount}
                      onChange={(e) => setBetAmount(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '4px 2px',
                        border: '1px solid #a99f8f',
                        fontSize: '0.9rem',
                        fontWeight: 700,
                        background: bgCardInner,
                        color: textDark,
                        textAlign: 'center'
                      }}
                    />
                  </div>
                </div>

                {/* Buttons */}
                <div style={{ padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <button
                    onClick={() => { setTransferTab('deposit'); setShowTransferModal(true); }}
                    style={{
                      padding: '6px',
                      background: '#af905b',
                      color: '#fff',
                      border: 'none',
                      fontWeight: 700,
                      fontSize: '0.7rem',
                      cursor: 'pointer',
                      textTransform: 'uppercase'
                    }}
                  >
                    Transfer
                  </button>
                  <button
                    onClick={() => setShowLeaderboardModal(true)}
                    style={{
                      padding: '6px',
                      background: '#af905b',
                      color: '#fff',
                      border: 'none',
                      fontWeight: 700,
                      fontSize: '0.7rem',
                      cursor: 'pointer',
                      textTransform: 'uppercase'
                    }}
                  >
                    Leaderboard
                  </button>
                  <button
                    onClick={() => setShowStatsModal(true)}
                    style={{
                      padding: '6px',
                      background: '#af905b',
                      color: '#fff',
                      border: 'none',
                      fontWeight: 700,
                      fontSize: '0.7rem',
                      cursor: 'pointer',
                      textTransform: 'uppercase'
                    }}
                  >
                    My Stats
                  </button>
                </div>

                {/* History */}
                <div style={{ padding: '8px 10px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
                    {(frozenHistory || globalHistory.slice(0, 5)).map((game, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div
                          style={{
                            flex: 0.7,
                            height: '5px',
                            display: 'flex',
                            borderRadius: '1px',
                            overflow: 'hidden'
                          }}
                        >
                          <div
                            style={{
                              background: '#2286f6',
                              width: `${game.oddPct || 50}%`,
                              transition: 'width 0.3s ease'
                            }}
                          />
                          <div
                            style={{
                              background: '#f22431',
                              width: `${game.evenPct || 50}%`,
                              transition: 'width 0.3s ease'
                            }}
                          />
                        </div>
                        <div
                          style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '50%',
                            background: game.result === 'odd' ? '#2286f6' : '#f22431',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '12px',
                            fontWeight: 700,
                            color: '#fff',
                            flexShrink: 0
                          }}
                        >
                          {game.result === 'odd' ? 'O' : 'E'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
  );
};

export default LadderSidePanel;
