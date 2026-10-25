import { memo, useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useSession } from '../../../context/AppContext';
import { getPublicProfileFunction } from '../../../api/callables';
import type { PublicProfile } from '../../../api/types';
import ProfileAdminPanel from '../components/ProfileAdminPanel';
import ProfileBanner from '../components/public/ProfileBanner';
import ProfileFacts from '../components/public/ProfileFacts';
import TrophyCase from '../components/public/TrophyCase';
import TrophyPicker from '../components/public/TrophyPicker';
import ProfileTrading, { PrivateNote } from '../components/public/ProfileTrading';
import AchievementShelf from '../components/public/AchievementShelf';
import PixelIcon from '../../../shared/components/PixelIcon';
import ProfileBackground from '../../../shared/components/cosmetics/ProfileBackground';
import { themeClasses } from '../../../utils/theme';
import { ADMIN_UIDS } from '../../../constants/economy';

// /u/:username. Every profile opens: banner, facts, trophy case and
// achievements for anyone; trading only when the profile is public.
const PublicProfilePage = () => {
  const { username } = useParams();
  const { user, userData } = useSession();
  const viewerIsAdmin = user && ADMIN_UIDS.includes(user.uid);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    // The page stays mounted when following a link to another profile, so start
    // clean and ignore an answer that arrives for the previous name.
    let cancelled = false;
    setProfile(null);
    setNotFound(false);
    setLoading(true);
    getPublicProfileFunction({ username })
      .then((result) => !cancelled && setProfile(result.data))
      .catch(() => !cancelled && setNotFound(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [username]);

  const { cardClass, textClass, mutedClass } = themeClasses;

  if (loading || notFound || !profile) {
    return (
      <div className="max-w-3xl mx-auto p-4">
        <div className={`${cardClass} border rounded-sm p-8 text-center`}>
          {loading ? (
            <p className={mutedClass}>Loading...</p>
          ) : (
            <>
              <PixelIcon name="profile" className="w-8 h-8 mx-auto mb-2" />
              <p className={`font-semibold ${textClass}`}>Profile not found</p>
              <p className={`text-sm ${mutedClass} mt-1`}>No trader found with username "{username}".</p>
            </>
          )}
        </div>
      </div>
    );
  }

  const isOwner = !!userData?.displayName && userData.displayName.toLowerCase() === profile.displayName.toLowerCase();

  // A profile background fills the window either side of the column on a
  // desktop; the column gets the page's own color so the art stays beside it.
  const bgId = profile.activeCosmetics?.profileBg;
  return (
    <>
      {bgId && (
        <div className="hidden lg:block">
          <ProfileBackground
            id={bgId}
            seedKey={profile.displayName}
            style={profile.cosmeticStyle}
            data={profile.profileBgData}
          />
        </div>
      )}
      <div
        className={`max-w-3xl mx-auto p-4 space-y-4 ${
          bgId
            ? 'relative z-[1] lg:min-h-screen lg:border-x light:bg-amber-50 dark:bg-zinc-950 light:border-amber-200 dark:border-zinc-800'
            : ''
        }`}
      >
        <ProfileBanner profile={profile} />
        <ProfileFacts profile={profile} />
        <TrophyCase profile={profile} isOwner={isOwner} onEdit={() => setPicking(true)} />
        {profile.isPublic === false ? <PrivateNote /> : <ProfileTrading profile={profile} />}
        <AchievementShelf owned={profile.achievements || []} />
        {viewerIsAdmin && profile.adminData && <ProfileAdminPanel data={profile.adminData} />}
        {picking && (
          <TrophyPicker
            current={profile.trophyCase || []}
            onClose={() => setPicking(false)}
            onSaved={(trophyCase) =>
              // Title labels come from the owner's own doc, for titles new to the case.
              setProfile((p) =>
                p
                  ? {
                      ...p,
                      trophyCase,
                      trophyTitles: { ...p.trophyTitles, ...(userData?.titleMeta as Record<string, string>) },
                    }
                  : p,
              )
            }
          />
        )}
      </div>
    </>
  );
};

export default memo(PublicProfilePage);
