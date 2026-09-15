import test from "node:test";
import assert from "node:assert/strict";

import { applyObservation, newSession } from "../src/controller.js";
import { loadFixtures } from "../src/data.js";

const data = loadFixtures();

test("representative callers cannot inherit policyholder authority from known PII", () => {
  const result = applyObservation(newSession(), {
    callerRole: "representative",
    identity: {
      name: "Margaret Chen",
      dob: "1985-03-15",
      idLast4: "4472",
      policyNumber: "POL-9921",
    },
    caseHint: { caseId: "CL-2048" },
    scope: "in_scope",
  }, data);

  assert.equal(result.session.phase, "VERIFY_ID");
  assert.equal(result.session.verifiedPartyId, null);
  assert.equal(result.view.claimAccess, "locked");
  assert.equal(result.session.humanTransferOffered, true);
  assert.deepEqual(result.events, [{ type: "representative_requires_human" }]);
});
