import test from "node:test";
import assert from "node:assert/strict";

import { loadFixtures } from "../src/data.js";
import {
  applyObservation,
  chooseEmailSummary,
  markCaseComplete,
  newSession,
  publicView,
} from "../src/controller.js";
import { PHASES } from "../src/domain.js";

const data = loadFixtures();

function apply(session, observation) {
  return applyObservation(session, observation, data);
}

test("Margaret verifies with three PII fields and reuses the earlier case hint", () => {
  const result = apply(newSession(), {
    identity: {
      name: "Margaret Chen",
      policyNumber: "POL-9921",
      dob: "1985-03-15",
      idLast4: "4472",
    },
    caseHint: { caseType: "healthcare", status: "denied", month: 1 },
    intent: "denial_question",
    scope: "in_scope",
  });

  assert.equal(result.session.verifiedPartyId, "P9");
  assert.deepEqual(result.session.verification.matchingFields.sort(), ["dob", "idLast4", "name"]);
  assert.equal(result.session.resolvedCaseId, "CL-2048");
  assert.equal(result.session.phase, PHASES.PROCESS_CASE);
  assert.deepEqual(result.events, [
    { type: "identity_verified", partyId: "P9" },
    { type: "case_resolved", caseId: "CL-2048" },
  ]);
});

test("case hints are remembered during partial verification without unlocking claim data", () => {
  const result = apply(newSession(), {
    identity: { name: "Margaret Chen", dob: "1985-03-15" },
    caseHint: { caseType: "healthcare", status: "denied", month: 1 },
    scope: "in_scope",
  });

  assert.equal(result.session.phase, PHASES.VERIFY_ID);
  assert.equal(result.session.verifiedPartyId, null);
  assert.deepEqual(result.session.caseHint, { caseType: "healthcare", status: "denied", month: 1 });
  assert.equal(result.view.claimAccess, "locked");
  assert.equal(result.view.resolvedClaim, null);
});

test("policy number does not count toward the three-PII gate", () => {
  const result = apply(newSession(), {
    identity: { name: "Margaret Chen", dob: "1985-03-15", policyNumber: "POL-9921" },
    scope: "in_scope",
  });

  assert.equal(result.session.phase, PHASES.VERIFY_ID);
  assert.deepEqual(result.session.verification.matchingFields.sort(), ["dob", "name"]);
});

test("identity facts can arrive over several turns", () => {
  let session = apply(newSession(), {
    identity: { name: "Margaret Chen" },
    caseHint: { caseType: "healthcare", status: "denied", month: 1 },
    intent: "denial_question",
    scope: "in_scope",
  }).session;

  session = apply(session, { identity: { dob: "1985-03-15" }, scope: "in_scope" }).session;
  assert.equal(session.phase, PHASES.VERIFY_ID);

  session = apply(session, { identity: { phone: "650-521-2836" }, scope: "in_scope" }).session;
  assert.equal(session.verifiedPartyId, "P9");
  assert.equal(session.resolvedCaseId, "CL-2048");
  assert.equal(session.phase, PHASES.PROCESS_CASE);
});

test("name and email aliases remain ordinary deterministic identity matches", () => {
  const result = apply(newSession(), {
    identity: {
      name: "Yaven Li",
      dob: "1989-12-03",
      email: "yawen.li@example.com",
    },
    scope: "in_scope",
  });

  assert.equal(result.session.verifiedPartyId, "P13");
  assert.deepEqual(result.session.verification.matchingFields.sort(), ["dob", "email", "name"]);
  assert.equal(result.session.phase, PHASES.RESOLVE_INTENT);
});

test("national ID last four does not count toward the assignment's SSN-based PII gate", () => {
  let result = apply(newSession(), {
    identity: { name: "Ma Tian", dob: "1964-09-10", idLast4: "6688" },
    scope: "in_scope",
  });

  assert.equal(result.session.verifiedPartyId, null);
  assert.equal(result.session.phase, PHASES.VERIFY_ID);
  assert.deepEqual(result.session.verification.matchingFields.sort(), ["dob", "name"]);

  result = apply(result.session, {
    identity: { phone: "650-208-8799" },
    scope: "in_scope",
  });
  assert.equal(result.session.verifiedPartyId, "P12");
  assert.deepEqual(result.session.verification.matchingFields.sort(), ["dob", "name", "phone"]);
  assert.equal(result.session.phase, PHASES.RESOLVE_INTENT);
});

test("an ambiguous remembered hint stops in RESOLVE_INTENT", () => {
  const result = apply(newSession(), {
    identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472" },
    caseHint: { caseType: "healthcare", month: 1 },
    scope: "in_scope",
  });

  assert.equal(result.session.phase, PHASES.RESOLVE_INTENT);
  assert.equal(result.session.resolvedCaseId, null);
  assert.equal(result.session.caseResolution.status, "ambiguous");
  assert.deepEqual(result.session.caseResolution.candidateCaseIds.sort(), ["CL-2011", "CL-2048"]);
});

test("mixed and irrelevant turns keep useful facts while eventually offering a human", () => {
  let session = apply(newSession(), {
    identity: { name: "Margaret Chen" },
    scope: "mixed",
  }).session;
  session = apply(session, { identity: { dob: "1985-03-15" }, scope: "out_of_scope" }).session;
  session = apply(session, { scope: "out_of_scope" }).session;
  session = apply(session, { scope: "out_of_scope" }).session;

  assert.equal(session.identity.name, "Margaret Chen");
  assert.equal(session.identity.dob, "1985-03-15");
  assert.equal(session.phase, PHASES.VERIFY_ID);
  assert.equal(session.outOfScopeAttempts, 3);
  assert.equal(session.humanTransferOffered, true);
});

test("POST_PROCESS requires an explicit send or skip choice", () => {
  let session = apply(newSession(), {
    identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472" },
    caseHint: { caseId: "CL-2048" },
    intent: "status_inquiry",
    scope: "in_scope",
  }).session;

  session = markCaseComplete(session);
  assert.equal(session.phase, PHASES.POST_PROCESS);
  assert.equal(session.emailSummary.state, "awaiting_choice");

  assert.throws(() => chooseEmailSummary(session, "maybe"));
  assert.equal(chooseEmailSummary(session, "send").emailSummary.state, "send");
  assert.equal(chooseEmailSummary(session, "skip").emailSummary.state, "skip");
});

test("public view cannot leak a claim before verification", () => {
  const session = newSession();
  session.resolvedCaseId = "CL-2048";
  const view = publicView(session, data);
  assert.equal(view.claimAccess, "locked");
  assert.equal(view.resolvedClaim, null);
});
