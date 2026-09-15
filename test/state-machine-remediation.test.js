import test from "node:test";
import assert from "node:assert/strict";

import { runAgentTurn } from "../src/agent.js";
import {
  applyObservation,
  chooseEmailSummary,
  chooseHumanTransfer,
  markCaseComplete,
  newSession,
  offerHumanTransfer,
  publicView,
} from "../src/controller.js";
import { loadFixtures } from "../src/data.js";
import { buildObservationContext } from "../src/observation-context.js";
import { buildResponsePlan } from "../src/response-plan.js";

const data = loadFixtures();

function obs(overrides = {}) {
  return {
    identity: {}, callerRole: "policyholder", identityPrincipalChange: false,
    caseHint: {}, caseTargetChange: false,
    intent: "unknown", humanTransferChoice: "unknown", postProcessChoice: "unknown",
    emotion: "neutral", refusal: false, scope: "in_scope", ...overrides,
  };
}

function verifyMargaret(overrides = {}) {
  return applyObservation(newSession(), obs({
    identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472" },
    caseHint: { caseId: "CL-2048" },
    intent: "denial_question",
    ...overrides,
  }), data).session;
}

test("preverification correctness stays private from public view, observer context, and phrase plan", () => {
  const result = applyObservation(newSession(), obs({
    identity: { name: "Margaret Chen", dob: "1980-01-01", idLast4: "4472" },
  }), data);
  assert.deepEqual(result.session.verification.matchingFields.sort(), ["idLast4", "name"]);
  assert.equal("matchingFields" in result.view.identity, false);
  assert.deepEqual(result.view.identity.providedFields.sort(), ["dob", "idLast4", "name"]);
  const context = buildObservationContext(result.session, "Please verify.");
  assert.equal("matchingIdentityFields" in context, false);
  const plan = buildResponsePlan({ session: result.session, observation: obs(), userText: "x", data });
  assert.equal("matchingFields" in plan.verification, false);
  assert.equal("matchingFieldCount" in plan.verification, false);
  assert.deepEqual(plan.verification.providedFields.sort(), ["dob", "idLast4", "name"]);
});

test("after verification public audit may show matching fields", () => {
  const session = verifyMargaret();
  assert.deepEqual(publicView(session, data).identity.matchingFields.sort(), ["dob", "idLast4", "name"]);
});

test("unique claim with unknown intent stays in RESOLVE_INTENT until actionable intent arrives", () => {
  let result = applyObservation(newSession(), obs({
    identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472" },
    caseHint: { caseId: "CL-2048" },
  }), data);
  assert.equal(result.session.phase, "RESOLVE_INTENT");
  assert.equal(result.session.resolvedCaseId, "CL-2048");
  const plan = buildResponsePlan({ session: result.session, observation: obs(), userText: "CL-2048", data });
  assert.equal(plan.task, "request_actionable_intent_for_resolved_case");
  result = applyObservation(result.session, obs({ intent: "status_inquiry" }), data);
  assert.equal(result.session.phase, "PROCESS_CASE");
});

test("explicit claim replacement clears the old claim-coupled intent", () => {
  const session = verifyMargaret();
  assert.equal(session.intent, "denial_question");
  const result = applyObservation(session, obs({
    caseTargetChange: true,
    caseHint: { caseType: "auto", month: 2 },
  }), data);
  assert.equal(result.session.intent, null);
  assert.equal(result.session.resolvedCaseId, "CL-2102");
  assert.equal(result.session.phase, "RESOLVE_INTENT");
  assert.deepEqual(result.session.caseHint, { caseType: "auto", month: 2 });
});

test("explicit claim replacement uses a new actionable goal from the same turn", () => {
  const result = applyObservation(verifyMargaret(), obs({
    caseTargetChange: true,
    caseHint: { caseType: "auto", month: 2 },
    intent: "status_inquiry",
  }), data);
  assert.equal(result.session.intent, "status_inquiry");
  assert.equal(result.session.resolvedCaseId, "CL-2102");
  assert.equal(result.session.phase, "PROCESS_CASE");
});

test("late representative disclosure revokes protected access and selected claim", () => {
  const session = verifyMargaret();
  const result = applyObservation(session, obs({ callerRole: "representative" }), data);
  assert.equal(result.session.verifiedPartyId, null);
  assert.equal(result.session.resolvedCaseId, null);
  assert.deepEqual(result.session.caseHint, {});
  assert.equal(result.session.phase, "VERIFY_ID");
  assert.equal(result.session.humanTransfer.state, "awaiting_choice");
  assert.equal(result.view.claimAccess, "locked");
  assert.equal(result.events.some(e => e.type === "authorization_revoked"), true);
});

test("post-verification PII corrections recompute against same party and revoke below three matches", () => {
  let session = applyObservation(newSession(), obs({
    identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472", email: "margaret@email.com" },
    caseHint: { caseId: "CL-2048" }, intent: "status_inquiry",
  }), data).session;
  session = applyObservation(session, obs({ identity: { email: "wrong@example.com" } }), data).session;
  assert.equal(session.verifiedPartyId, "P9");
  assert.equal(session.verification.matchingFields.length, 3);
  const result = applyObservation(session, obs({ identity: { dob: "1990-08-21" } }), data);
  assert.equal(result.session.verifiedPartyId, null);
  assert.equal(result.session.resolvedCaseId, null);
  assert.equal(result.session.phase, "VERIFY_ID");
});

test("identity correction never silently switches authorization to another person", () => {
  const session = verifyMargaret();
  const result = applyObservation(session, obs({
    identity: { name: "Ava Lopez", dob: "1990-08-21", idLast4: "9180" },
  }), data);
  assert.equal(result.session.verifiedPartyId, null);
  assert.equal(result.session.phase, "VERIFY_ID");
  const stillLocked = applyObservation(result.session, obs({ scope: "in_scope" }), data);
  assert.equal(stillLocked.session.verifiedPartyId, null);
  assert.equal(stillLocked.session.verificationSubjectPartyId, "P9");
});

test("explicit principal replacement starts a fresh verification epoch without stale PII", () => {
  let session = applyObservation(newSession(), obs({
    identity: {
      name: "Margaret Chen",
      dob: "1985-03-15",
      idLast4: "4472",
      phone: "650-521-2836",
      email: "margaret@email.com",
    },
    caseHint: { caseId: "CL-2048" },
    intent: "denial_question",
  }), data).session;
  assert.equal(session.verifiedPartyId, "P9");
  assert.equal(session.resolvedCaseId, "CL-2048");

  let result = applyObservation(session, obs({
    identityPrincipalChange: true,
    identity: { name: "Ava Lopez" },
  }), data);
  assert.equal(result.session.verifiedPartyId, null);
  assert.equal(result.session.verificationSubjectPartyId, null);
  assert.equal(result.session.phase, "VERIFY_ID");
  assert.deepEqual(result.session.identity, { name: "Ava Lopez" });
  assert.deepEqual(result.session.caseHint, {});
  assert.equal(result.session.resolvedCaseId, null);
  assert.equal(result.session.intent, null);
  assert.equal(result.view.claimAccess, "locked");
  assert.equal(result.events.some(e => e.type === "verification_epoch_restarted"), true);

  result = applyObservation(result.session, obs({
    identity: { dob: "1990-08-21", idLast4: "9180" },
  }), data);
  assert.equal(result.session.verifiedPartyId, "P7");
  assert.equal(result.session.verificationSubjectPartyId, "P7");
  assert.equal(result.session.phase, "RESOLVE_INTENT");
  assert.deepEqual(result.session.identity, {
    name: "Ava Lopez",
    dob: "1990-08-21",
    idLast4: "9180",
  });
  assert.equal(result.session.resolvedCaseId, null);
});

test("known conflicting policy number remains fail closed while policy contributes zero PII", () => {
  const result = applyObservation(newSession(), obs({
    identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472", policyNumber: "POL-1044" },
    caseHint: { caseId: "CL-2048" }, intent: "denial_question",
  }), data);
  assert.equal(result.session.verifiedPartyId, null);
  assert.equal(result.session.verification.candidatePartyId, null);
  assert.deepEqual(result.session.verification.matchingFields, []);
});

test("irrelevant retry streak counts only consecutive fully out-of-scope turns", () => {
  let session = applyObservation(newSession(), obs({ scope: "out_of_scope" }), data).session;
  session = applyObservation(session, obs({ scope: "out_of_scope" }), data).session;
  assert.equal(session.outOfScopeAttempts, 2);
  session = applyObservation(session, obs({ identity: { name: "Margaret Chen" }, scope: "mixed" }), data).session;
  assert.equal(session.outOfScopeAttempts, 0);
  session = applyObservation(session, obs({ scope: "out_of_scope" }), data).session;
  assert.equal(session.outOfScopeAttempts, 1);
  session = applyObservation(session, obs({ scope: "in_scope" }), data).session;
  assert.equal(session.outOfScopeAttempts, 0);
});

test("explicit target replacement clears stale selectors in RESOLVE_INTENT", () => {
  let session = applyObservation(newSession(), obs({
    identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472" },
    caseHint: { caseType: "healthcare", month: 1 },
  }), data).session;
  assert.equal(session.caseResolution.status, "ambiguous");
  const result = applyObservation(session, obs({
    caseTargetChange: true,
    caseHint: { caseType: "auto" },
    intent: "status_inquiry",
  }), data);
  assert.deepEqual(result.session.caseHint, { caseType: "auto" });
  assert.equal(result.session.resolvedCaseId, "CL-2102");
  assert.equal(result.session.phase, "PROCESS_CASE");
});

test("secondary claim mention does not retarget a selected claim", () => {
  const session = verifyMargaret();
  const result = applyObservation(session, obs({
    caseTargetChange: false,
    caseHint: { caseType: "auto", month: 2 },
    intent: "general_claim_question",
  }), data);
  assert.equal(result.session.resolvedCaseId, "CL-2048");
  assert.equal(result.session.caseHint.caseId, "CL-2048");
  assert.equal(result.events.some(e => e.type === "case_retargeted"), false);
});

test("requested handoff survives explicit claim retarget while pending offer may be cleared", () => {
  let session = offerHumanTransfer(verifyMargaret());
  session = chooseHumanTransfer(session, "accept");
  const result = applyObservation(session, obs({
    caseTargetChange: true, caseHint: { caseType: "auto", month: 2 }, intent: "status_inquiry",
  }), data);
  assert.equal(result.session.resolvedCaseId, "CL-2102");
  assert.equal(result.session.humanTransfer.state, "requested");
  assert.equal(result.session.humanTransferOffered, true);
});

test("POST_PROCESS irrelevant retry escalation defers email consent and restores it after human choice", () => {
  let session = markCaseComplete(verifyMargaret());
  for (let index = 0; index < 3; index += 1) {
    session = applyObservation(session, obs({ scope: "out_of_scope" }), data).session;
  }

  assert.equal(session.outOfScopeAttempts, 3);
  assert.equal(session.humanTransferOffered, true);
  assert.equal(session.humanTransfer.state, "awaiting_choice");
  assert.equal(session.emailSummary.state, "deferred_for_human");
  assert.equal(
    [session.emailSummary.state, session.humanTransfer.state].filter((state) => state === "awaiting_choice").length,
    1,
  );

  const declined = chooseHumanTransfer(session, "decline");
  assert.equal(declined.humanTransfer.state, "declined");
  assert.equal(declined.emailSummary.state, "awaiting_choice");
  assert.equal(chooseEmailSummary(declined, "skip").emailSummary.state, "skip");

  const accepted = chooseHumanTransfer(session, "accept");
  assert.equal(accepted.humanTransfer.state, "requested");
  assert.equal(accepted.emailSummary.state, "awaiting_choice");
  assert.equal(chooseEmailSummary(accepted, "send").emailSummary.state, "send");
});

test("a contradictory policy locator supplied after verification revokes the same-party authorization", () => {
  const result = applyObservation(verifyMargaret(), obs({ identity: { policyNumber: "POL-1044" } }), data);
  assert.equal(result.session.verifiedPartyId, null);
  assert.equal(result.session.resolvedCaseId, null);
  assert.equal(result.session.verificationSubjectPartyId, "P9");
});

test("POST_PROCESS closes a pending transfer offer so terse yes belongs to email consent", async () => {
  let session = offerHumanTransfer(verifyMargaret());
  session = markCaseComplete(session);
  assert.equal(session.humanTransfer.state, "not_offered");
  assert.equal(session.emailSummary.state, "awaiting_choice");
  const model = { async observe() { throw new Error("model must not be called"); }, async phrase() { throw new Error("model must not be called"); } };
  const result = await runAgentTurn({ session, userText: "yes", data, model });
  assert.equal(result.session.emailSummary.state, "send");
  assert.deepEqual(result.events, [{ type: "email_summary_choice", choice: "send" }]);
});

test("natural human-transfer observation works and an explicit reconsideration reverses a decline", async () => {
  let session = offerHumanTransfer(verifyMargaret());
  session = chooseHumanTransfer(session, "decline");
  const model = {
    async observe() { return obs({ humanTransferChoice: "accept" }); },
    async phrase({ plan }) { return plan.task; },
  };
  const result = await runAgentTurn({ session, userText: "Actually, I'd like to speak with a representative, please.", data, model, asOfDate: "2026-02-01" });
  assert.equal(result.session.humanTransfer.state, "requested");
  assert.equal(result.events.some(e => e.type === "human_transfer_requested"), true);
});

test("mandatory representative path reopens a previously declined human choice", () => {
  let session = offerHumanTransfer(verifyMargaret());
  session = chooseHumanTransfer(session, "decline");
  assert.equal(session.humanTransfer.state, "declined");
  const result = applyObservation(session, obs({ callerRole: "representative" }), data);
  assert.equal(result.session.verifiedPartyId, null);
  assert.equal(result.session.resolvedCaseId, null);
  assert.equal(result.session.humanTransfer.state, "awaiting_choice");
  assert.equal(result.session.humanTransferOffered, true);
});

test("mandatory representative path preserves an already requested handoff", () => {
  let session = offerHumanTransfer(verifyMargaret());
  session = chooseHumanTransfer(session, "accept");
  const result = applyObservation(session, obs({ callerRole: "representative" }), data);
  assert.equal(result.session.verifiedPartyId, null);
  assert.equal(result.session.humanTransfer.state, "requested");
  assert.equal(result.session.humanTransferOffered, true);
});

test("representative disclosure while email consent is awaiting makes human the sole active choice", () => {
  let session = offerHumanTransfer(verifyMargaret());
  session = chooseHumanTransfer(session, "decline");
  session = markCaseComplete(session);
  assert.equal(session.emailSummary.state, "awaiting_choice");
  assert.equal(session.humanTransfer.state, "declined");
  const result = applyObservation(session, obs({ callerRole: "representative" }), data);
  assert.equal(result.session.emailSummary.state, "not_offered");
  assert.equal(result.session.humanTransfer.state, "awaiting_choice");
  const awaitingCount = [result.session.emailSummary.state, result.session.humanTransfer.state]
    .filter((state) => state === "awaiting_choice").length;
  assert.equal(awaitingCount, 1);
});

test("substantive POST_PROCESS turn re-enters selected claim and later end-case offers email again", async () => {
  let session = markCaseComplete(verifyMargaret({ intent: "status_inquiry" }));
  const model = {
    observations: [obs({ intent: "denial_question" }), obs({ intent: "end_case" })],
    async observe() { return this.observations.shift(); },
    async phrase({ plan }) { return plan.task; },
  };
  let result = await runAgentTurn({ session, userText: "Wait, one more thing. Why was it denied?", data, model, asOfDate: "2026-02-01" });
  assert.equal(result.session.phase, "PROCESS_CASE");
  assert.equal(result.session.resolvedCaseId, "CL-2048");
  assert.equal(result.session.emailSummary.state, "not_offered");
  session = result.session;
  result = await runAgentTurn({ session, userText: "That's all now.", data, model, asOfDate: "2026-02-01" });
  assert.equal(result.session.phase, "POST_PROCESS");
  assert.equal(result.session.emailSummary.state, "awaiting_choice");
});
