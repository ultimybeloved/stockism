import { themeClasses } from '../../../../utils/theme';
import { pixelatedIfSvg } from '../../../../constants/crests';
import { shortPrice } from '../../utils/shopCatalog';
import type { ShopPin } from '../../../../crews';

interface ShopPinGridProps {
  pins: ShopPin[];
  selectedId: string | null;
  owned: Set<string>;
  onPick: (pin: ShopPin) => void;
  /**
   * A heading for the grid when the shelf has more than one collection. A
   * limited one sits in its own box with the moment it leaves the shop; the
   * regular ones say they stay.
   */
  section?: { name: string; limited: boolean; endsAt: number | null };
}

// "Sun, Nov 29, 23:59 UTC"
const endLabel = (ms: number) =>
  new Date(ms).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  }) + ' UTC';

// Pins for sale, one grid, most expensive first. The Black Card keeps a gold
// edge. Tapping one tries it on the preview row.
const ShopPinGrid = ({ pins, selectedId, owned, onPick, section }: ShopPinGridProps) => {
  const { textClass, mutedClass } = themeClasses;
  const grid = (
    <div className="grid grid-cols-3 gap-2.5">
      {pins.map((pin) => {
        const selected = pin.id === selectedId;
        const gold = pin.id === 'black_card';
        return (
          <button
            key={pin.id}
            type="button"
            onClick={() => onPick(pin)}
            aria-pressed={selected}
            className={`flex flex-col items-center gap-1 rounded-md border px-1.5 py-3 text-xs transition-colors light:bg-white dark:bg-zinc-900/40 ${
              selected
                ? 'border-orange-500 ring-1 ring-orange-500'
                : gold
                  ? 'border-amber-500/80 shadow-[0_0_14px_-4px_#f59e0b88]'
                  : 'light:border-amber-200 dark:border-zinc-800 light:hover:border-amber-400 dark:hover:border-zinc-600'
            }`}
          >
            <img
              src={`/pins/${pin.image}`}
              alt=""
              className="w-10 h-10 object-contain"
              style={pixelatedIfSvg(pin.image)}
            />
            <b className={`text-center leading-tight ${textClass}`}>{pin.name}</b>
            {owned.has(pin.id) ? (
              <span className="text-xs font-bold text-orange-500">Owned</span>
            ) : (
              <span className="text-[13px] font-bold text-amber-500">{shortPrice(pin.price)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
  if (!section) return grid;
  if (!section.limited)
    return (
      <section>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
          <h3 className={`text-sm font-bold ${textClass}`}>{section.name}</h3>
          <span className={`text-xs ${mutedClass}`}>Always in the shop</span>
        </div>
        {grid}
      </section>
    );
  return (
    <section className="rounded-lg border-2 border-orange-400/70 p-3 light:bg-orange-50 dark:bg-orange-500/10">
      <div className="mb-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={`text-sm font-bold ${textClass}`}>{section.name}</h3>
          <span className="rounded-sm bg-orange-500 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
            Limited time
          </span>
        </div>
        {section.endsAt != null && (
          <p className={`mt-1 text-xs ${mutedClass}`}>
            Only these pins leave the shop on <b className="text-orange-500">{endLabel(section.endsAt)}</b>. Owners keep
            theirs.
          </p>
        )}
      </div>
      {grid}
    </section>
  );
};

export default ShopPinGrid;
