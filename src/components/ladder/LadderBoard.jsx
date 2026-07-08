import { bgCard, bgCardInner, bgDark, btnGray, cornerBrown } from './ladderStyles';

// The main game panel: instruction header, the two X start buttons, the
// tracks the animation draws into, ODD/EVEN buttons, and both overlay
// banners. Render-only — all state and handlers come from useLadderGameFlow.
const LadderBoard = ({
  instruction, playing, complete, selectedStart, activeButton, activeResult,
  selectStart, selectBetAndPlay, tracksRef,
  showResultBanner, resultBannerFading, resultText, resultOutcome, resultWin, dismissBanner,
  showInitBanner, initBannerFading, setInitBannerFading, setShowInitBanner,
}) => {
  return (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                background: bgCard,
                border: '5px solid #fff',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column'
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

              {/* Header */}
              <div
                style={{
                  background: bgCard,
                  padding: '7px 20px',
                  textAlign: 'center'
                }}
              >
                <div
                  className="ladder-instruction"
                  style={{
                    fontSize: '27px',
                    color: btnGray,
                    textTransform: 'uppercase',
                    fontWeight: 500,
                    letterSpacing: '-0.01em',
                    height: '35px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {instruction}
                </div>
              </div>

              {/* Inner game area */}
              <div
                style={{
                  background: bgCardInner,
                  padding: '20px 40px',
                  position: 'relative',
                  overflow: 'visible'
                }}
              >
                <div style={{ position: 'relative', width: '220px', margin: '0 auto', overflow: 'visible' }}>
                  {/* Top X buttons */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '7px', position: 'relative', zIndex: 15 }}>
                    <button
                      id="leftXBtn"
                      onClick={() => selectStart('left')}
                      disabled={playing}
                      className={
                        activeButton === 'left'
                          ? (activeResult === 'odd' ? 'ladder-x-active-odd' : 'ladder-x-active-even')
                          : (selectedStart === 'left' ? 'ladder-x-selected' : '')
                      }
                      style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '1.3rem',
                        background: selectedStart === 'left' ? '#a9a18e' : btnGray,
                        border: 'none',
                        color: '#333',
                        cursor: playing ? 'not-allowed' : 'pointer',
                        opacity: playing ? 0.5 : 1,
                        transition: 'all 0.15s ease'
                      }}
                    >
                      X
                    </button>
                    <button
                      id="rightXBtn"
                      onClick={() => selectStart('right')}
                      disabled={playing}
                      className={
                        activeButton === 'right'
                          ? (activeResult === 'odd' ? 'ladder-x-active-odd' : 'ladder-x-active-even')
                          : (selectedStart === 'right' ? 'ladder-x-selected' : '')
                      }
                      style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '1.3rem',
                        background: selectedStart === 'right' ? '#a9a18e' : btnGray,
                        border: 'none',
                        color: '#333',
                        cursor: playing ? 'not-allowed' : 'pointer',
                        opacity: playing ? 0.5 : 1,
                        transition: 'all 0.15s ease'
                      }}
                    >
                      X
                    </button>
                  </div>

                  {/* Tracks */}
                  <div
                    ref={tracksRef}
                    style={{
                      position: 'relative',
                      height: '140px',
                      margin: '0 auto',
                      width: '100%',
                      overflow: 'visible'
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        width: '12px',
                        height: '100%',
                        background: '#b4ac99',
                        top: 0,
                        left: '16px'
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        width: '12px',
                        height: '100%',
                        background: '#b4ac99',
                        top: 0,
                        right: '16px'
                      }}
                    />
                  </div>

                  {/* Bottom ODD/EVEN buttons */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '7px', position: 'relative', zIndex: 15 }}>
                    <button
                      id="oddBtn"
                      onClick={() => selectBetAndPlay('odd')}
                      disabled={!selectedStart || playing || complete}
                      style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        textTransform: 'uppercase',
                        background: btnGray,
                        border: 'none',
                        color: '#333',
                        cursor: (!selectedStart || playing || complete) ? 'not-allowed' : 'pointer',
                        opacity: playing ? 0.5 : 1,
                        transition: 'all 0.15s ease',
                        position: 'relative',
                        zIndex: 10
                      }}
                    >
                      ODD
                    </button>
                    <button
                      id="evenBtn"
                      onClick={() => selectBetAndPlay('even')}
                      disabled={!selectedStart || playing || complete}
                      style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        textTransform: 'uppercase',
                        background: btnGray,
                        border: 'none',
                        color: '#333',
                        cursor: (!selectedStart || playing || complete) ? 'not-allowed' : 'pointer',
                        opacity: playing ? 0.5 : 1,
                        position: 'relative',
                        zIndex: 10,
                        transition: 'all 0.15s ease'
                      }}
                    >
                      EVEN
                    </button>
                  </div>
                </div>

                {/* Result Banner */}
                {showResultBanner && (
                  <div
                    onClick={dismissBanner}
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      background: bgDark,
                      padding: '16px 40px',
                      textAlign: 'center',
                      zIndex: 100,
                      cursor: 'pointer',
                      opacity: resultBannerFading ? 0 : 1,
                      transition: 'opacity 0.3s ease'
                    }}
                  >
                    <div
                      style={{
                        fontSize: '1.2rem',
                        fontWeight: 900,
                        textTransform: 'uppercase',
                        color: '#fff'
                      }}
                    >
                      {resultText}
                    </div>
                    <div
                      style={{
                        fontSize: '0.85rem',
                        color: resultWin ? '#8fbc8f' : '#cd9b9b',
                        marginTop: '4px',
                        fontWeight: 600
                      }}
                    >
                      {resultOutcome}
                    </div>
                  </div>
                )}

                {/* Init Banner */}
                {showInitBanner && (
                  <div
                    className="ladder-init-banner"
                    onClick={() => {
                      setInitBannerFading(true);
                      setTimeout(() => setShowInitBanner(false), 300);
                    }}
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      background: bgDark,
                      padding: '17px 94px',
                      textAlign: 'center',
                      zIndex: 99,
                      cursor: 'pointer',
                      opacity: initBannerFading ? 0 : 1,
                      transition: 'opacity 0.3s ease'
                    }}
                  >
                    <div
                      className="ladder-init-banner-text"
                      style={{
                        fontSize: '28px',
                        fontWeight: 385,
                        color: '#fff',
                        textTransform: 'uppercase',
                        lineHeight: 1.13,
                        letterSpacing: '-0.02em',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      CHOOSE ODDS<br />OR EVENS
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div style={{ height: '18px', background: '#cec6af' }} />
              <div
                className="ladder-footer-text"
                style={{
                  background: '#e6dbc6',
                  height: '30px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '15px',
                  color: '#a69e8c',
                  textTransform: 'uppercase',
                  letterSpacing: '0.02em'
                }}
              >
                Purchase ratio changeable based on draw #
              </div>
            </div>
          </div>
  );
};

export default LadderBoard;
