import { useState } from 'react';
import { Link } from 'react-router-dom';
import { themeClasses } from '../../../utils/theme';
import { useSession } from '../../../context/AppContext';
import { formatCurrency } from '../../../utils/formatters';
import {
  RECRUITER_REWARD,
  RECRUIT_BONUS,
  RECRUIT_MIN_CHECKINS,
  RECRUIT_MIN_AGE_DAYS,
  RECRUIT_WEEKLY_CAP,
  inviteLink,
} from '../../../rules/recruiting';

// The player's invite link and how their recruits are doing (rules/recruiting).
const InviteCard = ({ hideBoardLink = false }: { hideBoardLink?: boolean }) => {
  const { userData } = useSession();
  const { textClass, mutedClass, inputClass } = themeClasses;
  const [copied, setCopied] = useState(false);
  if (!userData?.displayName) return null;

  const link = inviteLink(userData.displayName);
  const pending = Math.max(0, userData.recruiting?.pending || 0);
  const paid = userData.recruiting?.paid || 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the link is selectable in the box.
    }
  };

  return (
    <div className="p-4 rounded-sm border light:bg-amber-50 light:border-amber-200 dark:bg-zinc-800/50 dark:border-zinc-700">
      <h3 className={`font-semibold ${textClass} mb-1`}>Recruit players</h3>
      <p className={`text-xs ${mutedClass} mb-3`}>
        Share your link. When someone joins through it, links their Discord, and checks in on {RECRUIT_MIN_CHECKINS}{' '}
        days over at least {RECRUIT_MIN_AGE_DAYS} days, you get {formatCurrency(RECRUITER_REWARD)} and they get{' '}
        {formatCurrency(RECRUIT_BONUS)}. Up to {RECRUIT_WEEKLY_CAP} rewards a week.
      </p>
      <div className="flex gap-2">
        <input
          aria-label="Your invite link"
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
          className={`flex-1 min-w-0 px-3 py-2 border rounded-sm text-xs font-mono ${inputClass}`}
        />
        <button
          onClick={copy}
          className="bg-orange-600 hover:bg-orange-700 text-white font-semibold px-3 rounded-sm text-xs uppercase"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className={`text-xs ${mutedClass} mt-3`}>
        <span className={`font-semibold ${textClass}`}>{paid}</span> rewarded ·{' '}
        <span className={`font-semibold ${textClass}`}>{pending}</span> still earning it
        {!hideBoardLink && (
          <>
            {' · '}
            <Link to="/leaderboard?board=recruiters" className="font-semibold text-orange-500 hover:text-orange-400">
              Top recruiters
            </Link>
          </>
        )}
      </p>
    </div>
  );
};

export default InviteCard;
