// How each kind of trophy looks on its stand: achievements and pins as big
// pixel art, titles in their tier style, and shop cosmetics actually running.
// A name shows in its effect; an effect, backdrop or frame is worn by the
// whole stand (`wear`), the way a row wears it on the leaderboard. The picker's
// small list shows those three as a little row instead (`compact`).
import type { CSSProperties, ReactNode } from 'react';
import { ACHIEVEMENT_MAP } from '../../../../constants/achievements';
import { COSMETIC_MAP, COSMETIC_TYPE_LABELS } from '../../../../constants/cosmetics';
import { CREW_MAP, SHOP_PINS } from '../../../../crews';
import { CREW_HEAD_PIN, PIXELATED, pixelatedIfSvg } from '../../../../constants/crests';
import { getCosmeticStyles } from '../../../../utils/cosmetics';
import { parseTrophy, type CrewHeadBest } from '../../../../rules/trophies';
import AchievementIcon from '../../../../shared/components/AchievementIcon';
import CosmeticLayers from '../../../../shared/components/cosmetics/CosmeticLayers';
import CosmeticName from '../../../../shared/components/cosmetics/CosmeticName';
import TitleText from '../../../../shared/components/TitleText';
import { themeClasses } from '../../../../utils/theme';

export type SpotlightKind = 'holo' | 'champ' | 'alpha';

/** Achievements and pins with their own spotlight set. */
const SPECIAL_ACH: Record<string, SpotlightKind> = { TOP_1: 'champ' };
const SPECIAL_PIN: Record<string, SpotlightKind> = { alpha_tester: 'alpha' };

// The pin's art with a foil sheen across it, masked to the pin's own shape.
const SheenPin = ({ src, gold = false, children }: { src: string; gold?: boolean; children: ReactNode }) => (
  <span className={`trophy-holo-pin ${gold ? 'gold' : ''}`} style={{ '--pin': `url("${src}")` } as CSSProperties}>
    {children}
  </span>
);

export interface TrophyView {
  name: string;
  caption: string;
  art: ReactNode;
  /** A cosmetic the whole stand wears (effects, backdrops, frames). */
  wear?: string;
  /**
   * Pins on display get spotlights from the stand's bottom corners. A few get
   * their own set: holographic for the Crew Head, gold and grand for Champion,
   * a gold glow with sparks for Alpha Tester.
   */
  spotlight?: true | SpotlightKind;
}

interface Context {
  /** The owner's name: seeds per-player cosmetic details (Terminal, Banknote). */
  seedKey: string;
  /** Small art for the picker's list: names and titles as "Aa" in their style. */
  compact?: boolean;
  titles: Record<string, string>;
  headReign: CrewHeadBest | null;
}

// A small row wearing one cosmetic, the way it looks on the leaderboard.
const MiniRow = ({ id, seedKey }: { id: string; seedKey: string }) => {
  const c = COSMETIC_MAP[id]!;
  const s = getCosmeticStyles({ [c.type]: id }, null, { seedKey });
  return (
    <div
      className={`relative w-full h-11 rounded-sm border overflow-hidden flex items-center px-3 ${themeClasses.cardClass} ${s.rowClass}`}
      data-trend={s.frameTrend}
      style={{ ...s.rowStyle, ...(s.glowColor ? { boxShadow: `0 0 16px ${s.glowColor}55` } : {}) }}
    >
      <CosmeticLayers {...s.layers} seedKey={seedKey} />
      <span className={`relative text-xs font-semibold truncate ${themeClasses.textClass}`}>{seedKey}</span>
    </div>
  );
};

/** The view of one trophy id, or null if it no longer means anything. */
export function trophyView(id: string, ctx: Context): TrophyView | null {
  const t = parseTrophy(id);
  if (!t) return null;
  switch (t.kind) {
    case 'ach': {
      const a = ACHIEVEMENT_MAP[t.ref];
      return a
        ? {
            name: a.name,
            caption: a.description,
            art:
              SPECIAL_ACH[a.id] === 'champ' && a.icon ? (
                <SheenPin src={`/pins/${a.icon}`} gold>
                  <AchievementIcon achievement={a} className="block w-12 h-12" />
                </SheenPin>
              ) : (
                <AchievementIcon achievement={a} className="w-12 h-12" />
              ),
            spotlight: SPECIAL_ACH[a.id] || true,
          }
        : null;
    }
    case 'pin': {
      const p = SHOP_PINS[t.ref];
      return p
        ? {
            name: p.name,
            caption: 'Pin',
            spotlight: SPECIAL_PIN[p.id] || true,
            art: (
              <span className={SPECIAL_PIN[p.id] === 'alpha' ? 'trophy-gold-pin' : undefined}>
                <img src={`/pins/${p.image}`} alt="" className="w-12 h-12 object-contain" style={pixelatedIfSvg(p.image)} />
              </span>
            ),
          }
        : null;
    }
    case 'title': {
      const text = ctx.titles[t.ref] || t.ref;
      const shown = ctx.compact ? 'Aa' : text;
      return {
        name: text,
        caption: 'Season title',
        art: <TitleText title={{ id: t.ref, text: shown }} className="text-[11px] sm:text-sm px-1" wrap={!ctx.compact} />,
      };
    }
    case 'cos': {
      const c = COSMETIC_MAP[t.ref];
      if (!c) return null;
      const caption = c.earned ? 'Season reward' : COSMETIC_TYPE_LABELS[c.type];
      const art =
        c.type === 'nameColor' ? (
          <CosmeticName
            name={ctx.compact ? 'Aa' : c.name}
            styles={getCosmeticStyles({ nameColor: c.id }, null, { seedKey: ctx.seedKey })}
            className="text-lg font-bold"
          />
        ) : ctx.compact ? (
          <MiniRow id={c.id} seedKey={ctx.seedKey} />
        ) : null;
      return { name: c.name, caption, art, wear: c.type === 'nameColor' || ctx.compact ? undefined : c.id };
    }
    case 'head': {
      const r = ctx.headReign;
      if (!r) return null;
      const crew = r.crew ? CREW_MAP[r.crew] : null;
      const weeks = `${r.weeks} ${r.weeks === 1 ? 'week' : 'weeks'}`;
      return {
        name: 'Crew Head',
        caption: crew ? `${crew.name} · ${weeks}` : weeks,
        art: (
          <SheenPin src={CREW_HEAD_PIN}>
            <img src={CREW_HEAD_PIN} alt="" className="block w-12 h-12" style={PIXELATED} />
          </SheenPin>
        ),
        spotlight: 'holo',
      };
    }
  }
}
