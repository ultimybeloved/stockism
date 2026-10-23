// Chapter markers: name each chapter review and add a line about it. Players
// see both when they hover the marker on a chart. The markers themselves are
// recorded at the 20:55 lock (functions/src/market/chapterMarkers.ts).
import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../../firebase';
import { adminSetChapterNoteFunction } from '../../../../api/callables';
import { errorMessage } from '../../../../utils/errors';
import { CHAPTER_LABEL_MAX, CHAPTER_NOTE_MAX, type ChapterMarker } from '../../../../rules/chapterMarkers';
import { Empty, Panel } from '../shell/ui';
import { t } from '../shell/terminal';

const SHOWN = 12;

const Row = ({ m }: { m: ChapterMarker }) => {
  const [label, setLabel] = useState(m.label || '');
  const [note, setNote] = useState(m.note || '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | string>('idle');
  const dirty = label !== (m.label || '') || note !== (m.note || '');
  const top = Object.entries(m.moves)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 4)
    .map(([tk, v]) => `${tk} ${v > 0 ? '+' : ''}${v}%`)
    .join(', ');

  const save = async () => {
    setState('saving');
    try {
      await adminSetChapterNoteFunction({ weekId: m.weekId, label, note });
      m.label = label || undefined;
      m.note = note || undefined;
      setState('saved');
    } catch (err) {
      setState(errorMessage(err));
    }
  };

  return (
    <tr className={t.row}>
      <td className={`${t.td} ${t.num} ${t.muted}`}>{new Date(m.at).toISOString().slice(0, 10)}</td>
      <td className={t.td}>
        <input
          className={`${t.input} w-36`}
          placeholder="Chapter 560"
          maxLength={CHAPTER_LABEL_MAX}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </td>
      <td className={`${t.td} w-full`}>
        <input
          className={`${t.input} w-full`}
          placeholder="One line about what happened"
          maxLength={CHAPTER_NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className={`text-[11px] ${t.dim} mt-0.5 whitespace-normal`}>{top || 'Nothing moved'}</div>
      </td>
      <td className={t.td}>
        <button className={t.btn} disabled={!dirty || state === 'saving'} onClick={() => void save()}>
          Save
        </button>
        {state === 'saved' && !dirty && <span className={`ml-2 text-xs ${t.green}`}>Saved</span>}
        {!['idle', 'saving', 'saved'].includes(state) && <div className={`text-xs ${t.red}`}>{state}</div>}
      </td>
    </tr>
  );
};

const ChapterNotes = () => {
  const [markers, setMarkers] = useState<ChapterMarker[] | null>(null);

  useEffect(() => {
    getDoc(doc(db, 'market', 'chapterMarkers'))
      .then((snap) => setMarkers(((snap.data()?.markers as ChapterMarker[]) || []).slice(0, SHOWN)))
      .catch(() => setMarkers([]));
  }, []);

  return (
    <Panel title="Chapter markers on the charts" pad={false}>
      {!markers ? (
        <Empty>Loading...</Empty>
      ) : markers.length === 0 ? (
        <Empty>No chapter markers yet. The first one is recorded at the next 20:55 lock.</Empty>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {markers.map((m) => (
              <Row key={m.weekId} m={m} />
            ))}
          </tbody>
        </table>
      )}
      <p className={`px-3 py-2 text-[11px] ${t.dim}`}>
        Players see the name and note when they hover a chapter flag on a chart. Without a name it reads &quot;Chapter
        review&quot; and the date.
      </p>
    </Panel>
  );
};

export default ChapterNotes;
