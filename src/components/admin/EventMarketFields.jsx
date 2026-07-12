import {
  MS_PER_HOUR, EVENT_OPEN_DELAY_PRESETS_HOURS,
  EVENT_OPENING_ODDS_MIN_PCT, EVENT_OPENING_ODDS_MAX_PCT,
} from '../../constants/economy';

// Event-only create fields for the admin Predictions tab: house liquidity seed,
// opening odds, and the announce-before-open delay. Extracted from PredictionsTab
// to keep that file under the component line limit.
const EventMarketFields = ({
  darkMode,
  mutedClass,
  inputClass,
  seedLiquidity,
  setSeedLiquidity,
  openDelayHours,
  setOpenDelayHours,
  options,
  openingOdds,
  setOpeningOdds,
}) => {
  const delay = Number(openDelayHours) || 0;
  const opensLabel = delay > 0
    ? `Opens: ${new Date(Date.now() + delay * MS_PER_HOUR).toLocaleString()}`
    : 'Opens immediately';

  const presetLabel = (h) => (h === 0 ? 'Off' : `${h}h`);

  // Opening-odds inputs track option slots by index so they stay paired even if
  // a middle option slot is left blank.
  const filled = options.map((o, i) => ({ name: o.trim(), i })).filter((x) => x.name);
  const entered = filled.filter((x) => String(openingOdds[x.i] ?? '').trim() !== '');
  const oddsTotal = entered.reduce((s, x) => s + (Number(openingOdds[x.i]) || 0), 0);
  const oddsOk = entered.length === 0
    || (entered.length === filled.length && Math.abs(oddsTotal - 100) <= 0.01);

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
        <label className={`block text-xs font-semibold uppercase mb-1 ${mutedClass}`}>Opening Odds (%)</label>
        <div className="space-y-2">
          {filled.map(({ name, i }) => (
            <div key={i} className="flex items-center gap-2">
              <span className={`flex-1 text-sm truncate ${mutedClass}`}>{name}</span>
              <input
                type="number"
                min={EVENT_OPENING_ODDS_MIN_PCT}
                max={EVENT_OPENING_ODDS_MAX_PCT}
                value={openingOdds[i]}
                onChange={e => {
                  const next = [...openingOdds];
                  next[i] = e.target.value;
                  setOpeningOdds(next);
                }}
                placeholder={filled.length ? `${Math.round(1000 / filled.length) / 10}` : ''}
                className={`w-24 px-3 py-1.5 border rounded-sm ${inputClass}`}
              />
            </div>
          ))}
        </div>
        <p className={`text-xs mt-1 ${oddsOk ? mutedClass : 'text-red-500 font-semibold'}`}>
          {entered.length === 0
            ? 'Leave blank for even odds. A longshot opened cheap (e.g. 10%) pays up to 10x.'
            : `Total: ${Math.round(oddsTotal * 100) / 100}% — must equal 100% with every option set.`}
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
