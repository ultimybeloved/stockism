import { CREW_MAP } from '../../../../crews';
import { themeClasses } from '../../../../utils/theme';
import { useSession } from '../../../../context/AppContext';
import type { PinAction } from '../../hooks/usePinShop';
import CrewPin from '../../../../shared/components/CrewPin';
import { crewPinSrc } from '../../../../constants/crests';
import { flairCrewsOf, flairOf } from '../../../../rules/flairCrews';

interface CrewPinSectionProps {
  onPinAction: (action: PinAction, payload: unknown, cost?: number) => void;
  chipClass: (active: boolean) => string;
}

// My Look's crew pin: show or hide it, and pick a flair crew to rep in its
// place. Flair is free and cosmetic only.
const CrewPinSection = ({ onPinAction, chipClass }: CrewPinSectionProps) => {
  const { userData } = useSession();
  const { textClass, mutedClass } = themeClasses;
  const crew = userData?.crew ? CREW_MAP[userData.crew] : undefined;
  if (!userData || !crew) return null;

  // displayCrewPin defaults to undefined (= shown), so toggle off the
  // EFFECTIVE displayed state, not the raw value. Crew heads always
  // display their pin — the backend ignores their toggles, so show the
  // pin as locked instead of a button that silently does nothing.
  const crewPinDisplayed = userData.displayCrewPin !== false;
  const isCrewHead = !!userData.isCrewHead;
  const flairs = flairCrewsOf(crew.id);
  const flair = flairOf(userData);

  return (
    <div>
      <h3 className={`font-semibold ${textClass} mb-2`}>Crew Pin</h3>
      <button
        onClick={() => !isCrewHead && onPinAction('toggleCrewPin', !crewPinDisplayed, 0)}
        disabled={isCrewHead}
        className={`${chipClass(crewPinDisplayed)} ${isCrewHead ? 'cursor-default' : ''} inline-flex items-center`}
      >
        {flair || crewPinSrc(crew) ? (
          <CrewPin crew={crew} flair={flair} className="w-5 h-5 mr-1" />
        ) : (
          <span className="mr-1">{crew.emblem}</span>
        )}
        <span className={`text-sm ${textClass}`}>{flair ? `${flair.name} (${crew.name})` : crew.name}</span>
        {crewPinDisplayed && <span className="text-xs text-orange-500 ml-2">✓</span>}
      </button>
      {isCrewHead && <p className={`text-xs ${mutedClass} mt-1`}>Crew heads always show their crew pin.</p>}

      {flairs.length > 0 && (
        <div className="mt-4">
          <h4 className={`text-sm font-semibold ${textClass} mb-1`}>Flair Crew</h4>
          <p className={`text-xs ${mutedClass} mb-2`}>
            Rep a smaller crew inside {crew.name}. Its crest takes the place of your crew pin. Rankings, missions, and
            everything else stay with {crew.name}. Free to change any time.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => flair && onPinAction('setFlairCrew', null)}
              className={`${chipClass(!flair)} inline-flex items-center`}
            >
              {crewPinSrc(crew) ? (
                <CrewPin crew={crew} className="w-5 h-5 mr-1" />
              ) : (
                <span className="mr-1">{crew.emblem}</span>
              )}
              <span className={`text-sm ${textClass}`}>None</span>
            </button>
            {flairs.map((f) => (
              <button
                key={f.id}
                onClick={() => flair?.id !== f.id && onPinAction('setFlairCrew', f.id)}
                className={`${chipClass(flair?.id === f.id)} inline-flex items-center`}
              >
                <CrewPin crew={crew} flair={f} className="w-5 h-5 mr-1" />
                <span className={`text-sm ${textClass}`}>{f.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CrewPinSection;
