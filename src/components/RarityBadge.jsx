import { useAppContext } from '../context/AppContext';
import { RARITY_META, RARITY_LABELED_TIERS } from '../utils/theme';

// Tier name chip shown next to a character's ticker. The card frame styling
// lives in index.css (.rarity-*); this chip names the tier in plain text so
// tier identity never relies on color alone (colorblind safe).
// Only the desirable tiers get a chip (RARITY_LABELED_TIERS) — common and
// uncommon keep just their frame trim so the grid stays quiet.
const RarityBadge = ({ tier }) => {
  const { darkMode } = useAppContext();
  if (!RARITY_LABELED_TIERS.includes(tier)) return null;
  const meta = RARITY_META[tier];
  return (
    <span
      className={`text-[9px] leading-none font-bold uppercase tracking-wider px-1 py-0.5 rounded-sm border ${darkMode ? meta.chipDark : meta.chipLight}`}
      title={`${meta.label} tier. Ranked by market price.`}
    >
      &#9670; {meta.label}
    </span>
  );
};

export default RarityBadge;
