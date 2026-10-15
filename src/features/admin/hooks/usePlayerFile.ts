import { useEffect, useState } from 'react';
import {
  adminAddPlayerNoteFunction,
  adminDeletePlayerNoteFunction,
  adminGetPlayerFileFunction,
} from '../../../api/callables';
import { errorMessage } from '../../../utils/errors';
import type { PlayerFileResponse } from '../../../api/adminPanelTypes';

// One player's file (adminGetPlayerFile) plus the private notes on it.
export function usePlayerFile(uid: string | null, showMessage: (type: string, text: string) => void) {
  const [file, setFile] = useState<PlayerFileResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!uid) return;
    let live = true;
    setLoading(true);
    setError(null);
    setFile((f) => (f?.uid === uid ? f : null));
    adminGetPlayerFileFunction({ uid })
      .then((res) => live && setFile(res.data))
      .catch((err) => live && setError(errorMessage(err)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [uid, nonce]);

  const reload = () => setNonce((n) => n + 1);

  const addNote = async (text: string) => {
    if (!uid) return false;
    try {
      const { data } = await adminAddPlayerNoteFunction({ uid, text });
      setFile((f) => (f ? { ...f, notes: [...f.notes, data.note] } : f));
      return true;
    } catch (err) {
      showMessage('error', errorMessage(err));
      return false;
    }
  };

  const deleteNote = async (noteId: string) => {
    if (!uid || !window.confirm('Delete this note?')) return;
    try {
      await adminDeletePlayerNoteFunction({ uid, noteId });
      setFile((f) => (f ? { ...f, notes: f.notes.filter((n) => n.id !== noteId) } : f));
    } catch (err) {
      showMessage('error', errorMessage(err));
    }
  };

  return { file, loading, error, reload, addNote, deleteNote };
}
