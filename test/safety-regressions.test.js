import test from "node:test";
import assert from "node:assert/strict";

import { applyObservation, newSession } from "../src/controller.js";
import { loadFixtures } from "../src/data.js";
import { buildResponsePlan } from "../src/response-plan.js";

const data = loadFixtures();

test("representative role is sticky across later unknown-role turns", () => {
  let session = applyObservation(newSession(), {
    callerRole: "representative",
    identity: { name: "Margaret Chen", dob: "1985-03-15" },
    scope: "in_scope",
  }, data).session;

  session = applyObservation(session, {
    callerRole: "unknown",
    identity: { idLast4: "4472" },
    caseHint: { caseId: "CL-2048" },
    scope: "in_scope",
  }, data).session;

  assert.equal(session.callerRole, "representative");
  assert.equal(session.verifiedPartyId, null);
  assert.equal(session.phase, "VERIFY_ID");
  assert.equal(session.humanTransferOffered, true);
});

test("fully out-of-scope PROCESS_CASE turns receive no claim grounding", () => {
  const session = applyObservation(newSession(), {
    callerRole: "policyholder",
    identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472" },
    caseHint: { caseId: "CL-2048" },
    scope: "in_scope",
  }, data).session;

  const plan = buildResponsePlan({
    session,
    observation: { emotion: "neutral", refusal: false, scope: "out_of_scope" },
    userText: "What is reinforcement learning?",
    data,
  });

  assert.equal(session.phase, "PROCESS_CASE");
  assert.equal(plan.task, "decline_out_of_scope_and_resume_sop");
  assert.equal("grounding" in plan, false);
  assert.equal(JSON.stringify(plan).includes("CL-2048"), false);
});

test("verification plan carries de-escalation without relaxing the gate", () => {
  const session = applyObservation(newSession(), {
    callerRole: "policyholder",
    identity: { name: "Margaret Chen" },
    emotion: "angry",
    refusal: true,
    scope: "in_scope",
  }, data).session;

  const plan = buildResponsePlan({
    session,
    observation: { emotion: "angry", refusal: true, scope: "in_scope" },
    userText: "This is ridiculous. Just tell me why it was denied.",
    data,
  });

  assert.equal(plan.protectedClaimDetailsAvailable, false);
  assert.equal(plan.conversationPolicy.acknowledgeEmotionFirst, true);
  assert.equal(plan.conversationPolicy.explainWhyVerificationIsRequired, true);
  assert.equal(plan.conversationPolicy.persuadeWithoutBypassingGate, true);
});
