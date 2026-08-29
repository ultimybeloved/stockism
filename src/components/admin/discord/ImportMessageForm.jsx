import { useState } from 'react';

// Adopt a message the bot already posted some other way — the rules script, or
// an older one-off — so it becomes editable from here.
//
// Only the bot's own messages can be imported. Discord refuses to let a bot edit
// anyone else's message, so importing one would just create a row that fails on
// every save.
export default function ImportMessageForm({ darkMode, textClass, mutedClass, inputClass, busy, onImport }) {
  const [open, setOpen] = useState(false);
  const [channelId, setChannelId] = useState('');
  const [messageId, setMessageId] = useState('');
  const [label, setLabel] = useState('');

  const field = `w-full px-3 py-2 text-sm rounded-sm border ${inputClass}`;

  const submit = async () => {
    const ok = await onImport({ channelId: channelId.trim(), messageId: messageId.trim(), label: label.trim() });
    if (ok) {
      setChannelId('');
      setMessageId('');
      setLabel('');
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs underline text-teal-500">
        + Import a message the bot already sent
      </button>
    );
  }

  return (
    <div className={`p-3 rounded-sm border ${darkMode ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-white'}`}>
      <h4 className={`text-sm font-semibold mb-1 ${textClass}`}>Import an existing bot message</h4>
      <p className={`text-xs mb-3 ${mutedClass}`}>
        In Discord: turn on Developer Mode, right-click the message, Copy Message Link, and paste the
        last two numbers from it below. It must be a message the bot posted.
      </p>
      <div className="grid sm:grid-cols-3 gap-2 mb-2">
        <input value={channelId} onChange={(e) => setChannelId(e.target.value.trim())} placeholder="Channel ID" className={field} />
        <input value={messageId} onChange={(e) => setMessageId(e.target.value.trim())} placeholder="Message ID" className={field} />
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name it, e.g. Server rules" className={field} />
      </div>
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={busy || !channelId || !messageId}
          className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50"
        >
          {busy ? 'Importing…' : 'Import'}
        </button>
        <button onClick={() => setOpen(false)} className={`px-3 py-1.5 text-xs rounded-sm ${darkMode ? 'bg-slate-700' : 'bg-slate-200'} ${mutedClass}`}>
          Cancel
        </button>
      </div>
    </div>
  );
}
