import test from "node:test";
import assert from "node:assert/strict";

import { runAgentTurn } from "../src/agent.js";
import { applyObservation, newSession } from "../src/controller.js";
import { loadFixtures } from "../src/data.js";
import { buildEmailPreview } from "../src/email.js";

const data = loadFixtures();

test("end_case and explicit email consent move through POST_PROCESS under code control", async () => {
  let session = applyObservation(newSession(), {
    identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472" },
    caseHint: { caseId: "CL-2048" },
    scope: "in_scope",
  }, data).session;

  const observations = [
    {
      identity: {}, callerRole: "policyholder", caseHint: {}, intent: "end_case",
      postProcessChoice: "unknown", emotion: "neutral", refusal: false, scope: "in_scope",
    },
    {
      identity: {}, callerRole: "policyholder", caseHint: {}, intent: "unknown",
      postProcessChoice: "send", emotion: "neutral", refusal: false, scope: "in_scope",
    },
  ];
  const model = {
    async observe() { return observations.shift(); },
    async phrase({ plan }) { return plan.task; },
  };

  let result = await runAgentTurn({ session, userText: "Thanks, that's all.", data, model });
  session = result.session;
  assert.equal(session.phase, "POST_PROCESS");
  assert.equal(session.emailSummary.state, "awaiting_choice");
  assert.equal(result.plan.task, "offer_or_resolve_email_summary_choice");

  result = await runAgentTurn({ session, userText: "Yes, send it.", data, model });
  assert.equal(result.session.emailSummary.state, "send");
  assert.deepEqual(result.events.at(-1), { type: "email_summary_choice", choice: "send" });
});

test("email preview is built only after explicit send consent from grounded case data", () => {
  let session = applyObservation(newSession(), {
    identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472" },
    caseHint: { caseId: "CL-2048" },
    scope: "in_scope",
  }, data).session;

  session.phase = "POST_PROCESS";
  session.emailSummary.state = "send";

  const preview = buildEmailPreview(session, data, [
    { observation: { intent: "denial_question" } },
    { observation: { intent: "next_steps" } },
  ]);

  assert.equal(preview.to, "margaret@email.com");
  assert.match(preview.subject, /CL-2048/);
  assert.match(preview.body, /Claim status\/outcome: denied/i);
  assert.match(preview.body, /pathology report, office note/i);
  assert.match(preview.body, /2026-03-18/);
});
