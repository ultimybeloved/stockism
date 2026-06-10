import React from 'react';

// Read-only alt-ring report. Pulls recent signups (joined to their Firebase Auth
// email + signup IP server-side) and shows them grouped by shared signup IP,
// email domain, and normalized gmail identity, so a VPN + temp-mail burst stands
// out as clusters. Ban / watch actions reuse the existing admin callables.
const RecentSignups = ({
  darkMode,
  textClass,
  mutedClass,
  inputClass,
  loading,
  signupReport,
  signupHours,
  setSignupHours,
  loadRecentSignups,
  onBan,
  onWatch,
}) => {
  const fmtAge = (ms) => {
    if (!ms) return '';
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  };

  const rowBg = darkMode ? 'bg-slate-800' : 'bg-white';
  const clusterBg = darkMode ? 'bg-slate-900/60' : 'bg-red-50';

  const MemberRow = ({ m }) => (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs p-1.5 rounded ${rowBg} ${mutedClass}`}>
      <span className={`font-semibold ${textClass}`}>{m.displayName}</span>
      {m.isBanned && <span className="px-1 rounded text-[10px] bg-red-500/20 text-red-400">banned</span>}
      {m.requiresDiscordLink && !m.hasDiscord && (
        <span className="px-1 rounded text-[10px] bg-yellow-500/20 text-yellow-400">discord-walled</span>
      )}
      {m.email && <span className="font-mono text-[10px]">{m.email}</span>}
      {m.signupIp && <span className="font-mono text-[10px]">{m.signupIp}</span>}
      <span className="opacity-60">{fmtAge(m.createdAt)}</span>
      <span className="ml-auto flex gap-2">
        {!m.isBanned && (
          <button onClick={() => onBan(m.uid, m.displayName)} className="text-red-500 hover:text-red-400 font-semibold">
            Ban
          </button>
        )}
        <button onClick={() => onWatch(m.uid, m.displayName)} className="text-orange-400 hover:text-orange-300 font-semibold">
          Watch
        </button>
      </span>
    </div>
  );

  const ClusterGroup = ({ title, label, clusters }) => (
    <div className="mb-3">
      <div className={`text-xs font-bold mb-1 ${textClass}`}>{title}</div>
      {(!clusters || clusters.length === 0) ? (
        <div className={`text-xs ${mutedClass}`}>No clusters of 2+ in this window.</div>
      ) : (
        <div className="space-y-2">
          {clusters.map((c) => (
            <div key={c.key} className={`p-2 rounded-sm ${clusterBg}`}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-mono ${textClass}`}>
                  {c.key} <span className="text-red-400 font-bold">({c.count} accounts)</span>
                </span>
                <span className={`text-[10px] ${mutedClass}`}>{label}</span>
              </div>
              <div className="space-y-1">
                {c.members.map((m) => <MemberRow key={m.uid} m={m} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-orange-50'}`}>
      <h3 className={`text-sm font-bold mb-1 ${textClass}`}>Recent Signups / Alt Ring</h3>
      <p className={`text-xs mb-2 ${mutedClass}`}>
        Groups recent signups by shared signup IP, email domain, and gmail identity (dot/+ aliases
        collapse to one account). A VPN + temp-mail ring shows up as clusters here. Read-only.
      </p>

      <div className="flex gap-2 items-center mb-3">
        <label className={`text-xs ${mutedClass}`}>Window:</label>
        <select
          value={signupHours}
          onChange={(e) => setSignupHours(Number(e.target.value))}
          className={`px-2 py-1.5 text-xs border rounded-sm ${inputClass}`}
        >
          <option value={24}>24 hours</option>
          <option value={48}>48 hours</option>
          <option value={72}>72 hours</option>
          <option value={168}>7 days</option>
        </select>
        <button
          onClick={loadRecentSignups}
          disabled={loading}
          className="ml-auto px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold rounded-sm disabled:opacity-50"
        >
          {loading ? 'Pulling...' : 'Pull report'}
        </button>
      </div>

      {signupReport && (
        <>
          <div className={`text-xs mb-3 ${mutedClass}`}>
            {signupReport.totalSignups} signups in the last {signupReport.windowHours}h ·{' '}
            {signupReport.clustersByIp.length} IP, {signupReport.clustersByDomain.length} domain,{' '}
            {signupReport.clustersByGmail.length} gmail cluster(s)
          </div>
          <ClusterGroup title="Shared signup IP" label="same exit IP (VPN reuse)" clusters={signupReport.clustersByIp} />
          <ClusterGroup title="Shared email domain" label="same provider (temp-mail)" clusters={signupReport.clustersByDomain} />
          <ClusterGroup title="Same gmail identity" label="dot/+ aliases of one inbox" clusters={signupReport.clustersByGmail} />
          {signupReport.clustersByIp.length === 0 &&
            signupReport.clustersByDomain.length === 0 &&
            signupReport.clustersByGmail.length === 0 && (
              <div className={`text-xs ${mutedClass}`}>
                No clusters found. The ring may be rotating both IPs and email providers — widen the window or check timing.
              </div>
            )}
        </>
      )}
    </div>
  );
};

export default RecentSignups;
