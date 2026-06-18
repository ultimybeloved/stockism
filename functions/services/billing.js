'use strict';
// Hard billing killswitch — the only thing that guarantees a hard dollar ceiling.
//
// A Cloud Billing budget publishes spend updates to the 'billing-killswitch'
// Pub/Sub topic. When spend passes the budget, this disables billing on the whole
// project, which stops ALL paid services (Cloud Functions, Firestore writes) — the
// site effectively goes offline until billing is manually re-enabled in the
// Google Cloud console. This is intentional: it is the nuclear backstop, not a
// graceful degrade.
//
// Setup required (see the cost notes handed over with this change):
//   1. Create the Pub/Sub topic 'billing-killswitch'.
//   2. Point a Billing budget's notifications at that topic.
//   3. Grant this project's App Engine service account permission to disable
//      billing (Project Billing Manager on the project + billing account).
const functions = require('firebase-functions');
const { CloudBillingClient } = require('@google-cloud/billing');

const billing = new CloudBillingClient();
const PROJECT_NAME = `projects/${process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT}`;

exports.billingKillswitch = functions.pubsub
  .topic('billing-killswitch')
  .onPublish(async (message) => {
    const data = (message && message.json) || {};
    const cost = data.costAmount;
    const budget = data.budgetAmount;

    if (typeof cost !== 'number' || typeof budget !== 'number') {
      console.log('billingKillswitch: no cost/budget in message, ignoring', JSON.stringify(data));
      return;
    }
    if (cost <= budget) {
      console.log(`billingKillswitch: within budget ($${cost} <= $${budget})`);
      return;
    }

    const info = await billing.getProjectBillingInfo({ name: PROJECT_NAME });
    if (!info[0] || !info[0].billingEnabled) {
      console.log('billingKillswitch: billing already disabled, nothing to do');
      return;
    }

    await billing.updateProjectBillingInfo({
      name: PROJECT_NAME,
      projectBillingInfo: { billingAccountName: '' }, // empty string detaches billing
    });
    console.error(
      `🛑 billingKillswitch: spend $${cost} exceeded budget $${budget} — BILLING DISABLED. ` +
      'The project is offline until billing is re-enabled in the Cloud console.'
    );
  });
