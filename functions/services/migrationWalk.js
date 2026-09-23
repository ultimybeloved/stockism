'use strict';
// Walking big collections inside a time budget, shared by the ticker rename
// (tickerRename.js) and the stock split (stockSplit.js). Each walker returns
// { done, complete, cursor? } so a phase can pause on the budget and resume
// where it stopped.
//
// INTERNAL MODULE — never listed in servicePaths.js.
const admin = require('firebase-admin');

const db = admin.firestore();

const { RENAME_BATCH_SIZE, RENAME_PAGE_SIZE } = require('../constants');

const commitInChunks = async (writes) => {
  for (let i = 0; i < writes.length; i += RENAME_BATCH_SIZE) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + RENAME_BATCH_SIZE)) batch.update(w.ref, w.updates);
    await batch.commit();
  }
};

/**
 * Drain a query that stops matching once rewritten.
 *
 * Because the rewrite removes the document from its own result set, this needs
 * no cursor and re-running it after a crash simply finds what is left.
 */
const drainQuery = async (queryFn, buildUpdates, budget) => {
  let done = 0;
  for (;;) {
    if (budget.expired()) return { done, complete: false };
    const snap = await queryFn().limit(RENAME_PAGE_SIZE).get();
    if (snap.empty) return { done, complete: true };
    const writes = [];
    for (const doc of snap.docs) {
      const updates = buildUpdates(doc);
      if (Object.keys(updates).length) writes.push({ ref: doc.ref, updates });
    }
    if (!writes.length) return { done, complete: true };
    await commitInChunks(writes);
    done += writes.length;
  }
};

/**
 * Walk a query in document-id order, remembering where it got to.
 *
 * Used where the rewrite does not change what the query matches (a split keeps
 * the ticker), so progress has to be remembered explicitly. `queryFn` returns
 * the unordered, unlimited query. The cursor is stored in a journal between
 * calls, so it is a string: the document id, or for a collection-group query
 * (`group: true`) the full path, which is what those order by.
 */
const walkQuery = async (queryFn, cursor, buildUpdates, budget, { group = false } = {}) => {
  let done = 0;
  let last = cursor || null;
  for (;;) {
    if (budget.expired()) return { done, cursor: last, complete: false };
    let q = queryFn().orderBy(admin.firestore.FieldPath.documentId()).limit(RENAME_PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) return { done, cursor: last, complete: true };

    const writes = [];
    for (const doc of snap.docs) {
      const updates = buildUpdates(doc.data(), doc);
      if (Object.keys(updates).length) writes.push({ ref: doc.ref, updates });
    }
    if (writes.length) await commitInChunks(writes);
    done += writes.length;
    const lastDoc = snap.docs[snap.docs.length - 1];
    last = group ? lastDoc.ref.path : lastDoc.id;
    if (snap.size < RENAME_PAGE_SIZE) return { done, cursor: last, complete: true };
  }
};

/** walkQuery over a whole collection, with the id cursor the rename journal stores. */
const walkCollection = async (collection, cursor, buildUpdates, budget) => {
  let done = 0;
  let last = cursor || null;
  for (;;) {
    if (budget.expired()) return { done, cursor: last, complete: false };
    let q = db.collection(collection).orderBy(admin.firestore.FieldPath.documentId())
      .limit(RENAME_PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) return { done, cursor: last, complete: true };

    const writes = [];
    for (const doc of snap.docs) {
      const updates = buildUpdates(doc.data(), doc);
      if (Object.keys(updates).length) writes.push({ ref: doc.ref, updates });
    }
    if (writes.length) await commitInChunks(writes);
    done += writes.length;
    last = snap.docs[snap.docs.length - 1].id;
    if (snap.size < RENAME_PAGE_SIZE) return { done, cursor: last, complete: true };
  }
};

module.exports = { commitInChunks, drainQuery, walkQuery, walkCollection };
