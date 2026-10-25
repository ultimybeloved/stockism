import { useSession } from '../../../context/AppContext';
import { formatShares } from '../../../utils/tradeLimits';
import {
  litFacets,
  markCardProps,
  receiptText,
  resolveHoldingMark,
  type HoldingMark,
  type Position,
} from '../../../utils/holdingMarks';

const SPARKS = [12, 31, 49, 66, 84];

/** The player's own holding mark (see utils/holdingMarks). */
export function useHoldingMark(): HoldingMark {
  const { userData } = useSession();
  return resolveHoldingMark(userData);
}

/** The scene a mark draws inside a card. Render it first, inside a card with `markCardProps`. */
export const HoldingMarkLayer = ({ mark, pos }: { mark: HoldingMark; pos: Position }) => {
  const effect = mark.cosmetic.effectClass;
  return (
    <div
      className="mk-layer"
      aria-hidden="true"
      data-receipt={effect === 'mk-receipt' ? receiptText(pos, formatShares) : undefined}
    >
      {effect === 'mk-ember' &&
        SPARKS.map((left, k) => (
          <i key={left} className="mk-spark" style={{ left: `${left}%`, animationDelay: `${-k * 1.4}s` }} />
        ))}
      {effect === 'mk-diamond' && (
        <div className="mk-facets">
          {[1, 2, 3].map((k) => (
            <i key={k} className={`mk-facet ${k <= litFacets(pos.heldDays) ? 'on' : ''}`} />
          ))}
        </div>
      )}
    </div>
  );
};

/** The position label ("12 long"), dressed by the mark. */
export const HoldingLabel = ({
  mark,
  pos,
  className = '',
}: {
  mark: HoldingMark;
  pos: Position;
  className?: string;
}) => {
  const effect = mark.cosmetic.effectClass;
  const shares = formatShares(pos.shares);
  return (
    <span className={`mk-label ${className}`}>
      {effect === 'mk-bullion' && <i className="mk-bar" aria-hidden="true" />}
      {effect === 'mk-stamp' ? `${pos.kind === 'short' ? 'Short' : 'Held'} ${shares}` : `${shares} ${pos.kind}`}
    </span>
  );
};

/** Just the label, for rows that have no card edge to decorate (the market list). */
export const InlineHoldingLabel = ({
  mark,
  pos,
  className,
}: {
  mark: HoldingMark;
  pos: Position;
  className?: string;
}) => {
  const { className: markClass, style } = markCardProps(mark, pos);
  return (
    <span className={`${markClass.replace(' ring-1', '')} mk-inline`} style={style}>
      <HoldingLabel mark={mark} pos={pos} className={className} />
    </span>
  );
};
