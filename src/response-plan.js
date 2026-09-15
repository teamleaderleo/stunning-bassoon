import { PHASES, PII_FIELDS } from "./domain.js";
import { buildCaseGrounding } from "./grounding.js";

export function buildResponsePlan({ session, observation, userText, data }) {
  const scope = scopePlan(session, observation);
  const common = {
    phase: session.phase,
    emotion: observation.emotion,
    refusal: observation.refusal,
    scope,
    humanTransferOffered: session.humanTransferOffered,
  };

  if (session.phase === PHASES.VERIFY_ID) {
    const remaining = PII_FIELDS.filter((field) => !session.verification.matchingFields.includes(field));
    return {
      ...common,
      task: "continue_identity_verification",
      protectedClaimDetailsAvailable: false,
      verification: {
        matchingFieldCount: session.verification.matchingFields.length,
        matchingFields: [...session.verification.matchingFields],
        acceptableRemainingFields: remaining,
        explanation: "Claim details are protected until at least three distinct PII fields match the policyholder record.",
      },
      rememberedCaseHint: structuredClone(session.caseHint),
    };
  }

  if (session.phase === PHASES.RESOLVE_INTENT) {
    return {
      ...common,
      task: "resolve_case_or_ask_targeted_clarification",
      protectedClaimDetailsAvailable: true,
      rememberedCaseHint: structuredClone(session.caseHint),
      caseResolution: structuredClone(session.caseResolution),
    };
  }

  if (session.phase === PHASES.PROCESS_CASE) {
    return {
      ...common,
      task: "answer_from_grounded_case_data",
      protectedClaimDetailsAvailable: true,
      grounding: buildCaseGrounding(session, userText, data),
    };
  }

  return {
    ...common,
    task: "offer_or_resolve_email_summary_choice",
    protectedClaimDetailsAvailable: true,
    emailSummary: structuredClone(session.emailSummary),
  };
}

function scopePlan(session, observation) {
  if (observation.scope === "in_scope") return { mode: "answer" };
  return {
    mode: observation.scope === "mixed" ? "answer_in_scope_and_decline_unrelated_part" : "decline_and_redirect",
    message: "Only answer questions relevant to this insurance customer-service interaction.",
    escalation: session.humanTransferOffered ? "offer_human_representative" : "continue_current_sop_phase",
  };
}
