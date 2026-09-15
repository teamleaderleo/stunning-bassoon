import test from "node:test";
import assert from "node:assert/strict";

import { runAgentTurn } from "../src/agent.js";
import { newSession } from "../src/controller.js";
import { loadFixtures } from "../src/data.js";

const data = loadFixtures();

function margaretObservation() {
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
}

async function expiredAppealSession() {
  const model = {
    async observe() { return margaretObservation(); },
    async phrase() { return "The appeal deadline has passed. Would you like a human representative?"; },
  };
  return runAgentTurn({
    session: newSession(),
    userText: "I'm Margaret Chen, DOB 1985-03-15, last four 4472, about my denied January healthcare claim.",
    data,
    model,
    asOfDate: "2026-09-15",
  });
}

test("bare yes accepts a pending human transfer without calling the model", async () => {
  const first = await expiredAppealSession();
  assert.equal(first.session.humanTransfer.state, "awaiting_choice");

  const model = {
    async observe() { throw new Error("model must not be called"); },
    async phrase() { throw new Error("model must not be called"); },
  };
  const result = await runAgentTurn({
    session: first.session,
    userText: "yes",
    data,
    model,
    previousAssistantText: first.text,
    asOfDate: "2026-09-15",
  });

  assert.equal(result.session.phase, "PROCESS_CASE");
  assert.equal(result.session.humanTransfer.state, "requested");
  assert.deepEqual(result.events, [{ type: "human_transfer_requested" }]);
  assert.match(result.text, /no live transfer has occurred/i);
  assert.equal(result.view.humanTransfer.state, "requested");
});

test("bare no declines a pending human transfer without calling the model", async () => {
  const first = await expiredAppealSession();
  const model = {
    async observe() { throw new Error("model must not be called"); },
    async phrase() { throw new Error("model must not be called"); },
  };
  const result = await runAgentTurn({
    session: first.session,
    userText: "no thanks",
    data,
    model,
    previousAssistantText: first.text,
    asOfDate: "2026-09-15",
  });

  assert.equal(result.session.humanTransfer.state, "declined");
  assert.deepEqual(result.events, [{ type: "human_transfer_declined" }]);
  assert.match(result.text, /won't request a human representative/i);
});

test("yes outside a pending human-transfer choice still goes through normal interpretation", async () => {
  let observeCalls = 0;
  const model = {
    async observe() {
      observeCalls += 1;
      return {
        identity: {},
        callerRole: "unknown",
        caseHint: {},
        intent: "unknown",
        postProcessChoice: "unknown",
        emotion: "neutral",
        refusal: false,
        scope: "in_scope",
      };
    },
    async phrase() { return "How can I help with your claim?"; },
  };

  const result = await runAgentTurn({
    session: newSession(),
    userText: "yes",
    data,
    model,
  });

  assert.equal(observeCalls, 1);
  assert.equal(result.session.humanTransfer.state, "not_offered");
  assert.equal(result.session.phase, "VERIFY_ID");
});
