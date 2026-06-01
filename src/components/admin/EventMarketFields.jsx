import React from 'react';
import { MS_PER_HOUR, EVENT_OPEN_DELAY_PRESETS_HOURS } from '../../constants/economy';

// Event-only create fields for the admin Predictions tab: house liquidity seed and
// the announce-before-open delay. Extracted from PredictionsTab to keep that file
// under the component line limit.
const EventMarketFields = ({
  darkMode,
  mutedClass,
  inputClass,
  seedLiquidity,
  setSeedLiquidity,
  openDelayHours,
  setOpenDelayHours,
}) => {
  const delay = Number(openDelayHours) || 0;
  const opensLabel = delay > 0
    ? `Opens: ${new Date(Date.now() + delay * MS_PER_HOUR).toLocaleString()}`
    : 'Opens immediately';

  const presetLabel = (h) => (h === 0 ? 'Off' : `${h}h`);

  return (
    <>
      <div>
        <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>House Liquidity (seed)</label>
        <input
          type="number"
          min="100"
          value={seedLiquidity}
          onChange={e => setSeedLiquidity(e.target.value === '' ? '' : parseInt(e.target.value))}
          className={`w-full px-3 py-2 border rounded-sm ${inputClass}`}
        />
        <p className={`text-xs ${mutedClass} mt-1`}>
          Higher = steadier prices. No end date; resolve it when canon confirms the outcome.
        </p>
      </div>

      <div>
        <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Announce Before Open</label>
        <div className="flex gap-2">
          {EVENT_OPEN_DELAY_PRESETS_HOURS.map(h => (
            <button
              key={h}
              type="button"
              onClick={() => setOpenDelayHours(h)}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-sm border-2 transition-all ${
                delay === h
                  ? 'border-teal-500 bg-teal-500 text-white'
                  : darkMode ? 'border-slate-600 text-slate-300' : 'border-slate-300 text-slate-600'
              }`}
            >
              {presetLabel(h)}
            </button>
          ))}
        </div>
        <input
          type="number"
          min="0"
          step="0.25"
          value={openDelayHours}
          onChange={e => setOpenDelayHours(e.target.value === '' ? 0 : Math.max(0, parseFloat(e.target.value) || 0))}
          placeholder="Custom hours..."
          className={`w-full mt-2 px-3 py-2 border rounded-sm ${inputClass}`}
        />
        <p className={`text-xs ${mutedClass} mt-1`}>
          Players see the market with a countdown but can't bet until it opens. {opensLabel}
        </p>
      </div>
    </>
  );
};

export default EventMarketFields;
