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
    intent: "denial_question",
    scope: "in_scope",
  }, data);

  const plan = buildResponsePlan({
    session: advanced.session,
    observation: { emotion: "neutral", refusal: false, scope: "in_scope" },
    userText: "Why was it denied?",
    data,
    asOfDate: "2026-02-01",
  });

  assert.equal(plan.grounding.claim.case_id, "CL-2048");
  assert.equal(plan.grounding.claim.party_id, "P9");
  assert.equal(JSON.stringify(plan).includes("CL-3001"), false);
});

test("document aliases recover the detailed supplied guidance", () => {
  const advanced = applyObservation(newSession(), {
    identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472" },
    caseHint: { caseId: "CL-2048" },
    intent: "document_submission",
    scope: "in_scope",
  }, data);

  const grounding = buildCaseGrounding(
    advanced.session,
    "What if I can't get the pathology report?",
    data,
    { asOfDate: "2026-02-01" },
  );
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

test("expired appeal keeps claim facts but fences the ordinary submission path", () => {
  const advanced = applyObservation(newSession(), {
    identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472" },
    caseHint: { caseId: "CL-2048" },
    intent: "next_steps",
    scope: "in_scope",
  }, data);

  const grounding = buildCaseGrounding(
    advanced.session,
    "Wait, March 18 already passed. What am I supposed to do now?",
    data,
    { asOfDate: "2026-09-15" },
  );

  assert.deepEqual(grounding.temporal.appealDeadline, { date: "2026-03-18", status: "expired" });
  assert.equal(grounding.applicability.ordinarySubmissionPath, "unsupported_after_deadline");
  assert.equal(grounding.applicability.lateAppealRuleAvailable, false);
  assert.equal(grounding.applicability.recommendedEscalation, "human_representative");
  assert.equal(grounding.defaultGuidance, null);
  assert.equal(grounding.caseTypeGuidance, null);
  assert.equal(grounding.followupGuidance.length, 0);
  assert.equal(grounding.followupFallback, null);
  assert.equal(grounding.processingTimeAfterSubmission, null);
  assert.equal(grounding.documentGuidance.every((item) => item.alternative === null), true);
  assert.match(grounding.documentGuidance[0].guidance, /pathology report/i);
});

test("pre-deadline claim still exposes ordinary submission guidance", () => {
  const advanced = applyObservation(newSession(), {
    identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472" },
    caseHint: { caseId: "CL-2048" },
    intent: "document_submission",
    scope: "in_scope",
  }, data);

  const grounding = buildCaseGrounding(
    advanced.session,
    "How long does it take after I submit?",
    data,
    { asOfDate: "2026-02-01" },
  );

  assert.equal(grounding.temporal.appealDeadline.status, "future");
  assert.equal(grounding.applicability.ordinarySubmissionPath, "supported");
  assert.match(grounding.defaultGuidance, /member portal/i);
  assert.match(grounding.processingTimeAfterSubmission, /less than a week/i);
  assert.equal(grounding.followupGuidance.some((item) => item.topic === "processing_time_after_submission"), true);
});

test("expired appeal response plan requires human escalation and forbids normal re-review promises", async () => {
  const model = {
    async observe() {
      return {
        identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472" },
        callerRole: "policyholder",
        caseHint: { caseType: "healthcare", status: "denied", month: 1 },
        intent: "next_steps",
        postProcessChoice: "unknown",
        emotion: "anxious",
        refusal: false,
        scope: "in_scope",
      };
    },
    async phrase({ plan }) {
      assert.equal(plan.task, "explain_expired_appeal_and_offer_human");
      assert.equal(plan.humanTransferOffered, true);
      assert.equal(plan.conversationPolicy.ordinarySubmissionPathIsCurrent, false);
      assert.equal(plan.conversationPolicy.doNotPromiseReReviewOrNormalProcessingTime, true);
      assert.equal(plan.grounding.processingTimeAfterSubmission, null);
      assert.equal(plan.grounding.followupFallback, null);
      return "The listed appeal deadline has passed, and I do not have a supported late-appeal rule here. I can connect you with a representative to review available options.";
    },
  };

  const result = await runAgentTurn({
    session: newSession(),
    userText: "I'm Margaret Chen, DOB 1985-03-15, last four 4472. I'm calling about my denied healthcare claim from January. What do I do now?",
    data,
    model,
    asOfDate: "2026-09-15",
  });

  assert.equal(result.session.humanTransferOffered, true);
  assert.equal(result.view.humanTransferOffered, true);
  assert.equal(result.events.some((event) => event.type === "expired_appeal_requires_human"), true);
});
