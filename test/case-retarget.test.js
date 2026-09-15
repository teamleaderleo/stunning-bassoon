import test from "node:test";
import assert from "node:assert/strict";

import {
  applyObservation,
  newSession,
  offerHumanTransfer,
} from "../src/controller.js";
import { loadFixtures } from "../src/data.js";

const data = loadFixtures();

function observation(overrides = {}) {
  return {
    identity: {},
    callerRole: "policyholder",
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

test("a verified caller can retarget from a resolved healthcare claim to the February auto claim", () => {
  let session = applyObservation(newSession(), observation({
    identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472" },
    caseHint: { caseId: "CL-2048", caseType: "healthcare", status: "denied", month: 1, year: 2026 },
    intent: "denial_question",
  }), data).session;

  assert.equal(session.phase, "PROCESS_CASE");
  assert.equal(session.resolvedCaseId, "CL-2048");

  session = offerHumanTransfer(session);
  assert.equal(session.humanTransfer.state, "awaiting_choice");

  const result = applyObservation(session, observation({
    caseTargetChange: true,
    caseHint: { caseType: "auto", month: 2 },
    intent: "status_inquiry",
  }), data);

  assert.equal(result.session.verifiedPartyId, "P9");
  assert.equal(result.session.phase, "PROCESS_CASE");
  assert.equal(result.session.resolvedCaseId, "CL-2102");
  assert.deepEqual(result.session.caseHint, { caseType: "auto", month: 2 });
  assert.deepEqual(result.session.caseResolution, { status: "resolved", candidateCaseIds: ["CL-2102"] });
  assert.equal(result.session.humanTransferOffered, false);
  assert.equal(result.session.humanTransfer.state, "not_offered");
  assert.deepEqual(result.events, [
    { type: "case_retargeted", fromCaseId: "CL-2048" },
    { type: "case_resolved", caseId: "CL-2102" },
  ]);
});

test("non-conflicting case hints do not discard the current resolved claim", () => {
  const session = applyObservation(newSession(), observation({
    identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472" },
    caseHint: { caseId: "CL-2048", caseType: "healthcare", status: "denied", month: 1, year: 2026 },
    intent: "denial_question",
  }), data).session;

  const result = applyObservation(session, observation({
    caseHint: { caseType: "healthcare", month: 1 },
    intent: "next_steps",
  }), data);

  assert.equal(result.session.phase, "PROCESS_CASE");
  assert.equal(result.session.resolvedCaseId, "CL-2048");
  assert.equal(result.events.some((event) => event.type === "case_retargeted"), false);
});
