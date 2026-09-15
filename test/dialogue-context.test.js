import test from "node:test";
import assert from "node:assert/strict";

import { runAgentTurn } from "../src/agent.js";
import { applyObservation, markCaseComplete, newSession } from "../src/controller.js";
import { loadFixtures } from "../src/data.js";
import { buildObservationContext } from "../src/observation-context.js";
import { buildResponsePlan } from "../src/response-plan.js";

const data = loadFixtures();

function baseObservation(overrides = {}) {
  return {
    identity: {},
    callerRole: "unknown",
    caseHint: {},
    intent: "unknown",
    postProcessChoice: "unknown",
    emotion: "neutral",
    refusal: false,
    scope: "in_scope",
    ...overrides,
  };
}

test("bounded VERIFY_ID observer context carries dialogue cues without authoritative claim records", () => {
  const session = newSession();
  session.identity.name = "Margaret Chen";
  session.caseHint = { caseType: "healthcare", status: "denied", month: 1 };
  session.resolvedCaseId = "CL-2048";

  const context = buildObservationContext(session, "Could I get the last four digits of your ID?");

  assert.equal(context.phase, "VERIFY_ID");
  assert.equal(context.previousAssistantText, "Could I get the last four digits of your ID?");
  assert.equal(context.protectedClaimDetailsAvailable, false);
  assert.equal("resolvedCaseId" in context, false);
  assert.equal("claim" in context, false);
  assert.deepEqual(context.rememberedCaseHint, { caseType: "healthcare", status: "denied", month: 1 });
});

test("a terse ID-last-four reply can finish verification using the previous assistant question", async () => {
  let session = applyObservation(newSession(), baseObservation({
    callerRole: "policyholder",
    identity: { name: "Margaret Chen", dob: "1985-03-15" },
    caseHint: { caseId: "CL-2048" },
  }), data).session;

  const model = {
    async observe(text, context) {
      assert.equal(text, "4472");
      assert.equal(context.phase, "VERIFY_ID");
      assert.match(context.previousAssistantText, /last four/i);
      assert.deepEqual(context.providedIdentityFields.sort(), ["dob", "name"]);
      return baseObservation({ identity: { idLast4: "4472" } });
    },
    async phrase({ plan }) { return `[${plan.task}]`; },
  };

  const result = await runAgentTurn({
    session,
    userText: "4472",
    previousAssistantText: "Thanks. What are the last four digits of your ID?",
    data,
    model,
  });

  assert.equal(result.session.verifiedPartyId, "P9");
  assert.equal(result.session.resolvedCaseId, "CL-2048");
  assert.equal(result.session.phase, "PROCESS_CASE");
});

test("a terse yes can resolve POST_PROCESS email consent from bounded context", async () => {
  let session = applyObservation(newSession(), baseObservation({
    callerRole: "policyholder",
    identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472" },
    caseHint: { caseId: "CL-2048" },
  }), data).session;
  session = markCaseComplete(session);

  const model = {
    async observe(text, context) {
      assert.equal(text, "yes");
      assert.equal(context.phase, "POST_PROCESS");
      assert.equal(context.emailSummaryState, "awaiting_choice");
      assert.match(context.previousAssistantText, /email summary/i);
      return baseObservation({ postProcessChoice: "send" });
    },
    async phrase({ plan }) { return `[${plan.task}]`; },
  };

  const result = await runAgentTurn({
    session,
    userText: "yes",
    previousAssistantText: "Would you like me to send you an email summary?",
    data,
    model,
  });

  assert.equal(result.session.emailSummary.state, "send");
  assert.deepEqual(result.events.at(-1), { type: "email_summary_choice", choice: "send" });
});

test("ambiguous verified cases expose only bounded candidate summaries for clarification", () => {
  const session = applyObservation(newSession(), baseObservation({
    callerRole: "policyholder",
    identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472" },
    caseHint: { caseType: "healthcare", month: 1 },
  }), data).session;

  assert.equal(session.phase, "RESOLVE_INTENT");
  const plan = buildResponsePlan({
    session,
    observation: baseObservation(),
    userText: "the January one",
    data,
  });

  assert.deepEqual(plan.caseCandidates.map((candidate) => candidate.caseId).sort(), ["CL-2011", "CL-2048"]);
  assert.deepEqual(plan.caseCandidates.map((candidate) => candidate.status).sort(), ["closed", "denied"]);
  assert.equal(plan.caseCandidates.every((candidate) => Object.keys(candidate).sort().join(",") === "caseId,caseType,createdAt,status,summary"), true);
  assert.equal(JSON.stringify(plan).includes("CL-3001"), false);
});
