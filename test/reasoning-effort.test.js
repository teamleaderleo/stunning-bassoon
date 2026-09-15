import test from "node:test";
import assert from "node:assert/strict";

import { createModel } from "../src/model.js";

const observation = {
  identity: { name: null, dob: null, phone: null, email: null, idLast4: null, policyNumber: null },
  callerRole: "unknown",
  caseHint: { caseId: null, caseType: null, status: null, month: null, year: null },
  caseTargetChange: false,
  intent: "unknown",
  humanTransferChoice: "unknown",
  postProcessChoice: "unknown",
  emotion: "neutral",
  refusal: false,
  scope: "in_scope",
};

function captureModel(reasoningEffort) {
  const bodies = [];
  const model = createModel({
    apiKey: "test-key",
    model: "muse-spark-1.3-contributor",
    baseUrl: "https://opencode.ai/zen/go/v1",
    reasoningEffort,
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ output_text: JSON.stringify(observation) }) };
    },
  });
  return { model, bodies };
}

test("low reasoning effort is sent on Responses API requests", async () => {
  const { model, bodies } = captureModel("low");
  await model.observe("hello");
  assert.deepEqual(bodies[0].reasoning, { effort: "low" });
});

test("provider-default reasoning omits the reasoning field", async () => {
  const { model, bodies } = captureModel("provider-default");
  await model.observe("hello");
  assert.equal(bodies[0].reasoning, undefined);
});

test("invalid reasoning effort fails before a provider call", () => {
  assert.throws(() => createModel({ apiKey: "x", model: "y", reasoningEffort: "turbo" }), /MODEL_REASONING_EFFORT/);
});
