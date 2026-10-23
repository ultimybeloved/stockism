import { useNavigate } from 'react-router-dom';
import { COSMETIC_MAP } from '../../../constants/cosmetics';
import PixelIcon from '../../../shared/components/PixelIcon';
import { useSeenFlag } from '../../../shared/hooks/useSeenFlag';
import { useLiveAuction } from '../hooks/useAuctions';

// Header gavel while an auction is live. The dot shows until the player has
// clicked through to this auction; a new auction brings it back.
const AuctionHeaderButton = () => {
  const navigate = useNavigate();
  const auction = useLiveAuction();
  const [unseen, markSeen] = useSeenFlag(`auction:${auction?.id ?? 'none'}`);
  if (!auction) return null;
  const name = COSMETIC_MAP[auction.itemId]?.name;
  const label = name ? `Live auction: ${name}` : 'Live auction';
  return (
    <button
      onClick={() => {
        markSeen();
        navigate('/auction');
      }}
      className="p-2 rounded-md transition-colors relative light:hover:bg-amber-50 dark:hover:bg-zinc-800"
      aria-label={label}
      title={label}
    >
      <PixelIcon name="gavel" className="w-5 h-5 block" />
      {unseen && (
        <span className="absolute -top-0.5 -right-0.5 bg-orange-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] rounded-full flex items-center justify-center leading-none">
          1
        </span>
      )}
    </button>
  );
};

export default AuctionHeaderButton;
