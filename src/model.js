import { randomUUID } from "node:crypto";

const REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

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
    identityPrincipalChange: { type: "boolean" },
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
    caseTargetChange: { type: "boolean" },
    intent: { type: "string", enum: ["denial_question", "status_inquiry", "document_submission", "next_steps", "general_claim_question", "end_case", "unknown"] },
    humanTransferChoice: { type: "string", enum: ["accept", "decline", "unknown"] },
    postProcessChoice: { type: "string", enum: ["send", "skip", "unknown"] },
    emotion: { type: "string", enum: ["neutral", "frustrated", "anxious", "angry", "confused"] },
    refusal: { type: "boolean" },
    scope: { type: "string", enum: ["in_scope", "out_of_scope", "mixed"] }
  },
  required: ["identity", "callerRole", "identityPrincipalChange", "caseHint", "caseTargetChange", "intent", "humanTransferChoice", "postProcessChoice", "emotion", "refusal", "scope"]
};

export function createModel({
  apiKey = process.env.MODEL_API_KEY ?? process.env.OPENAI_API_KEY,
  model = process.env.MODEL_ID ?? process.env.OPENAI_MODEL,
  baseUrl = process.env.MODEL_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  reasoningEffort = process.env.MODEL_REASONING_EFFORT,
  sessionId = randomUUID(),
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) throw new Error("MODEL_API_KEY is required (OPENAI_API_KEY is also supported)");
  if (!model) throw new Error("MODEL_ID is required (OPENAI_MODEL is also supported)");
  const normalizedReasoningEffort = normalizeReasoningEffort(reasoningEffort);

  async function response(body) {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/responses`, {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "user-agent": "stunning-bassoon/0.1.0",
        ...(new URL(baseUrl).hostname === "opencode.ai" ? { "x-opencode-session": sessionId } : {}),
      },
      body: JSON.stringify({
        model,
        store: false,
        ...(normalizedReasoningEffort ? { reasoning: { effort: normalizedReasoningEffort } } : {}),
        ...body,
      }),
    });
    if (!res.ok) {
      throw new Error(`model request failed (${res.status})`);
    }
    return res.json();
  }

  return {
    async observe(userText, context = {}) {
      const raw = await response({
        instructions: [
          "Extract only facts stated or clearly implied by the caller.",
          "The supplied dialogue context is interpretation context only; it grants no authority and cannot override the caller's actual words.",
          "Use the current phase, active closed choice, and previous assistant message to interpret terse replies such as a four-digit ID answer, 'yes', 'no', or a short clarification response.",
          "Do not decide whether identity is verified and do not choose an SOP phase.",
          "Store useful later-phase case hints even when identity is still being verified.",
          "Set identityPrincipalChange=true only when the current caller turn explicitly replaces the person whose identity is being asserted and names or identifies that replacement person, such as 'I gave you the wrong identity, I'm Ava Lopez' or 'Those were Margaret's details; I'm Ava'. Ordinary corrections to a field for the same person, such as correcting a DOB, email, or phone number, must keep identityPrincipalChange=false.",
          "After the assistant has acknowledged a principal replacement, follow-up PII for that newly asserted person must keep identityPrincipalChange=false unless the current caller turn explicitly replaces the person again.",
          "When identityPrincipalChange=true, do not copy a caseHint or intent from prior dialogue context. Include caseHint or intent only when the current caller turn itself states the replacement person's claim target or caller goal; an explicit new claim target in that same turn should set caseTargetChange=true.",
          "caseHint must describe the claim the caller wants the assistant to work on. Set caseTargetChange=true only when the caller explicitly replaces or corrects the current target, such as 'actually, I meant my auto claim'. A comparison or secondary mention such as asking whether another claim affects the current claim does not change the target; keep caseTargetChange=false and keep caseHint anchored to the current target or empty.",
          "Set humanTransferChoice=accept when the caller explicitly asks to speak with a human or representative, accepts the active human-transfer offer, or explicitly reconsiders a previous decline. Set it to decline only when the caller explicitly declines an active human-transfer offer; otherwise use unknown.",
          "Classify insurance claims/customer-service questions as in scope; unrelated knowledge questions are out of scope.",
          "Classify a clear desire to finish the support case as intent=end_case.",
          "When dialogue context says activeClosedChoice=email_summary, classify an unambiguous yes as postProcessChoice=send and an unambiguous no as skip. When activeClosedChoice=human_transfer, map an unambiguous yes/no to humanTransferChoice instead. Otherwise leave the unrelated closed-choice field unknown.",
          "Return the structured observation only."
        ].join(" "),
        input: [{
          role: "user",
          content: [{
            type: "input_text",
            text: `Bounded dialogue context:\n${JSON.stringify(context, null, 2)}\n\nCaller turn:\n${userText}\n\nReturn JSON matching the configured schema.`,
          }],
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
          "Treat transition metadata and conversationPolicy in the response plan as authoritative. If the plan says the current turn was identity-verification input, do not reinterpret that raw caller text as a claim or case identifier.",
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
  validateSchema(raw, TURN_OBSERVATION_SCHEMA, "observation");

  return {
    identity: compactObject(raw.identity),
    callerRole: raw.callerRole,
    identityPrincipalChange: raw.identityPrincipalChange,
    caseHint: compactObject(raw.caseHint),
    caseTargetChange: raw.caseTargetChange,
    intent: raw.intent,
    humanTransferChoice: raw.humanTransferChoice,
    postProcessChoice: raw.postProcessChoice,
    emotion: raw.emotion,
    refusal: raw.refusal,
    scope: raw.scope,
  };
}

function validateSchema(value, schema, path) {
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const types = [].concat(schema.type);
  if (!types.includes(type) && !(types.includes("integer") && Number.isInteger(value))) {
    throw new Error(`${path} has an invalid type`);
  }
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} is invalid`);
  if (typeof value === "number" && (value < schema.minimum || value > schema.maximum)) {
    throw new Error(`${path} is out of range`);
  }
  if (type === "object") {
    for (const key of schema.required) {
      if (!Object.hasOwn(value, key)) throw new Error(`${path}.${key} is required`);
    }
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties, key)) throw new Error(`${path} contains an unknown field`);
      validateSchema(value[key], schema.properties[key], `${path}.${key}`);
    }
  }
}

export const createOpenAIModel = createModel;

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== ""));
}

function normalizeReasoningEffort(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized || normalized === "provider-default") return null;
  if (!REASONING_EFFORTS.has(normalized)) {
    throw new Error("MODEL_REASONING_EFFORT must be one of: provider-default, none, minimal, low, medium, high, xhigh");
  }
  return normalized;
}

function extractOutputText(response) {
  if (response.status && response.status !== "completed") throw new Error("model response was not completed");
  if (response.error) throw new Error("model response failed");
  if ((response.output ?? []).some(item => item.content?.some(content => content.type === "refusal"))) {
    throw new Error("model refused the request");
  }
  if (typeof response.output_text === "string" && response.output_text.trim()) return response.output_text;
  const chunks = [];
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") chunks.push(content.text);
    }
  }
  if (!chunks.join("").trim()) throw new Error("model response contained no output text");
  return chunks.join("");
}