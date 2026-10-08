import { useState, useCallback } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import type { AdminHookDeps } from './adminShared';
import { errorMessage } from '../../utils/errors';

/**
 * Admin panel: the announcements shown in the site-wide bar.
 *
 * Written straight from the client to config/siteMessages, which firestore.rules
 * already exposes as world-read and admin-write. Same shape as
 * useAdminDividends — no Cloud Function is needed for an admin-only write to a
 * public config doc, and adding one would just be a deploy step for every copy
 * edit.
 *
 * Every returned key is prefixed with the domain because AdminPanel spreads
 * about thirty-five hook returns into tabs as props, and a collision would be
 * silent.
 */
const REF = () => doc(db, 'config', 'siteMessages');

import type { SiteMessage } from '../../types';

const blank = (): SiteMessage => ({
  id: `m${Date.now().toString(36)}`,
  text: '',
  link: '',
  tone: 'info',
  active: true,
});

export function useAdminSiteMessages({ showMessage }: Pick<AdminHookDeps, 'showMessage'>) {
  const [messages, setMessages] = useState<SiteMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDoc(REF());
      setMessages(snap.exists() ? snap.data().messages || [] : []);
      setLoaded(true);
      setDirty(false);
    } catch (e) {
      showMessage('error', errorMessage(e) || 'Could not load site messages.');
    } finally {
      setLoading(false);
    }
  }, [showMessage]);

  const save = useCallback(
    async (next?: SiteMessage[]) => {
      const list = next || messages;
      // An empty text with active on would render a bar with nothing in it.
      const cleaned = list
        .filter((m) => m.text?.trim() || !m.active)
        .map((m) => ({ ...m, text: (m.text || '').trim(), link: (m.link || '').trim() }));
      setLoading(true);
      try {
        await setDoc(REF(), { messages: cleaned, updatedAt: Date.now() }, { merge: true });
        setMessages(cleaned);
        setDirty(false);
        showMessage(
          'success',
          cleaned.some((m) => m.active) ? 'Site message bar updated.' : 'Site message bar is now hidden.',
        );
      } catch (e) {
        showMessage('error', errorMessage(e) || 'Could not save site messages.');
      } finally {
        setLoading(false);
      }
    },
    [messages, showMessage],
  );

  const update = useCallback((id: string, patch: Partial<SiteMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    setDirty(true);
  }, []);

  const add = useCallback(() => {
    setMessages((prev) => [...prev, blank()]);
    setDirty(true);
  }, []);

  const remove = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    setDirty(true);
  }, []);

  const move = useCallback((id: string, delta: number) => {
    setMessages((prev) => {
      const i = prev.findIndex((m) => m.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      // i and j were both bounds-checked above.
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
    setDirty(true);
  }, []);

  return {
    siteMessagesList: messages,
    siteMessagesLoading: loading,
    siteMessagesLoaded: loaded,
    siteMessagesDirty: dirty,
    loadSiteMessages: load,
    saveSiteMessages: save,
    updateSiteMessage: update,
    addSiteMessage: add,
    removeSiteMessage: remove,
    moveSiteMessage: move,
  };
}
