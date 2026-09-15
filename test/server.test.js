import test from "node:test";
import assert from "node:assert/strict";

import { createDemoServer } from "../src/server.js";

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
});
