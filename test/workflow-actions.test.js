import test from "node:test";
import assert from "node:assert/strict";

import { runAgentTurn } from "../src/agent.js";
import { applyObservation, markCaseComplete, newSession } from "../src/controller.js";
import { loadFixtures } from "../src/data.js";

const data = loadFixtures();

function noModel() {
  return {
    async observe() { throw new Error("model must not be called for an explicit workflow button"); },
    async phrase() { throw new Error("model must not be called for an explicit workflow button"); },
  };
}

async function expiredAppealSession() {
  const model = {
    async observe() {
      return {
        identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472" },
        callerRole: "policyholder",
        caseHint: { caseType: "healthcare", status: "denied", month: 1 },
        intent: "denial_question",
        postProcessChoice: "unknown",
        emotion: "neutral",
        refusal: false,
        scope: "in_scope",
      };
    },
    async phrase() { return "Would you like a human representative?"; },
  };
  return runAgentTurn({
    session: newSession(),
    userText: "I'm Margaret Chen, DOB 1985-03-15, last four 4472, about my denied January healthcare claim.",
    data,
    model,
    asOfDate: "2026-09-15",
  });
}

function postProcessSession() {
  const advanced = applyObservation(newSession(), {
    identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472" },
    callerRole: "policyholder",
    caseHint: { caseId: "CL-2048" },
    scope: "in_scope",
  }, data);
  return markCaseComplete(advanced.session);
}

test("Request human representative button phrase is handled without a model call", async () => {
  const first = await expiredAppealSession();
  const result = await runAgentTurn({
    session: first.session,
    userText: "request human representative",
    data,
    model: noModel(),
    asOfDate: "2026-09-15",
  });

  assert.equal(result.session.humanTransfer.state, "requested");
  assert.deepEqual(result.events, [{ type: "human_transfer_requested" }]);
});

test("Continue here button phrase declines pending transfer without a model call", async () => {
  const first = await expiredAppealSession();
  const result = await runAgentTurn({
    session: first.session,
    userText: "continue here",
    data,
    model: noModel(),
    asOfDate: "2026-09-15",
  });

  assert.equal(result.session.humanTransfer.state, "declined");
  assert.deepEqual(result.events, [{ type: "human_transfer_declined" }]);
});

test("Send email summary button phrase settles consent without a model call", async () => {
  const result = await runAgentTurn({
    session: postProcessSession(),
    userText: "send email summary",
    data,
    model: noModel(),
  });

  assert.equal(result.session.emailSummary.state, "send");
  assert.deepEqual(result.events, [{ type: "email_summary_choice", choice: "send" }]);
});

test("Skip email button phrase settles consent without a model call", async () => {
  const result = await runAgentTurn({
    session: postProcessSession(),
    userText: "skip email",
    data,
    model: noModel(),
  });

  assert.equal(result.session.emailSummary.state, "skip");
  assert.deepEqual(result.events, [{ type: "email_summary_choice", choice: "skip" }]);
});
