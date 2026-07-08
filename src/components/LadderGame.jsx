import { useLadderData } from '../hooks/ladder/useLadderData';
import { useLadderGameFlow } from '../hooks/ladder/useLadderGameFlow';
import { useLadderModals } from '../hooks/ladder/useLadderModals';
import LadderBoard from './ladder/LadderBoard';
import LadderSidePanel from './ladder/LadderSidePanel';
import LadderTransferModal from './ladder/LadderTransferModal';
import LadderLeaderboardModal from './ladder/LadderLeaderboardModal';
import LadderStatsModal from './ladder/LadderStatsModal';
import LadderTutorialModal from './LadderTutorialModal';
import { bgMain, LADDER_CSS } from './ladder/ladderStyles';

// Orchestrator only: wires the ladder hooks (src/hooks/ladder/) into the
// board, side panel, and modals (src/components/ladder/). Game, animation,
// and transfer logic all live in the hooks.
const LadderGame = ({ onClose }) => {
  const { userLadderData, globalHistory, userStockismCash } = useLadderData();
  const modals = useLadderModals({ userLadderData, userStockismCash });
  const flow = useLadderGameFlow({
    userLadderData,
    globalHistory,
    setShowLadderTutorial: modals.setShowLadderTutorial,
  });

  const winRate = (userLadderData?.gamesPlayed || 0) > 0
    ? Math.round(((userLadderData?.wins || 0) / userLadderData.gamesPlayed) * 100)
    : 0;

  const containerStyle = onClose ? {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px'
  } : {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px'
  };

  return (
    <div
      style={containerStyle}
      onClick={onClose}
    >
      <div
        style={{
          background: bgMain,
          maxWidth: '690px',
          width: '100%',
          borderRadius: onClose ? '4px' : undefined,
          position: 'relative',
          ...(onClose ? { maxHeight: '90vh', overflowY: 'auto' } : {})
        }}
        onClick={onClose ? (e) => e.stopPropagation() : undefined}
      >
        {/* Close button */}
        {onClose && (
          <button
            onClick={onClose}
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            background: '#ff4444',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            width: '30px',
            height: '30px',
            fontSize: '18px',
            cursor: 'pointer',
            zIndex: 10000,
            fontWeight: 'bold'
          }}
        >
          ×
        </button>
        )}

        <div className="ladder-layout" style={{ display: 'flex', gap: '12px', padding: '15px' }}>
          <LadderBoard {...flow} />
          <LadderSidePanel
            displayBalance={flow.displayBalance}
            userLadderData={userLadderData}
            betAmount={flow.betAmount}
            setBetAmount={flow.setBetAmount}
            setTransferTab={modals.setTransferTab}
            setShowTransferModal={modals.setShowTransferModal}
            setShowLeaderboardModal={modals.setShowLeaderboardModal}
            setShowStatsModal={modals.setShowStatsModal}
            frozenHistory={flow.frozenHistory}
            globalHistory={globalHistory}
          />
        </div>

        {modals.showTransferModal && (
          <LadderTransferModal
            userLadderData={userLadderData}
            userStockismCash={userStockismCash}
            {...modals}
          />
        )}

        {modals.showLeaderboardModal && (
          <LadderLeaderboardModal
            leaderboard={modals.leaderboard}
            leaderboardLoading={modals.leaderboardLoading}
            setShowLeaderboardModal={modals.setShowLeaderboardModal}
          />
        )}

        {modals.showStatsModal && (
          <LadderStatsModal
            userLadderData={userLadderData}
            winRate={winRate}
            setShowStatsModal={modals.setShowStatsModal}
            setShowLadderTutorialReview={modals.setShowLadderTutorialReview}
          />
        )}

        {modals.showLadderTutorial && (
          <LadderTutorialModal
            onClose={() => modals.setShowLadderTutorial(false)}
            onComplete={modals.handleLadderTutorialComplete}
          />
        )}
        {modals.showLadderTutorialReview && (
          <LadderTutorialModal
            onClose={() => modals.setShowLadderTutorialReview(false)}
            onComplete={() => modals.setShowLadderTutorialReview(false)}
            reviewMode
          />
        )}

        <style>{LADDER_CSS}</style>
      </div>
    </div>
  );
};

export default LadderGame;
