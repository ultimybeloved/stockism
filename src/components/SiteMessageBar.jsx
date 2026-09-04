import { useState } from 'react';
import { useAppContext } from '../context/AppContext';

// Admin-written announcements, shown site-wide under the price ticker.
//
// The only existing way to tell players anything was broadcastNotification,
// which writes one bell notification per user: guests never see it, it costs a
// write per player, and it is gone once read. This reads one world-readable doc
// instead, so it reaches everybody including signed-out visitors and can be
// edited or taken down at any time.
//
// Renders nothing at all when no message is active, so the layout is unchanged
// in the normal case.
const TONES = {
  info: { dark: 'bg-sky-900/60 text-sky-100', light: 'bg-sky-100 text-sky-900' },
  warn: { dark: 'bg-amber-900/60 text-amber-100', light: 'bg-amber-100 text-amber-900' },
  alert: { dark: 'bg-red-900/60 text-red-100', light: 'bg-red-100 text-red-900' },
};

const SiteMessageBar = () => {
  const { siteMessages, darkMode } = useAppContext();
  const [paused, setPaused] = useState(false);

  const active = (siteMessages || []).filter((m) => m?.active && m?.text?.trim());
  if (!active.length) return null;

  // Tone comes from the most severe message on screen, so one alert is not
  // softened by sitting next to two notices.
  const tone = active.some((m) => m.tone === 'alert') ? 'alert'
    : active.some((m) => m.tone === 'warn') ? 'warn' : 'info';
  const toneClass = TONES[tone][darkMode ? 'dark' : 'light'];

  const body = active.map((m, i) => (
    <span key={m.id || i} className="inline-flex items-center">
      {i > 0 && <span className="mx-4 opacity-40">•</span>}
      {m.link
        ? <a href={m.link} className="underline hover:opacity-80" target="_blank" rel="noopener noreferrer">{m.text}</a>
        : <span>{m.text}</span>}
    </span>
  ));

  // A single short message sits still and centred. Scrolling one line of text
  // back and forth is just harder to read.
  const scrolls = active.length > 1 || active[0].text.length > 90;

  if (!scrolls) {
    return (
      <div className={`w-full text-xs font-medium px-3 py-1.5 text-center ${toneClass}`}>
        {body}
      </div>
    );
  }

  return (
    <div
      className={`site-message-bar w-full overflow-hidden text-xs font-medium py-1.5 ${toneClass}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onClick={() => setPaused((p) => !p)}
    >
      <div
        className="w-max whitespace-nowrap flex site-message-scroll"
        style={{ animationPlayState: paused ? 'paused' : 'running' }}
      >
        {/* Duplicated so the loop has no visible seam, same trick as MarketTicker. */}
        <span className="px-6 flex items-center">{body}</span>
        <span className="px-6 flex items-center" aria-hidden="true">{body}</span>
      </div>
    </div>
  );
};

export default SiteMessageBar;
