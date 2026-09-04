// Editor for the site-wide announcement bar (config/siteMessages).
//
// The bar shows every message marked active, joined into one line. Nothing
// active means the bar does not render at all, which is the normal state.

const TONES = [
  { id: 'info', label: 'Notice' },
  { id: 'warn', label: 'Heads up' },
  { id: 'alert', label: 'Urgent' },
];

const SiteMessagesTab = ({
  darkMode, textClass, mutedClass, inputClass,
  siteMessagesList, siteMessagesLoading, siteMessagesLoaded, siteMessagesDirty,
  loadSiteMessages, saveSiteMessages, updateSiteMessage,
  addSiteMessage, removeSiteMessage, moveSiteMessage,
}) => {
  const active = siteMessagesList.filter((m) => m.active && m.text?.trim());
  const card = `p-4 rounded-sm border ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`;
  const rowCard = `p-3 rounded-sm border ${darkMode ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-200'}`;
  const smallBtn = `px-2 py-1 text-xs rounded-sm ${darkMode ? 'bg-slate-700 hover:bg-slate-600 text-slate-100' : 'bg-slate-200 hover:bg-slate-300 text-slate-800'}`;

  return (
    <div className={card}>
      <div className="flex justify-between items-start mb-1">
        <h3 className={`font-semibold ${textClass}`}>📣 Site Messages</h3>
        <button onClick={loadSiteMessages} disabled={siteMessagesLoading} className={smallBtn}>
          {siteMessagesLoading ? 'Working...' : siteMessagesLoaded ? 'Reload' : 'Load'}
        </button>
      </div>
      <p className={`text-xs ${mutedClass} mb-3`}>
        Shown to everyone, including signed-out visitors, in a strip under the
        price ticker. Several active messages scroll together. Nothing active
        means no bar at all. Plain short sentences read best here.
      </p>

      {!siteMessagesLoaded ? (
        <p className={`text-xs ${mutedClass}`}>Load to edit.</p>
      ) : (
        <>
          <div className="space-y-2 mb-3">
            {siteMessagesList.length === 0 && (
              <p className={`text-xs ${mutedClass}`}>No messages yet.</p>
            )}
            {siteMessagesList.map((m, i) => (
              <div key={m.id} className={rowCard}>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text" value={m.text} placeholder="What players need to know"
                    onChange={(e) => updateSiteMessage(m.id, { text: e.target.value })}
                    className={`flex-1 px-2 py-1.5 text-sm rounded-sm border ${inputClass}`}
                  />
                  <label className={`flex items-center gap-1.5 text-xs ${textClass}`}>
                    <input type="checkbox" checked={!!m.active}
                      onChange={(e) => updateSiteMessage(m.id, { active: e.target.checked })} />
                    Live
                  </label>
                </div>
                <div className="flex gap-2 flex-wrap items-center">
                  <input
                    type="text" value={m.link || ''} placeholder="Optional link"
                    onChange={(e) => updateSiteMessage(m.id, { link: e.target.value })}
                    className={`flex-1 min-w-[140px] px-2 py-1 text-xs rounded-sm border ${inputClass}`}
                  />
                  <select value={m.tone || 'info'}
                    onChange={(e) => updateSiteMessage(m.id, { tone: e.target.value })}
                    className={`px-2 py-1 text-xs rounded-sm border ${inputClass}`}>
                    {TONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                  <button onClick={() => moveSiteMessage(m.id, -1)} disabled={i === 0} className={smallBtn}>↑</button>
                  <button onClick={() => moveSiteMessage(m.id, 1)}
                    disabled={i === siteMessagesList.length - 1} className={smallBtn}>↓</button>
                  <button onClick={() => removeSiteMessage(m.id)}
                    className="px-2 py-1 text-xs rounded-sm bg-red-600 hover:bg-red-700 text-white">Delete</button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 mb-3">
            <button onClick={addSiteMessage} className={smallBtn}>+ Add message</button>
            <button onClick={() => saveSiteMessages()} disabled={siteMessagesLoading || !siteMessagesDirty}
              className="px-3 py-1 text-xs font-semibold rounded-sm bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-50">
              {siteMessagesLoading ? 'Saving...' : siteMessagesDirty ? 'Save and publish' : 'Saved'}
            </button>
          </div>

          <p className={`text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Preview</p>
          {active.length === 0 ? (
            <p className={`text-xs ${mutedClass}`}>Nothing active. The bar will not render.</p>
          ) : (
            <div className={`px-3 py-1.5 text-xs font-medium text-center rounded-sm ${
              darkMode ? 'bg-sky-900/60 text-sky-100' : 'bg-sky-100 text-sky-900'
            }`}>
              {active.map((m, i) => (
                <span key={m.id}>{i > 0 && <span className="mx-3 opacity-40">•</span>}{m.text}</span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SiteMessagesTab;
