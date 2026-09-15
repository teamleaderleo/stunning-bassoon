import test from "node:test";
import assert from "node:assert/strict";

import { buildLastTurnInspector, createDemoServer } from "../src/server.js";

const fakeModel = {
  async observe() {
    return {
      identity: { name: "Margaret Chen", dob: "1985-03-15" },
      callerRole: "policyholder",
      caseHint: { caseType: "healthcare", status: "denied", month: 1 },
      intent: "denial_question",
      postProcessChoice: "unknown",
      emotion: "neutral",
      refusal: false,
      scope: "in_scope",
    };
  },
  async phrase() { return "Let's finish verification first."; },
};

test("demo server creates a session and serves a guarded chat turn", async (t) => {
  const server = createDemoServer({ model: fakeModel });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const markdownResponse = await fetch(`${base}/markdown.js`);
  assert.equal(markdownResponse.status, 200);
  assert.match(markdownResponse.headers.get("content-type"), /text\/javascript/);
  assert.match(await markdownResponse.text(), /renderMarkdown/);

  const sessionResponse = await fetch(`${base}/api/session`, { method: "POST" });
  assert.equal(sessionResponse.status, 200);
  const created = await sessionResponse.json();
  assert.equal(created.view.phase, "VERIFY_ID");

  const chatResponse = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: created.sessionId, text: "I'm Margaret. Why was my January claim denied? DOB 1985-03-15." }),
  });
  assert.equal(chatResponse.status, 200);
  const turn = await chatResponse.json();
  assert.equal(turn.text, "Let's finish verification first.");
  assert.equal(turn.view.claimAccess, "locked");
  assert.equal(turn.view.resolvedClaim, null);
  assert.deepEqual(turn.view.rememberedCaseHint, { caseType: "healthcare", status: "denied", month: 1 });
  assert.deepEqual(turn.lastTurn.observation.identityFields, ["name", "dob"]);
  assert.deepEqual(turn.lastTurn.observation.caseHintFields, ["caseType", "status", "month"]);
  assert.equal(turn.lastTurn.controller.phase, "VERIFY_ID");
  assert.equal(turn.lastTurn.responsePlan.task, "continue_identity_verification");
  assert.equal(JSON.stringify(turn.lastTurn).includes("Margaret Chen"), false);
  assert.equal(JSON.stringify(turn.lastTurn).includes("1985-03-15"), false);
  assert.equal(JSON.stringify(turn.lastTurn).includes("healthcare"), false);
});

test("last-turn inspector strips event payloads and observed values", () => {
  const inspector = buildLastTurnInspector({
    observation: {
      identity: { name: "Margaret Chen", idLast4: "4472" },
      caseHint: { caseId: "CL-2048", caseType: "healthcare" },
      callerRole: "policyholder",
      intent: "denial_question",
      scope: "in_scope",
      emotion: "neutral",
      humanTransferChoice: "unknown",
      postProcessChoice: "unknown",
      refusal: false,
    },
    events: [
      { type: "identity_verified", partyId: "P9" },
      { type: "case_resolved", caseId: "CL-2048" },
    ],
    plan: { task: "answer_from_grounded_case_data", phase: "PROCESS_CASE" },
    view: { phase: "PROCESS_CASE" },
  });

  assert.deepEqual(inspector.controller.events, ["identity_verified", "case_resolved"]);
  assert.deepEqual(inspector.observation.identityFields, ["name", "idLast4"]);
  assert.deepEqual(inspector.observation.caseHintFields, ["caseId", "caseType"]);
  assert.deepEqual(inspector.observation.semantics, {
    callerRole: "policyholder",
    intent: "denial_question",
    scope: "in_scope",
    emotion: "neutral",
  });
  const serialized = JSON.stringify(inspector);
  assert.doesNotMatch(serialized, /Margaret|4472|CL-2048|healthcare|P9/);
});
