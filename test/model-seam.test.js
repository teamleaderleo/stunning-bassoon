import test from "node:test";
import assert from "node:assert/strict";

import { runAgentTurn } from "../src/agent.js";
import { applyObservation, newSession } from "../src/controller.js";
import { loadFixtures } from "../src/data.js";
import { buildCaseGrounding } from "../src/grounding.js";
import { buildResponsePlan } from "../src/response-plan.js";

const data = loadFixtures();

test("pre-verification response plan contains no authoritative claim object", async () => {
  const model = {
    async observe() {
      return {
        identity: { name: "Margaret Chen", dob: "1985-03-15" },
        callerRole: "policyholder",
        caseHint: { caseType: "healthcare", status: "denied", month: 1 },
        intent: "denial_question",
        emotion: "frustrated",
        refusal: false,
        scope: "in_scope",
      };
    },
    async phrase({ plan }) {
      assert.equal(plan.protectedClaimDetailsAvailable, false);
      assert.equal("grounding" in plan, false);
      assert.equal(JSON.stringify(plan).includes("CL-2048"), false);
      return "I can help with that once we finish verification.";
    },
  };

  const result = await runAgentTurn({
    session: newSession(),
    userText: "I'm Margaret, why was my denied January healthcare claim denied? DOB 1985-03-15.",
    data,
    model,
  });

  assert.equal(result.session.verifiedPartyId, null);
  assert.equal(result.plan.task, "continue_identity_verification");
  assert.deepEqual(result.plan.rememberedCaseHint, { caseType: "healthcare", status: "denied", month: 1 });
});

test("PROCESS_CASE grounding is restricted to the selected verified claim", () => {
  const advanced = applyObservation(newSession(), {
    identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472" },
    caseHint: { caseId: "CL-2048" },
    scope: "in_scope",
  }, data);

  const plan = buildResponsePlan({
    session: advanced.session,
    observation: { emotion: "neutral", refusal: false, scope: "in_scope" },
    userText: "Why was it denied?",
    data,
  });

  assert.equal(plan.grounding.claim.case_id, "CL-2048");
  assert.equal(plan.grounding.claim.party_id, "P9");
  assert.equal(JSON.stringify(plan).includes("CL-3001"), false);
});

test("document aliases recover the detailed supplied guidance", () => {
  const advanced = applyObservation(newSession(), {
    identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472" },
    caseHint: { caseId: "CL-2048" },
    scope: "in_scope",
  }, data);

  const grounding = buildCaseGrounding(advanced.session, "What if I can't get the pathology report?", data);
  const pathology = grounding.documentGuidance.find((item) => item.requestedDocument === "pathology report");
  const office = grounding.documentGuidance.find((item) => item.requestedDocument === "office note");

  assert.equal(pathology.guidanceKey, "original pathology report");
  assert.match(pathology.alternative, /hospital, lab, or treating provider/i);
  assert.equal(office.guidanceKey, "treating provider office note");
  assert.match(office.guidance, /visit date/i);
});

test("mixed-scope plan retains SOP work and explicitly declines the unrelated portion", () => {
  const advanced = applyObservation(newSession(), {
    identity: { name: "Margaret Chen" },
    scope: "mixed",
  }, data);

  const plan = buildResponsePlan({
    session: advanced.session,
    observation: { emotion: "neutral", refusal: false, scope: "mixed" },
    userText: "My name is Margaret Chen. Also what is reinforcement learning?",
    data,
  });

  assert.equal(plan.scope.mode, "answer_in_scope_and_decline_unrelated_part");
  assert.equal(plan.task, "continue_identity_verification");
  assert.deepEqual(plan.rememberedCaseHint, {});
});
