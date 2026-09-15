import test from "node:test";
import assert from "node:assert/strict";

import { createOpenAIModel } from "../src/model.js";

test("OpenAI observation request includes the bounded dialogue context", async () => {
  let captured;
  const observation = {
    identity: { name: null, dob: null, phone: null, email: null, idLast4: "4472", policyNumber: null },
    callerRole: "unknown",
    identityPrincipalChange: false,
    caseHint: { caseId: null, caseType: null, status: null, month: null, year: null },
    caseTargetChange: false,
    intent: "unknown",
    humanTransferChoice: "unknown",
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
  assert.equal(result.identityPrincipalChange, false);
  const body = JSON.parse(captured.options.body);
  assert.match(captured.url, /\/responses$/);
  assert.equal(body.store, false);
  assert.equal(body.model, "test-model");
  assert.match(body.instructions, /identityPrincipalChange/);
  assert.match(body.instructions, /wrong identity/i);
  const prompt = body.input[0].content[0].text;
  assert.match(prompt, /Bounded dialogue context/);
  assert.match(prompt, /VERIFY_ID/);
  assert.match(prompt, /last four digits/);
  assert.match(prompt, /Caller turn:\n4472/);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
});

const valid = () => ({
  identity: { name: null, dob: null, phone: null, email: null, idLast4: null, policyNumber: null },
  callerRole: "unknown",
  identityPrincipalChange: false,
  caseHint: { caseId: null, caseType: null, status: null, month: null, year: null },
  caseTargetChange: false,
  intent: "unknown",
  humanTransferChoice: "unknown",
  postProcessChoice: "unknown",
  emotion: "neutral",
  refusal: false,
  scope: "in_scope",
});

function mockModel(payload, options = {}) {
  return createOpenAIModel({ apiKey: "test-key", model: "test-model",
    fetchImpl: async () => ({ ok: true, json: async () => payload }), ...options });
}

test("Go Responses uses bearer auth, stable session, schema extraction and bounded phrasing", async () => {
  const calls = [];
  const model = mockModel(null, {
    baseUrl: "https://opencode.ai/zen/go/v1/", model: "muse-spark-1.3-contributor", sessionId: "conversation-1",
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ status: "completed", output: [{ type: "message", content: [
        { type: "output_text", text: calls.length === 1 ? JSON.stringify(valid()) : "Please provide your name." },
      ] }] }) };
    },
  });
  await model.observe("Hello");
  assert.equal(await model.phrase({ userText: "Hello", plan: { ask: "name" } }), "Please provide your name.");
  for (const call of calls) {
    assert.equal(call.url, "https://opencode.ai/zen/go/v1/responses");
    assert.equal(call.headers.authorization, "Bearer test-key");
    assert.equal(call.headers["x-opencode-session"], "conversation-1");
    assert.equal(call.headers["user-agent"], "stunning-bassoon/0.1.0");
    assert.equal(call.body.store, false);
    assert.equal(call.body.model, "muse-spark-1.3-contributor");
  }
  assert.equal(calls[0].body.text.format.strict, true);
  assert.equal(calls[1].body.text, undefined);
  assert.match(calls[1].body.input[0].content[0].text, /Response plan:/);
});

for (const [name, mutate] of [
  ["extra authority", v => { v.verified = true; }],
  ["nested authority", v => { v.identity.verified = true; }],
  ["wrong identity type", v => { v.identity.name = 42; }],
  ["missing nullable field", v => { delete v.identity.dob; }],
  ["invalid principal change", v => { v.identityPrincipalChange = "yes"; }],
  ["invalid case enum", v => { v.caseHint.status = "approved"; }],
  ["fractional month", v => { v.caseHint.month = 1.5; }],
  ["month bounds", v => { v.caseHint.month = 13; }],
  ["year bounds", v => { v.caseHint.year = 1999; }],
  ["invalid case target change", v => { v.caseTargetChange = "yes"; }],
  ["invalid intent", v => { v.intent = "verify"; }],
  ["invalid human transfer choice", v => { v.humanTransferChoice = true; }],
  ["invalid consent", v => { v.postProcessChoice = true; }],
]) {
  test(`local schema rejects ${name}`, async () => {
    const value = valid(); mutate(value);
    await assert.rejects(mockModel({ output_text: JSON.stringify(value) }).observe("Hello"));
  });
}

for (const payload of [
  { output_text: "not JSON" }, { output_text: "{}" }, { output: [] },
  { output_text: JSON.stringify(valid()), output: [{ type: "message", content: [{ type: "refusal" }] }] },
  { status: "incomplete", output_text: JSON.stringify(valid()) },
  { error: { message: "private" }, output_text: JSON.stringify(valid()) },
  { output: [{ type: "message", content: [{ type: "refusal", refusal: "No" }] }] },
]) {
  test(`rejects malformed, refused or incomplete output: ${JSON.stringify(payload)}`, async () => {
    await assert.rejects(mockModel(payload).observe("Hello"));
  });
}

test("HTTP errors do not leak provider body and are not silently retried", async () => {
  let calls = 0;
  const model = mockModel(null, { fetchImpl: async () => {
    calls++;
    return { ok: false, status: 401, text: async () => "secret credential / caller data" };
  } });
  await assert.rejects(model.observe("Hello"), { message: "model request failed (401)" });
  assert.equal(calls, 1);
});

test("provider-neutral env takes precedence over legacy variables", async () => {
  const names = ["MODEL_API_KEY", "MODEL_ID", "MODEL_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL"];
  const saved = Object.fromEntries(names.map(k => [k, process.env[k]]));
  try {
    Object.assign(process.env, { MODEL_API_KEY: "neutral", MODEL_ID: "muse-spark-1.3-contributor", MODEL_BASE_URL: "https://opencode.ai/zen/go/v1",
      OPENAI_API_KEY: "legacy", OPENAI_MODEL: "legacy", OPENAI_BASE_URL: "https://legacy.example/v1" });
    const { createModel } = await import("../src/model.js");
    const capture = async (url, options) => {
      assert.equal(url, "https://opencode.ai/zen/go/v1/responses");
      assert.equal(options.headers.authorization, "Bearer neutral");
      assert.equal(JSON.parse(options.body).model, "muse-spark-1.3-contributor");
      return { ok: true, json: async () => ({ output_text: JSON.stringify(valid()) }) };
    };
    await createModel({ fetchImpl: capture }).observe("Hello");
    for (const k of names.filter(k => k.startsWith("MODEL_"))) delete process.env[k];
    await createModel({ fetchImpl: async (url, options) => {
      assert.equal(url, "https://legacy.example/v1/responses");
      assert.equal(options.headers.authorization, "Bearer legacy");
      assert.equal(JSON.parse(options.body).model, "legacy");
      return { ok: true, json: async () => ({ output_text: JSON.stringify(valid()) }) };
    } }).observe("Hello");
  } finally {
    for (const k of names) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});


test("invalid observation cannot enter agent session state", async () => {
  const { runAgentTurn } = await import("../src/agent.js");
  const { newSession } = await import("../src/controller.js");
  const { loadFixtures } = await import("../src/data.js");
  const session = newSession();
  const before = structuredClone(session);
  const value = valid(); value.identity.name = { verified: true };
  await assert.rejects(runAgentTurn({ session, userText: "Hello", data: loadFixtures(),
    model: mockModel({ output_text: JSON.stringify(value) }) }));
  assert.deepEqual(session, before);
});

test("empty phrasing output fails closed", async () => {
  await assert.rejects(mockModel({ output_text: " " }).phrase({ userText: "Hello", plan: {} }));
});
