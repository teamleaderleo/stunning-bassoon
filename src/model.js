const TURN_OBSERVATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    identity: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: ["string", "null"] },
        dob: { type: ["string", "null"], description: "Canonical YYYY-MM-DD when the caller supplied a date." },
        phone: { type: ["string", "null"] },
        email: { type: ["string", "null"] },
        idLast4: { type: ["string", "null"] },
        policyNumber: { type: ["string", "null"] }
      },
      required: ["name", "dob", "phone", "email", "idLast4", "policyNumber"]
    },
    callerRole: { type: "string", enum: ["policyholder", "representative", "unknown"] },
    caseHint: {
      type: "object",
      additionalProperties: false,
      properties: {
        caseId: { type: ["string", "null"] },
        caseType: { type: ["string", "null"], enum: ["healthcare", "dental", "auto", null] },
        status: { type: ["string", "null"], enum: ["denied", "open", "closed", null] },
        month: { type: ["integer", "null"], minimum: 1, maximum: 12 },
        year: { type: ["integer", "null"], minimum: 2000, maximum: 2100 }
      },
      required: ["caseId", "caseType", "status", "month", "year"]
    },
    intent: { type: ["string", "null"] },
    emotion: { type: "string", enum: ["neutral", "frustrated", "anxious", "angry", "confused"] },
    refusal: { type: "boolean" },
    scope: { type: "string", enum: ["in_scope", "out_of_scope", "mixed"] }
  },
  required: ["identity", "callerRole", "caseHint", "intent", "emotion", "refusal", "scope"]
};

export function createOpenAIModel({
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.OPENAI_MODEL,
  baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is required");
  if (!model) throw new Error("OPENAI_MODEL is required");

  async function response(body) {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, store: false, ...body }),
    });
    if (!res.ok) {
      const bodyText = await res.text();
      throw new Error(`model request failed (${res.status}): ${bodyText.slice(0, 500)}`);
    }
    return res.json();
  }

  return {
    async observe(userText) {
      const raw = await response({
        instructions: [
          "Extract only facts stated or clearly implied by the caller.",
          "Do not decide whether identity is verified and do not choose an SOP phase.",
          "Store useful later-phase case hints even when identity is still being verified.",
          "Classify insurance claims/customer-service questions as in scope; unrelated knowledge questions are out of scope.",
          "Return the structured observation only."
        ].join(" "),
        input: [{
          role: "user",
          content: [{ type: "input_text", text: `Caller turn:\n${userText}\n\nReturn JSON matching the configured schema.` }],
        }],
        text: {
          format: {
            type: "json_schema",
            name: "turn_observation",
            strict: true,
            schema: TURN_OBSERVATION_SCHEMA,
          },
        },
      });
      return normalizeObservation(JSON.parse(extractOutputText(raw)));
    },

    async phrase({ userText, plan }) {
      const raw = await response({
        instructions: [
          "You are an insurance claims support representative.",
          "Follow the supplied response plan exactly.",
          "Use only facts inside the response plan as authoritative business facts.",
          "Do not invent claim status, amounts, deadlines, documents, or policy details.",
          "Be concise, natural, and empathetic when the plan reports frustration, anxiety, anger, confusion, or refusal.",
          "Never claim a protected action happened unless the response plan says it happened."
        ].join(" "),
        input: [{
          role: "user",
          content: [{
            type: "input_text",
            text: `Caller turn:\n${userText}\n\nResponse plan:\n${JSON.stringify(plan, null, 2)}`,
          }],
        }],
      });
      return extractOutputText(raw).trim();
    },
  };
}

export function normalizeObservation(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("observation must be an object");
  if (!raw.identity || typeof raw.identity !== "object" || Array.isArray(raw.identity)) throw new Error("identity observation is invalid");
  if (!raw.caseHint || typeof raw.caseHint !== "object" || Array.isArray(raw.caseHint)) throw new Error("case hint is invalid");
  if (!["policyholder", "representative", "unknown"].includes(raw.callerRole)) throw new Error("callerRole is invalid");
  if (!["neutral", "frustrated", "anxious", "angry", "confused"].includes(raw.emotion)) throw new Error("emotion is invalid");
  if (typeof raw.refusal !== "boolean") throw new Error("refusal is invalid");
  if (!["in_scope", "out_of_scope", "mixed"].includes(raw.scope)) throw new Error("scope is invalid");

  return {
    identity: compactObject(raw.identity),
    callerRole: raw.callerRole,
    caseHint: compactObject(raw.caseHint),
    intent: raw.intent ?? null,
    emotion: raw.emotion,
    refusal: raw.refusal,
    scope: raw.scope,
  };
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== ""));
}

function extractOutputText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  const chunks = [];
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") chunks.push(content.text);
    }
  }
  if (!chunks.length) throw new Error("model response contained no output text");
  return chunks.join("");
}
