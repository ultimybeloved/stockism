// Remembers the invite link a visitor arrived through, so the recruiter gets
// credit even if the visitor browses for a while (or comes back another day)
// before making an account. The server decides whether it counts.
import { RECRUIT_LINK_MEMORY_DAYS, RECRUIT_REF_PARAM, isRecruitRef } from '../../rules/recruiting';

const KEY = 'recruitRef';
const MEMORY_MS = RECRUIT_LINK_MEMORY_DAYS * 24 * 60 * 60 * 1000;

/** Call once at startup. The first link a visitor follows is the one that sticks. */
export function captureRecruitRef(search: string = window.location.search): void {
  const ref = new URLSearchParams(search).get(RECRUIT_REF_PARAM);
  if (!isRecruitRef(ref) || readRecruitRef()) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ref, at: Date.now() }));
  } catch {
    // Storage blocked: the sign-up simply carries no recruiter.
  }
}

/** The remembered recruiter name, or null if there is none or it is too old. */
export function readRecruitRef(now: number = Date.now()): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null') as { ref?: unknown; at?: unknown } | null;
    if (!saved || !isRecruitRef(saved.ref) || typeof saved.at !== 'number') return null;
    return now - saved.at <= MEMORY_MS ? saved.ref : null;
  } catch {
    return null;
  }
}
