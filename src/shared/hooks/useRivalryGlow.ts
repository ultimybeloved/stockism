import { useSyncExternalStore } from 'react';

// Last week's Crew Rivalry winners (market/crewStats.rivalryWinners). Their
// crest glows everywhere for the week. A small store rather than context so
// every CrewPin can read it without sitting under a provider.
let winners: string[] = [];
const listeners = new Set<() => void>();

export const setRivalryWinners = (ids: string[] | null | undefined) => {
  const next = Array.isArray(ids) ? ids : [];
  if (next.join('|') === winners.join('|')) return;
  winners = next;
  listeners.forEach((l) => l());
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** True while this crew is last week's rivalry winner. */
export const useRivalryGlow = (crewId: string | undefined) =>
  useSyncExternalStore(
    subscribe,
    () => !!crewId && winners.includes(crewId),
    () => false,
  );
