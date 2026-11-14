// Recruiting rewards (rules in shared/rules/recruiting). Internal module.
//
// recordRecruit runs at sign-up and only writes down who invited whom.
// settleRecruit runs when the recruit checks in and pays both sides once the
// recruit has earned it. One private doc per recruit, `recruits/{recruitUid}`
// (no client access), so an account can be somebody's recruit at most once.
// A qualified recruit over the recruiter's weekly cap is marked `queued` and
// rolls over: settleQueuedRecruits pays it when the recruiter next checks in
// in a later week, whether or not the recruit ever comes back.
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import {
  RECRUITER_REWARD,
  RECRUIT_BONUS,
  RECRUIT_WEEKLY_CAP,
  isRecruitRef,
  recruiterAchievements,
  recruitExpired,
  recruitQualifies,
  recruitWeek,
} from '../shared/rules/recruiting';
import { grantedValueUpdate } from '../shared/equity';
import { recordLedger } from '../shared/ledger';
import { writeNotification } from '../shared/notifications';
import { reportError } from '../shared/sentry';
import { asArray } from './displayFields';

const db = admin.firestore();
const recruits = () => db.collection('recruits');

interface SignupOrigin {
  recruitUid: string;
  ref: unknown;
  /** The recruit's connection, as createUser recorded it. */
  signupTrackingKey: string | null | undefined;
  sanitizedSignupIp: string | null | undefined;
}

/**
 * Notes the recruiter at sign-up. Returns the recruiter's name for the sign-up
 * post, or null when the link does not count: unknown name, a banned or bot
 * recruiter, or a recruit on the recruiter's own connection (or on one we
 * could not identify at all, since that check is what stops self-invites).
 */
export async function recordRecruit({ recruitUid, ref, signupTrackingKey, sanitizedSignupIp }: SignupOrigin) {
  if (!isRecruitRef(ref) || !signupTrackingKey) return null;
  const nameDoc = await db.collection('usernames').doc(ref.toLowerCase()).get();
  const recruiterUid = nameDoc.data()?.uid as string | undefined;
  if (!recruiterUid || recruiterUid === recruitUid) return null;

  const [recruiterDoc, connectionDoc] = await Promise.all([
    db.collection('users').doc(recruiterUid).get(),
    db.collection('ipTracking').doc(signupTrackingKey).get(),
  ]);
  const recruiter = recruiterDoc.data();
  if (!recruiter || recruiter.isBot || recruiter.isBanned) return null;
  const sameConnection =
    recruiter.signupTrackingKey === signupTrackingKey ||
    (!!sanitizedSignupIp && recruiter.signupIp === sanitizedSignupIp) ||
    !!connectionDoc.data()?.accounts?.[recruiterUid];
  if (sameConnection) return null;

  const batch = db.batch();
  batch.create(recruits().doc(recruitUid), { recruiterUid, recruitUid, status: 'pending', createdAt: Date.now() });
  batch.update(db.collection('users').doc(recruitUid), { recruitPending: true });
  batch.update(recruiterDoc.ref, { 'recruiting.pending': FieldValue.increment(1) });
  await batch.commit();
  return (recruiter.displayName as string) || null;
}

type Outcome = 'paid' | 'waiting' | 'closed';

/**
 * Pays the recruiter and the recruit if the recruit has qualified. Called after
 * the recruit's check-in or mission claim, so it reads the count that just
 * changed. Safe to call again: a recruit is paid once, and one still short
 * simply waits.
 */
export async function settleRecruit(recruitUid: string): Promise<Outcome> {
  const now = Date.now();
  const recruitRef = db.collection('users').doc(recruitUid);
  const result = await db.runTransaction(async (tx) => {
    const recordSnap = await tx.get(recruits().doc(recruitUid));
    const record = recordSnap.data();
    if (!record || record.status !== 'pending') {
      tx.update(recruitRef, { recruitPending: FieldValue.delete() });
      return { outcome: 'closed' as const };
    }
    const recruiterRef = db.collection('users').doc(record.recruiterUid as string);
    const [recruitSnap, recruiterSnap] = await Promise.all([tx.get(recruitRef), tx.get(recruiterRef)]);
    const recruit = recruitSnap.data() || {};
    const recruiter = recruiterSnap.data();

    const close = (status: 'expired' | 'void') => {
      tx.update(recordSnap.ref, { status, closedAt: now });
      tx.update(recruitRef, { recruitPending: FieldValue.delete() });
      if (recruiter) tx.update(recruiterRef, { 'recruiting.pending': FieldValue.increment(-1) });
      return { outcome: 'closed' as const };
    };
    if (!recruiter || recruiter.isBanned || recruiter.isBot || recruit.isBanned) return close('void');
    // A queued recruit already qualified in time, so the deadline no longer applies.
    if (!record.queued) {
      if (recruitExpired(record.createdAt, now)) return close('expired');
      if (!recruitQualifies(recruit, record.createdAt, now)) return { outcome: 'waiting' as const };
    }

    // Weekly cap: a recruit over it is queued and rolls over to a later week.
    const week = recruitWeek(now);
    const paidThisWeek = recruiter.recruiting?.week === week ? recruiter.recruiting?.weekPaid || 0 : 0;
    if (paidThisWeek >= RECRUIT_WEEKLY_CAP) {
      if (!record.queued) tx.update(recordSnap.ref, { queued: true });
      return { outcome: 'waiting' as const };
    }
    const held = asArray(recruiter.achievements);
    const earned = recruiterAchievements((recruiter.recruiting?.paid || 0) + 1).filter((id) => !held.includes(id));

    tx.update(recruiterRef, {
      cash: FieldValue.increment(RECRUITER_REWARD),
      'recruiting.pending': FieldValue.increment(-1),
      'recruiting.paid': FieldValue.increment(1),
      'recruiting.week': week,
      'recruiting.weekPaid': paidThisWeek + 1,
      // Breaks ties on the recruiters board: first to a count ranks higher.
      'recruiting.lastPaidAt': now,
      // Recruiter achievements, at 1, 3, 5, and 10 recruits (rules/recruiting).
      ...(earned.length ? { achievements: FieldValue.arrayUnion(...earned) } : {}),
      ...Object.fromEntries(earned.map((id) => [`achievementDates.${id}`, now])),
      ...grantedValueUpdate(RECRUITER_REWARD, now),
    });
    recordLedger(tx, {
      uid: recruiterRef.id,
      type: 'recruit_reward',
      amount: RECRUITER_REWARD,
      cashAfter: (recruiter.cash || 0) + RECRUITER_REWARD,
      ref: `recruits/${recruitUid}`,
    });
    tx.update(recruitRef, {
      cash: FieldValue.increment(RECRUIT_BONUS),
      recruitPending: FieldValue.delete(),
      ...grantedValueUpdate(RECRUIT_BONUS, now),
    });
    recordLedger(tx, {
      uid: recruitUid,
      type: 'recruit_bonus',
      amount: RECRUIT_BONUS,
      cashAfter: (recruit.cash || 0) + RECRUIT_BONUS,
      ref: `recruits/${recruitUid}`,
    });
    tx.update(recordSnap.ref, { status: 'paid', paidAt: now, queued: FieldValue.delete() });
    return {
      outcome: 'paid' as const,
      recruiterUid: recruiterRef.id,
      recruitName: (recruit.displayName as string) || 'Your recruit',
      recruiterName: (recruiter.displayName as string) || 'your recruiter',
    };
  });

  if (result.outcome === 'paid') {
    const money = (n: number) => `$${n.toLocaleString('en-US')}`;
    await Promise.all([
      writeNotification(result.recruiterUid, {
        type: 'system',
        title: 'Recruit reward',
        message: `${result.recruitName} stuck around. You earned ${money(RECRUITER_REWARD)} for bringing them in.`,
      }),
      writeNotification(recruitUid, {
        type: 'system',
        title: 'Recruit bonus',
        message: `You earned ${money(RECRUIT_BONUS)} for joining through ${result.recruiterName}'s invite and sticking around.`,
      }),
    ]).catch((err) => reportError(err, { where: 'settleRecruit.notify', uid: recruitUid }));
  }
  return result.outcome;
}

/**
 * Pays a recruiter's queued recruits (the ones held back by the weekly cap) as
 * far as this week's cap allows. Called after the recruiter's own check-in.
 */
export async function settleQueuedRecruits(recruiterUid: string): Promise<number> {
  const queued = await recruits()
    .where('recruiterUid', '==', recruiterUid)
    .where('queued', '==', true)
    .limit(RECRUIT_WEEKLY_CAP)
    .get();
  let paid = 0;
  for (const doc of queued.docs) {
    const outcome = await settleRecruit(doc.id);
    if (outcome === 'paid') paid++;
    // Still over the cap: the rest wait for next week.
    else if (outcome === 'waiting') break;
  }
  return paid;
}
