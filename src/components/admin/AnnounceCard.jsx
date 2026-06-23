import { useState } from 'react';
import { getThemeClasses } from '../../utils/theme';
import { broadcastNotificationFunction } from '../../firebase';

// Pre-filled with the current margin announcement; fully editable before sending.
const DEFAULT_TITLE = '📈 Margin update';
const DEFAULT_MESSAGE =
  "Margin now uses your whole portfolio, not just spare cash. You can borrow against what you've invested in stocks without selling first. Note: shares bought with margin are locked from selling for 36 hours. Check the margin panel to see your new borrowing power.";

// Admin tool: send a notification to every user's bell.
export default function AnnounceCard({ darkMode }) {
  const { textClass, mutedClass, inputClass } = getThemeClasses(darkMode);
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const send = async () => {
    const t = title.trim();
    const m = message.trim();
    if (!t || !m) return;
    if (!window.confirm(`Send this to EVERY user's notification bell?\n\n${t}\n\n${m}`)) return;
    setSending(true);
    setResult(null);
    try {
      const res = await broadcastNotificationFunction({ title: t, message: m });
      setResult({ ok: true, text: `Sent to ${res.data.sent} users.` });
    } catch (e) {
      setResult({ ok: false, text: e.message || 'Failed to send.' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={`p-4 rounded-sm ${darkMode ? 'bg-slate-800' : 'bg-white'} border ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
      <h3 className={`font-semibold mb-1 ${textClass}`}>📢 Announce to Everyone</h3>
      <p className={`text-xs mb-3 ${mutedClass}`}>Sends a notification to every user&apos;s bell. Edit the text, then send.</p>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={100}
        placeholder="Title"
        className={`w-full mb-2 px-3 py-2 text-sm rounded-sm border ${inputClass}`}
      />
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={1000}
        rows={4}
        placeholder="Message"
        className={`w-full mb-2 px-3 py-2 text-sm rounded-sm border ${inputClass}`}
      />
      <button
        onClick={send}
        disabled={sending || !title.trim() || !message.trim()}
        className="px-4 py-2 text-sm font-semibold rounded-sm bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-50"
      >
        {sending ? 'Sending…' : 'Send to all users'}
      </button>
      {result && (
        <p className={`text-xs mt-2 ${result.ok ? 'text-green-500' : 'text-red-500'}`}>{result.text}</p>
      )}
    </div>
  );
}
