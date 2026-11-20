import { COSMETICS } from '../../../../constants/cosmetics';
import { PIN_COLLECTIONS } from '../../../../crews';
import { GIVEAWAY_MAX_DRAWS, type GiveawayPrize, type GiveawayTier } from '../../../../rules/giveaways';

const SELLABLE = COSMETICS.filter((c) => !c.earned).sort((a, b) => a.name.localeCompare(b.name));
const COLLECTIONS = Object.values(PIN_COLLECTIONS).filter((c) => c.pins.length > 0);

interface Props {
  i: number;
  tier: GiveawayTier;
  count: number;
  field: string;
  mutedClass: string;
  onChange: (t: GiveawayTier) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}

// One prize line in the giveaway form: who gets it (a number of winners or
// everyone), what it is, which draw it's in, and whether the leaderboard's
// top players are left out.
export default function GiveawayTierRow({ i, tier: t, count, field, mutedClass, onChange, onMove, onRemove }: Props) {
  const muted = `text-xs ${mutedClass}`;
  const setKind = (kind: GiveawayPrize['kind']) =>
    onChange({
      ...t,
      prize:
        kind === 'cosmetic'
          ? { kind, cosmeticId: SELLABLE[0]!.id }
          : kind === 'pin'
            ? { kind, collection: COLLECTIONS[0]!.id }
            : { kind, amount: 50000 },
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`${muted} w-5`}>{i + 1}.</span>
      <select
        aria-label="Who gets it"
        className={field}
        value={t.everyone ? 'everyone' : 'drawn'}
        onChange={(e) =>
          onChange(
            e.target.value === 'everyone'
              ? { prize: t.prize, winners: 0, everyone: true }
              : { prize: t.prize, winners: 1 },
          )
        }
      >
        <option value="drawn">Drawn</option>
        <option value="everyone">Everyone who enters</option>
      </select>
      {!t.everyone && (
        <>
          <input
            type="number"
            min={1}
            aria-label="Winners"
            className={`${field} w-20`}
            value={t.winners}
            onChange={(e) => onChange({ ...t, winners: Math.floor(Number(e.target.value)) })}
          />
          <span className={muted}>{t.winners === 1 ? 'winner gets' : 'winners each get'}</span>
        </>
      )}
      <select
        aria-label="Prize type"
        className={field}
        value={t.prize.kind}
        onChange={(e) => setKind(e.target.value as GiveawayPrize['kind'])}
      >
        <option value="credit">Shop credit</option>
        <option value="cash">Cash</option>
        <option value="cosmetic">Cosmetic</option>
        <option value="pin">Random pin</option>
      </select>
      {t.prize.kind === 'cosmetic' ? (
        <select
          aria-label="Cosmetic"
          className={field}
          value={t.prize.cosmeticId}
          onChange={(e) => onChange({ ...t, prize: { kind: 'cosmetic', cosmeticId: e.target.value } })}
        >
          {SELLABLE.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} (${c.price.toLocaleString()})
            </option>
          ))}
        </select>
      ) : t.prize.kind === 'pin' ? (
        <select
          aria-label="Pin collection"
          className={field}
          value={t.prize.collection}
          onChange={(e) => onChange({ ...t, prize: { kind: 'pin', collection: e.target.value } })}
        >
          {COLLECTIONS.map((c) => (
            <option key={c.id} value={c.id}>
              from {c.name}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="number"
          min={1}
          aria-label="Amount"
          className={`${field} w-32`}
          value={t.prize.amount}
          onChange={(e) =>
            onChange({
              ...t,
              prize: { kind: t.prize.kind as 'credit' | 'cash', amount: Math.floor(Number(e.target.value)) },
            })
          }
        />
      )}
      {!t.everyone && (
        <>
          <select
            aria-label="Draw"
            title="Nobody wins twice in the same draw. Put prizes in different draws to let one person win both."
            className={field}
            value={t.draw || 1}
            onChange={(e) => onChange({ ...t, draw: Number(e.target.value) })}
          >
            {Array.from({ length: GIVEAWAY_MAX_DRAWS }, (_, k) => (
              <option key={k} value={k + 1}>
                Draw {k + 1}
              </option>
            ))}
          </select>
          <label className={`${muted} flex items-center gap-1`}>
            skip top
            <input
              type="number"
              min={0}
              max={100}
              aria-label="Skip the leaderboard's top"
              className={`${field} w-16`}
              value={t.skipTop || 0}
              onChange={(e) => onChange({ ...t, skipTop: Math.max(0, Math.floor(Number(e.target.value))) })}
            />
          </label>
        </>
      )}
      <button className={muted} onClick={() => onMove(-1)} aria-label="Move up">
        Up
      </button>
      <button className={muted} onClick={() => onMove(1)} aria-label="Move down">
        Down
      </button>
      {count > 1 && (
        <button className="text-xs text-red-500" onClick={onRemove}>
          Remove
        </button>
      )}
    </div>
  );
}
