import test from "node:test";
import assert from "node:assert/strict";

import { createOpenAIModel } from "../src/model.js";

test("OpenAI observation request includes the bounded dialogue context", async () => {
  let captured;
  const observation = {
    identity: { name: null, dob: null, phone: null, email: null, idLast4: "4472", policyNumber: null },
    callerRole: "unknown",
    caseHint: { caseId: null, caseType: null, status: null, month: null, year: null },
    intent: "unknown",
    postProcessChoice: "unknown",
    emotion: "neutral",
    refusal: false,
    scope: "in_scope",
  };
  const model = createOpenAIModel({
    apiKey: "test-key",
    model: "test-model",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return {
        ok: true,
        async json() { return { output_text: JSON.stringify(observation) }; },
      };
    },
  });

  const result = await model.observe("4472", {
    phase: "VERIFY_ID",
    previousAssistantText: "What are the last four digits of your ID?",
    protectedClaimDetailsAvailable: false,
  });

  assert.deepEqual(result.identity, { idLast4: "4472" });
  const body = JSON.parse(captured.options.body);
  assert.match(captured.url, /\/responses$/);
  assert.equal(body.store, false);
  assert.equal(body.model, "test-model");
  const prompt = body.input[0].content[0].text;
  assert.match(prompt, /Bounded dialogue context/);
  assert.match(prompt, /VERIFY_ID/);
  assert.match(prompt, /last four digits/);
  assert.match(prompt, /Caller turn:\n4472/);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
});
