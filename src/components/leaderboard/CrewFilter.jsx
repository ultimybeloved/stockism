import { CREWS } from '../../crews';

// The crew pills above the leaderboard. Lifted out of LeaderboardPage so the
// page stays inside its size limit; no behaviour changed.
const CrewFilter = ({ crewFilter, setCrewFilter, chipClass }) => (
  <div className="grid grid-cols-5 gap-1.5">
    <button
      onClick={() => setCrewFilter('ALL')}
      className={`px-2 py-1.5 text-xs rounded-full font-semibold transition-colors ${
        crewFilter === 'ALL'
          ? 'bg-orange-600 text-white'
          : chipClass
      }`}
    >
      All
    </button>
    {Object.values(CREWS).map(crew => (
      <button
        key={crew.id}
        onClick={() => setCrewFilter(crew.id)}
        className={`px-2 py-1.5 text-xs rounded-full font-semibold flex items-center justify-center gap-1 truncate transition-colors ${
          crewFilter === crew.id
            ? 'text-white'
            : chipClass
        }`}
        style={crewFilter === crew.id ? { backgroundColor: crew.color } : {}}
      >
        {crew.icon ? (
          <img src={crew.icon} alt="" className="w-3.5 h-3.5 object-contain shrink-0" />
        ) : (
          <span className="shrink-0">{crew.emblem}</span>
        )}
        <span className="truncate">{crew.name}</span>
      </button>
    ))}
  </div>
);

export default CrewFilter;
