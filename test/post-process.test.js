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
    intent: "status_inquiry",
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

test("pre-deadline email preview keeps the active document-submission path", () => {
  let session = applyObservation(newSession(), {
    identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472" },
    caseHint: { caseId: "CL-2048" },
    intent: "denial_question",
    scope: "in_scope",
  }, data).session;

  session.phase = "POST_PROCESS";
  session.emailSummary.state = "send";

  const preview = buildEmailPreview(session, data, [
    { observation: { intent: "denial_question" } },
    { observation: { intent: "next_steps" } },
  ], { asOfDate: "2026-03-01" });

  assert.equal(preview.to, "margaret@email.com");
  assert.match(preview.subject, /CL-2048/);
  assert.match(preview.body, /Claim status\/outcome: denied/i);
  assert.match(preview.body, /Provide: pathology report, office note/i);
  assert.match(preview.body, /Appeal deadline: 2026-03-18/i);
});

test("expired appeal email preview does not reactivate document submission", () => {
  let session = applyObservation(newSession(), {
    identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472" },
    caseHint: { caseId: "CL-2048" },
    intent: "denial_question",
    scope: "in_scope",
  }, data).session;

  session.phase = "POST_PROCESS";
  session.emailSummary.state = "send";
  session.humanTransfer = { state: "declined" };
  session.humanTransferOffered = true;

  const preview = buildEmailPreview(session, data, [
    { observation: { intent: "denial_question" } },
  ], { asOfDate: "2026-09-15" });

  assert.match(preview.body, /appeal deadline \(2026-03-18\) has passed/i);
  assert.match(preview.body, /No supported late-appeal or reopening path/i);
  assert.match(preview.body, /human representative was offered and declined/i);
  assert.doesNotMatch(preview.body, /Provide: pathology report, office note/i);
});

test("requested human handoff is summarized without claiming a live transfer", () => {
  let session = applyObservation(newSession(), {
    identity: { name: "Margaret Chen", dob: "1985-03-15", idLast4: "4472" },
    caseHint: { caseId: "CL-2048" },
    intent: "status_inquiry",
    scope: "in_scope",
  }, data).session;

  session.phase = "POST_PROCESS";
  session.emailSummary.state = "send";
  session.humanTransfer = { state: "requested" };
  session.humanTransferOffered = true;

  const preview = buildEmailPreview(session, data, [], { asOfDate: "2026-09-15" });

  assert.match(preview.body, /handoff was requested in the demo/i);
  assert.match(preview.body, /no live transfer occurred/i);
});
