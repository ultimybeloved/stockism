import { useState } from 'react';
import { COSMETICS, COSMETIC_MAP, COSMETIC_TYPES, COSMETIC_TYPE_LABELS } from '../../../constants/cosmetics';
import { SHOP_PINS } from '../../../crews';
import { pixelatedIfSvg } from '../../../constants/crests';
import PixelIcon from '../../../shared/components/PixelIcon';
import type { AdminCommonProps } from './types';
import type { AdminUser } from '../utils/adminShared';
import type { useAdminCosmetics } from '../hooks/useAdminCosmetics';

const byPrice = <T extends { price: number }>(a: T, b: T) => b.price - a.price;
const PINS = Object.values(SHOP_PINS).sort(byPrice);

interface OwnedChipProps {
  label: string;
  textClass: string;
  mutedClass: string;
  loading: boolean;
  onRemove: () => void;
  swatch: React.ReactNode;
  equipped?: boolean;
}

const OwnedChip = ({ label, textClass, mutedClass, loading, onRemove, swatch, equipped }: OwnedChipProps) => (
  <span className="inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-sm light:bg-slate-100 dark:bg-slate-700">
    {swatch}
    <span className={textClass}>{label}</span>
    {equipped && <span className="text-teal-500 font-semibold">on</span>}
    <button
      aria-label={`Take ${label} away`}
      onClick={onRemove}
      disabled={loading}
      title="Take this away"
      className={`${mutedClass} hover:text-red-500 disabled:opacity-50`}
    >
      <span aria-hidden="true">×</span>
    </button>
  </span>
);

const GiveButton = ({ onClick, disabled }: { onClick: () => void; disabled: boolean }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="px-3 py-1 text-xs font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded disabled:opacity-50"
  >
    <PixelIcon name="gift" set="discord" className="w-3.5 h-3.5 mr-1 align-[-2px]" />
    Give Free
  </button>
);

// Cosmetics and shop pins section of the selected-user card in the admin Users
// tab. Give any of them for free (giveaways) or take one back, no Firebase
// console needed. Both lists run most expensive first.
const UserCosmeticsPanel = ({
  textClass,
  mutedClass,
  inputClass,
  loading,
  selectedUser,
  handleGrantCosmetic,
  handleRevokeCosmetic,
  handleGrantPin,
  handleRevokePin,
}: AdminCommonProps & ReturnType<typeof useAdminCosmetics> & { selectedUser: AdminUser }) => {
  const [pickedCosmetic, setPickedCosmetic] = useState('');
  const [pickedPin, setPickedPin] = useState('');

  const owned = selectedUser.ownedCosmetics || [];
  const ownedPins = selectedUser.ownedShopPins || [];
  const active = selectedUser.activeCosmetics || {};
  const who = selectedUser.displayName || selectedUser.username;
  const selectClass = `flex-1 min-w-0 px-2 py-1 text-sm border rounded ${inputClass}`;

  return (
    <div className="p-3 rounded mb-4 light:bg-white dark:bg-slate-600">
      <h4 className={`text-xs font-semibold uppercase ${mutedClass} mb-2`}>
        <PixelIcon name="palette" className="w-3.5 h-3.5 mr-1 align-[-2px]" />
        Cosmetics ({owned.length} owned)
      </h4>

      <div className="flex gap-2 mb-3">
        <select
          aria-label="Cosmetic to give"
          value={pickedCosmetic}
          onChange={(e) => setPickedCosmetic(e.target.value)}
          className={selectClass}
        >
          <option value="">Pick a cosmetic to give...</option>
          {COSMETIC_TYPES.map((type) => (
            <optgroup key={type} label={COSMETIC_TYPE_LABELS[type]}>
              {COSMETICS.filter((c) => c.type === type)
                .sort(byPrice)
                .map((c) => (
                  <option key={c.id} value={c.id} disabled={owned.includes(c.id)}>
                    {c.name} (${c.price.toLocaleString()}){owned.includes(c.id) ? ', owned' : ''}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <GiveButton
          onClick={() => {
            handleGrantCosmetic(selectedUser.id, who, pickedCosmetic);
            setPickedCosmetic('');
          }}
          disabled={loading || !pickedCosmetic}
        />
      </div>

      {owned.length === 0 ? (
        <p className={`text-xs ${mutedClass}`}>No cosmetics owned.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {owned.map((id) => {
            const c = COSMETIC_MAP[id];
            return (
              <OwnedChip
                key={id}
                label={c?.name || id}
                textClass={textClass}
                mutedClass={mutedClass}
                loading={loading}
                equipped={!!c && active[c.type] === id}
                onRemove={() => handleRevokeCosmetic(selectedUser.id, who, id)}
                swatch={
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: c?.color || '#94A3B8' }}
                  />
                }
              />
            );
          })}
        </div>
      )}

      <h4 className={`text-xs font-semibold uppercase ${mutedClass} mt-4 mb-2`}>
        <PixelIcon name="medal" className="w-3.5 h-3.5 mr-1 align-[-2px]" />
        Shop Pins ({ownedPins.length} owned)
      </h4>
      <div className="flex gap-2 mb-3">
        <select
          aria-label="Pin to give"
          value={pickedPin}
          onChange={(e) => setPickedPin(e.target.value)}
          className={selectClass}
        >
          <option value="">Pick a pin to give...</option>
          {PINS.map((p) => (
            <option key={p.id} value={p.id} disabled={ownedPins.includes(p.id)}>
              {p.name} (${p.price.toLocaleString()}){ownedPins.includes(p.id) ? ', owned' : ''}
            </option>
          ))}
        </select>
        <GiveButton
          onClick={() => {
            handleGrantPin(selectedUser.id, who, pickedPin);
            setPickedPin('');
          }}
          disabled={loading || !pickedPin}
        />
      </div>
      {ownedPins.length === 0 ? (
        <p className={`text-xs ${mutedClass}`}>No shop pins owned.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {ownedPins.map((id) => {
            const pin = SHOP_PINS[id];
            return (
              <OwnedChip
                key={id}
                label={pin?.name || id}
                textClass={textClass}
                mutedClass={mutedClass}
                loading={loading}
                onRemove={() => handleRevokePin(selectedUser.id, who, id)}
                swatch={
                  pin && (
                    <img
                      src={`/pins/${pin.image}`}
                      alt=""
                      className="w-4 h-4 object-contain"
                      style={pixelatedIfSvg(pin.image)}
                    />
                  )
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

export default UserCosmeticsPanel;
