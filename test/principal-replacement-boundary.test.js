import test from "node:test";
import assert from "node:assert/strict";

import { applyObservation, newSession } from "../src/controller.js";
import { loadFixtures } from "../src/data.js";
import { buildObservationContext } from "../src/observation-context.js";

const data = loadFixtures();

function observation(overrides = {}) {
  return {
    identity: {},
    callerRole: "policyholder",
    identityPrincipalChange: false,
    caseHint: {},
    caseTargetChange: false,
    intent: "unknown",
    humanTransferChoice: "unknown",
    postProcessChoice: "unknown",
    emotion: "neutral",
    refusal: false,
    scope: "in_scope",
    ...overrides,
  };
}

function verifiedMargaretAuto() {
  return applyObservation(newSession(), observation({
    identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472" },
    caseHint: { caseType: "auto", month: 2 },
    intent: "status_inquiry",
  }), data).session;
}

test("principal replacement quarantines stale prior-principal case hint and intent", () => {
  const result = applyObservation(verifiedMargaretAuto(), observation({
    identityPrincipalChange: true,
    identity: { name: "Ava Lopez" },
    caseHint: { caseType: "auto", month: 2 },
    intent: "status_inquiry",
  }), data);

  assert.equal(result.session.phase, "VERIFY_ID");
  assert.equal(result.session.verifiedPartyId, null);
  assert.equal(result.session.verificationSubjectPartyId, null);
  assert.equal(result.session.principalReplacementPending, true);
  assert.deepEqual(result.session.identity, { name: "Ava Lopez" });
  assert.deepEqual(result.session.caseHint, {});
  assert.equal(result.session.intent, null);
  assert.equal(result.session.resolvedCaseId, null);

  const context = buildObservationContext(result.session, "Thanks, Ava. Please provide two more fields.");
  assert.equal(context.freshPrincipalVerification, true);
});

test("PII-only follow-up cannot restart the principal epoch or erase the replacement name", () => {
  let session = applyObservation(verifiedMargaretAuto(), observation({
    identityPrincipalChange: true,
    identity: { name: "Ava Lopez" },
  }), data).session;

  const result = applyObservation(session, observation({
    // Simulate a model false-positive carried from the previous turn.
    identityPrincipalChange: true,
    identity: { dob: "1990-08-21", idLast4: "9180" },
    caseHint: { caseType: "auto", month: 2 },
    intent: "status_inquiry",
  }), data);

  assert.equal(result.session.verifiedPartyId, "P7");
  assert.equal(result.session.verificationSubjectPartyId, "P7");
  assert.equal(result.session.principalReplacementPending, false);
  assert.equal(result.session.phase, "RESOLVE_INTENT");
  assert.deepEqual(result.session.identity, {
    name: "Ava Lopez",
    dob: "1990-08-21",
    idLast4: "9180",
  });
  assert.deepEqual(result.session.caseHint, {});
  assert.equal(result.session.intent, null);
  assert.equal(result.session.resolvedCaseId, null);
});

test("principal replacement can carry a new claim goal only through explicit target replacement", () => {
  const result = applyObservation(verifiedMargaretAuto(), observation({
    identityPrincipalChange: true,
    identity: { name: "Ava Lopez" },
    caseTargetChange: true,
    caseHint: { caseType: "dental" },
    intent: "status_inquiry",
  }), data);

  assert.equal(result.session.principalReplacementPending, true);
  assert.deepEqual(result.session.identity, { name: "Ava Lopez" });
  assert.deepEqual(result.session.caseHint, { caseType: "dental" });
  assert.equal(result.session.intent, "status_inquiry");
});
