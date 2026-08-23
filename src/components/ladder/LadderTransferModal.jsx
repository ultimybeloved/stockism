import {
  LADDER_GAME_MAX_BALANCE, LADDER_DEPOSIT_WINDOW_MS,
  LADDER_WITHDRAW_PRINCIPAL_FEE_RATE, LADDER_WITHDRAW_RUSH_RATE,
  LADDER_WITHDRAW_PROFIT_BRACKETS,
} from '../../constants/economy';
import { getTotalInvested } from '../../utils/calculations';
import { calculateLadderWithdrawTax, getLadderDepositFactor, getLadderWithdrawable } from '../../utils/ladderTax';
import { useAppContext } from '../../context/AppContext';
import { bgCard, bgCardInner, textDark, textLight } from './ladderStyles';

// Deposit/withdraw modal, including the invested-based deposit cap and the
// live withdrawal tax preview (mirrors the server math; server is
// authoritative). State and the transfer handlers live in useLadderModals.
const LadderTransferModal = ({
  userLadderData, userStockismCash,
  transferTab, setTransferTab, setShowTransferModal,
  depositAmount, setDepositAmount, withdrawAmount, setWithdrawAmount,
  depositLoading, withdrawLoading, handleDeposit, handleWithdraw,
}) => {
  const { userData } = useAppContext();

  const ladderBalance = userLadderData?.balance || 0;
  // Bonus chips (check-in grants, welcome stake) stay in the game. Only what
  // sits above them can go back to main cash, so the withdraw tab works off
  // this number instead of the raw balance.
  const withdrawable = getLadderWithdrawable(userLadderData);
  const bonusChips = Math.max(0, ladderBalance - withdrawable);
  const totalInvested = getTotalInvested(userData?.holdings, userData?.costBasis, userData?.shorts);
  const noInvestment = totalInvested <= 0;
  // Deposits can't push the balance past the $10k cap or past what you've invested,
  // whichever is lower. capIsInvested tells us which limit is actually binding so the
  // message names the real reason instead of always blaming the invested amount.
  // Accounts under a week old only have part of the cap unlocked, so show them
  // their real ceiling instead of the full $10k the server would reject.
  const rampFactor = getLadderDepositFactor(userData?.createdAt);
  const rampedMax = Math.floor(LADDER_GAME_MAX_BALANCE * rampFactor);
  const isRamping = rampFactor < 1;
  const balanceCap = Math.min(rampedMax, totalInvested);
  const maxDeposit = Math.max(0, balanceCap - ladderBalance);
  const ladderFull = !noInvestment && maxDeposit <= 0;
  const capIsInvested = totalInvested < rampedMax;
  const fmt = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Withdrawal tax preview. Mirrors the server math exactly; the server result is authoritative.
  const withdrawAmt = parseFloat(withdrawAmount);
  const hasRecentDeposit = (userLadderData?.recentDeposits || []).some(d => Date.now() - d.ts < LADDER_DEPOSIT_WINDOW_MS);
  const taxPreview = (!isNaN(withdrawAmt) && withdrawAmt > 0 && withdrawAmt <= withdrawable)
    ? calculateLadderWithdrawTax({
        amount: withdrawAmt,
        totalDeposited: userLadderData?.totalDeposited || 0,
        principalWithdrawn: userLadderData?.principalWithdrawn || 0,
        profitWithdrawn: userLadderData?.profitWithdrawn || 0,
        hasRecentDeposit,
      })
    : null;

  // The withdraw tab shows the tax once the money is already in. A player
  // deciding whether to deposit needs the same numbers BEFORE they commit,
  // otherwise the first time they learn winnings are taxed is on the way out.
  // Built from the rate constants so this text can never drift from the math.
  const pct = (rate) => `${Math.round(rate * 100)}%`;
  const profitBracketText = LADDER_WITHDRAW_PROFIT_BRACKETS
    .map((bracket, i) => {
      const prev = i > 0 ? LADDER_WITHDRAW_PROFIT_BRACKETS[i - 1].upTo : 0;
      if (!isFinite(bracket.upTo)) return `${pct(bracket.rate)} above $${prev.toLocaleString()}`;
      if (i === 0) return `${pct(bracket.rate)} on the first $${bracket.upTo.toLocaleString()}`;
      return `${pct(bracket.rate)} up to $${bracket.upTo.toLocaleString()}`;
    })
    .join(', ');
  const rushWindowHours = Math.round(LADDER_DEPOSIT_WINDOW_MS / (60 * 60 * 1000));

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
              onClick={() => setShowTransferModal(false)}
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
                <h3 style={{ color: textDark, marginBottom: '12px' }}>Transfer</h3>

                {/* Tabs */}
                <div style={{ display: 'flex', marginBottom: '14px', borderBottom: '1px solid #444' }}>
                  {['deposit', 'withdraw'].map(tab => (
                    <button
                      key={tab}
                      onClick={() => {
                        setTransferTab(tab);
                        if (tab === 'withdraw') setWithdrawAmount(String(getLadderWithdrawable(userLadderData)));
                      }}
                      style={{
                        flex: 1,
                        padding: '6px',
                        background: 'none',
                        border: 'none',
                        borderBottom: transferTab === tab ? '2px solid #d4af37' : '2px solid transparent',
                        color: transferTab === tab ? '#d4af37' : textLight,
                        fontWeight: 700,
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                        textTransform: 'uppercase',
                        marginBottom: '-1px'
                      }}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                {transferTab === 'deposit' ? (
                  <>
                    <p style={{ fontSize: '0.85rem', color: textLight, marginBottom: '4px' }}>
                      Available: ${userStockismCash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p style={{ fontSize: '0.8rem', color: (ladderFull || noInvestment) ? '#e57373' : textLight, marginBottom: '10px' }}>
                      {noInvestment
                        ? 'Invest in stocks first. The ladder game is capped at what you have invested.'
                        : ladderFull
                          ? (capIsInvested
                              ? `Your deposits are maxed out at your $${fmt(totalInvested)} invested.`
                              : `Your deposits are maxed out at the $${rampedMax.toLocaleString()} cap.`)
                          : (capIsInvested
                              ? `You can add up to $${fmt(maxDeposit)} more. Deposits are capped at your $${fmt(totalInvested)} invested.`
                              : `You can add up to $${fmt(maxDeposit)} more. Deposits are capped at $${rampedMax.toLocaleString()}.`)}
                    </p>
                    {isRamping && !noInvestment && (
                      <p style={{ fontSize: '0.8rem', color: '#d4af37', marginBottom: '10px' }}>
                        New accounts start with a lower ladder limit. Yours rises every day and reaches
                        the full ${LADDER_GAME_MAX_BALANCE.toLocaleString()} a week after you signed up.
                      </p>
                    )}
                    <div style={{ background: bgCardInner, border: '1px solid #a8792c', padding: '8px 10px', marginBottom: '10px', fontSize: '0.8rem', color: textLight }}>
                      <p style={{ margin: '0 0 4px', fontWeight: 700, color: '#d4af37' }}>Getting money out is taxed</p>
                      <p style={{ margin: '0 0 4px' }}>
                        Your own deposits come back minus a {pct(LADDER_WITHDRAW_PRINCIPAL_FEE_RATE)} fee.
                      </p>
                      <p style={{ margin: '0 0 4px' }}>
                        Winnings are taxed {profitBracketText}. That runs on everything you have ever withdrawn, not per withdrawal.
                      </p>
                      <p style={{ margin: 0 }}>
                        Withdrawing within {rushWindowHours} hours of a deposit costs another {pct(LADDER_WITHDRAW_RUSH_RATE)}.
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(e.target.value)}
                        placeholder="Amount"
                        disabled={ladderFull}
                        max={Math.min(userStockismCash, maxDeposit)}
                        style={{
                          flex: 1,
                          padding: '8px',
                          border: '1px solid #666',
                          background: bgCardInner,
                          color: textDark,
                          opacity: ladderFull ? 0.5 : 1,
                          boxSizing: 'border-box'
                        }}
                      />
                      <button
                        onClick={() => setDepositAmount(String(Math.min(userStockismCash, maxDeposit)))}
                        disabled={ladderFull}
                        style={{
                          padding: '8px 10px',
                          background: '#b4ac99',
                          color: textDark,
                          border: 'none',
                          fontWeight: 700,
                          fontSize: '0.75rem',
                          cursor: ladderFull ? 'not-allowed' : 'pointer',
                          opacity: ladderFull ? 0.5 : 1
                        }}
                      >
                        Max
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button
                        onClick={handleDeposit}
                        disabled={depositLoading || ladderFull || noInvestment || maxDeposit <= 0}
                        style={{
                          flex: 1, padding: '8px', background: '#d4af37', color: '#000',
                          border: 'none', fontWeight: 700,
                          cursor: (depositLoading || ladderFull || noInvestment || maxDeposit <= 0) ? 'not-allowed' : 'pointer',
                          opacity: (ladderFull || noInvestment || maxDeposit <= 0) ? 0.5 : 1
                        }}
                      >
                        {depositLoading ? 'Depositing...' : 'Deposit'}
                      </button>
                      <button
                        onClick={() => setShowTransferModal(false)}
                        style={{ flex: 1, padding: '8px', background: '#666', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p style={{ fontSize: '0.85rem', color: textLight, marginBottom: '4px' }}>
                      Ladder balance: ${fmt(ladderBalance)}
                    </p>
                    {bonusChips > 0 && (
                      <p style={{ fontSize: '0.85rem', color: textDark, marginBottom: '4px' }}>
                        Available to cash out: ${fmt(withdrawable)}
                      </p>
                    )}
                    <p style={{ fontSize: '0.8rem', color: textLight, marginBottom: '10px' }}>
                      {withdrawable > 0
                        ? 'Move some or all of it back to your main cash. Withdrawals are taxed.'
                        : bonusChips > 0
                          ? `$${fmt(bonusChips)} of your balance is bonus chips from check-ins. You can play them, but only what you win with them can be cashed out.`
                          : 'No balance to withdraw.'}
                    </p>
                    {hasRecentDeposit && ladderBalance > 0 && (
                      <p style={{ fontSize: '0.8rem', color: '#e57373', marginBottom: '10px' }}>
                        You deposited in the last 12 hours. A 15% rush fee applies to any withdrawal right now.
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        value={withdrawAmount}
                        onChange={(e) => setWithdrawAmount(e.target.value)}
                        placeholder="Amount"
                        disabled={withdrawable <= 0}
                        max={withdrawable}
                        style={{
                          flex: 1, padding: '8px', border: '1px solid #666',
                          background: bgCardInner, color: textDark,
                          opacity: withdrawable <= 0 ? 0.5 : 1, boxSizing: 'border-box'
                        }}
                      />
                      <button
                        onClick={() => setWithdrawAmount(String(withdrawable))}
                        disabled={withdrawable <= 0}
                        style={{
                          padding: '8px 10px', background: '#b4ac99', color: textDark,
                          border: 'none', fontWeight: 700, fontSize: '0.75rem',
                          cursor: withdrawable <= 0 ? 'not-allowed' : 'pointer',
                          opacity: withdrawable <= 0 ? 0.5 : 1
                        }}
                      >
                        Max
                      </button>
                    </div>
                    {taxPreview && (
                      <div style={{ background: bgCardInner, border: '1px solid #666', padding: '8px 10px', marginBottom: '10px', fontSize: '0.8rem', color: textLight }}>
                        {taxPreview.principalFee > 0 && (
                          <p style={{ margin: '0 0 4px' }}>Fee on your own money back (5%): -${fmt(taxPreview.principalFee)}</p>
                        )}
                        {taxPreview.profitTax > 0 && (
                          <p style={{ margin: '0 0 4px' }}>Tax on winnings: -${fmt(taxPreview.profitTax)}</p>
                        )}
                        {taxPreview.rushSurcharge > 0 && (
                          <p style={{ margin: '0 0 4px' }}>Rush fee (deposited in the last 12 hours, 15%): -${fmt(taxPreview.rushSurcharge)}</p>
                        )}
                        <p style={{ margin: 0, fontWeight: 700, color: textDark }}>You receive ${fmt(taxPreview.netReceived)}</p>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button
                        onClick={handleWithdraw}
                        disabled={withdrawLoading || withdrawable <= 0}
                        style={{
                          flex: 1, padding: '8px', background: '#af905b', color: '#fff',
                          border: 'none', fontWeight: 700,
                          cursor: withdrawLoading || withdrawable <= 0 ? 'not-allowed' : 'pointer',
                          opacity: withdrawable <= 0 ? 0.5 : 1
                        }}
                      >
                        {withdrawLoading ? 'Withdrawing...' : 'Withdraw'}
                      </button>
                      <button
                        onClick={() => setShowTransferModal(false)}
                        style={{ flex: 1, padding: '8px', background: '#666', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
  );
};

export default LadderTransferModal;
