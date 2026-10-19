import { useSession } from '../../../context/AppContext';

// How far a player moved on the net-worth board since about a day ago: ▲3, ▼2,
// or NEW for someone who wasn't on it. Nothing when they held their place or
// the server has no day of history yet.
const RankMove = ({ change, className = '' }: { change: number | null | undefined; className?: string }) => {
  const { userData } = useSession();
  if (change === undefined || change === 0) return null;
  const cb = userData?.colorBlindMode;
  if (change === null) {
    return (
      <span className={`text-[10px] font-bold text-amber-500 ${className}`} title="New to the board today">
        NEW
      </span>
    );
  }
  const up = change > 0;
  return (
    <span
      className={`text-[10px] font-bold tabular-nums ${up ? (cb ? 'text-teal-500' : 'text-emerald-500') : cb ? 'text-purple-500' : 'text-red-500'} ${className}`}
      title={`${up ? 'Up' : 'Down'} ${Math.abs(change)} since yesterday`}
    >
      {up ? '▲' : '▼'}
      {Math.abs(change)}
    </span>
  );
};

export default RankMove;
