// The top of a profile: the player's cosmetics stretched into a banner, their
// crew crest as the picture, then name, pins, title and crew.
import { Link } from 'react-router-dom';
import { useTheme } from '../../../../context/AppContext';
import { CREW_MAP } from '../../../../crews';
import { crewPinSrc, pixelatedIfSvg } from '../../../../constants/crests';
import { getCosmeticStyles } from '../../../../utils/cosmetics';
import { getReadableCrewColor, themeClasses } from '../../../../utils/theme';
import CosmeticLayers from '../../../../shared/components/cosmetics/CosmeticLayers';
import CosmeticName from '../../../../shared/components/cosmetics/CosmeticName';
import PinDisplay from '../../../../shared/components/PinDisplay';
import TitleText from '../../../../shared/components/TitleText';
import type { PublicProfile } from '../../../../api/types';

const ProfileBanner = ({ profile }: { profile: PublicProfile }) => {
  const { darkMode } = useTheme();
  const crew = profile.crew ? CREW_MAP[profile.crew] : null;
  const crewColor = crew ? getReadableCrewColor(crew.color, darkMode) : undefined;
  const crest = crew ? crewPinSrc(crew) : null;
  const c = getCosmeticStyles(profile.activeCosmetics, null, {
    seedKey: profile.displayName,
    trend: profile.frameTrend,
    style: profile.cosmeticStyle,
  });

  return (
    <div
      className={`relative ${themeClasses.cardClass} border rounded-sm overflow-hidden ${c.rowClass}`}
      data-trend={c.frameTrend}
      style={{ ...c.rowStyle, ...(c.glowColor ? { boxShadow: `0 0 28px ${c.glowColor}55` } : {}) }}
    >
      <CosmeticLayers {...c.layers} seedKey={profile.displayName} />
      <div className="relative flex items-center gap-4 sm:gap-5 px-5 sm:px-6 py-7 sm:py-10">
        {crest && (
          <img
            src={crest}
            alt=""
            className="w-14 h-14 sm:w-20 sm:h-20 object-contain shrink-0"
            style={pixelatedIfSvg(crest)}
          />
        )}
        <div className="min-w-0">
          <h1 className={`text-2xl sm:text-3xl font-bold ${themeClasses.textClass} flex flex-wrap items-center gap-2`}>
            <CosmeticName name={profile.displayName || 'Anonymous Trader'} styles={c} />
            <PinDisplay userData={profile} size="md" />
          </h1>
          <TitleText title={profile.title} className="text-sm mt-0.5" />
          {crew && (
            <Link
              to={`/crew/${crew.id}`}
              className="inline-flex items-center gap-1.5 mt-1 text-sm font-semibold hover:underline"
              style={{ color: crewColor }}
            >
              {crew.name}
              {profile.isCrewHead && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-sm border" style={{ borderColor: crewColor }}>
                  HEAD
                </span>
              )}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProfileBanner;
