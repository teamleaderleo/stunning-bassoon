import test from "node:test";
import assert from "node:assert/strict";

import { applyObservation, newSession } from "../src/controller.js";
import { loadFixtures } from "../src/data.js";
import { buildResponsePlan } from "../src/response-plan.js";

const data = loadFixtures();

function expiredMargaretSession(transferState) {
  const session = applyObservation(newSession(), {
    identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472" },
    caseHint: { caseId: "CL-2048" },
    scope: "in_scope",
  }, data).session;
  session.humanTransferOffered = transferState !== "not_offered";
  session.humanTransfer = { state: transferState };
  return session;
}

function planFor(transferState) {
  return buildResponsePlan({
    session: expiredMargaretSession(transferState),
    observation: {
      emotion: "frustrated",
      refusal: false,
      scope: "in_scope",
    },
    userText: "This is ridiculous. There has to be something you can do. Just make an exception.",
    data,
    asOfDate: "2026-09-15",
  });
}

test("expired appeal with pending human choice still offers the representative option", () => {
  const plan = planFor("awaiting_choice");
  assert.equal(plan.task, "explain_expired_appeal_and_offer_human");
  assert.equal(plan.humanTransfer.state, "awaiting_choice");
  assert.equal(plan.conversationPolicy.offerHumanRepresentative, true);
  assert.equal(plan.conversationPolicy.doNotRepeatDeclinedTransferOffer, false);
});

test("expired appeal after caller declines does not immediately re-offer human transfer", () => {
  const plan = planFor("declined");
  assert.equal(plan.task, "explain_expired_appeal_after_human_declined");
  assert.equal(plan.humanTransfer.state, "declined");
  assert.equal(plan.conversationPolicy.offerHumanRepresentative, false);
  assert.equal(plan.conversationPolicy.doNotRepeatDeclinedTransferOffer, true);
  assert.equal(plan.conversationPolicy.humanRepresentativeRemainsAvailableIfCallerReconsiders, true);
  assert.equal(plan.conversationPolicy.ordinarySubmissionPathIsCurrent, false);
});

test("expired appeal after handoff request does not ask for transfer again or claim connection", () => {
  const plan = planFor("requested");
  assert.equal(plan.task, "explain_expired_appeal_after_human_requested");
  assert.equal(plan.humanTransfer.state, "requested");
  assert.equal(plan.conversationPolicy.offerHumanRepresentative, false);
  assert.equal(plan.conversationPolicy.handoffRequestRecorded, true);
  assert.equal(plan.conversationPolicy.doNotClaimLiveTransfer, true);
  assert.equal(plan.conversationPolicy.ordinarySubmissionPathIsCurrent, false);
});
