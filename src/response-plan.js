import { PHASES, PII_FIELDS } from "./domain.js";
import { buildCaseGrounding } from "./grounding.js";

export function buildResponsePlan({ session, observation, userText, data, asOfDate }) {
  const scope = scopePlan(session, observation);
  const common = {
    phase: session.phase,
    emotion: observation.emotion,
    refusal: observation.refusal,
    scope,
    humanTransferOffered: session.humanTransferOffered,
  };

  if (observation.scope === "out_of_scope") {
    return {
      ...common,
      task: "decline_out_of_scope_and_resume_sop",
      protectedClaimDetailsAvailable: Boolean(session.verifiedPartyId),
      resumeTask: phaseTask(session.phase),
    };
  }

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
      conversationPolicy: {
        acknowledgeEmotionFirst: observation.emotion !== "neutral" || observation.refusal,
        explainWhyVerificationIsRequired: true,
        persuadeWithoutBypassingGate: true,
        stopPersuadingAndOfferHuman: session.humanTransferOffered,
      },
    };
  }

  if (session.phase === PHASES.RESOLVE_INTENT) {
    return {
      ...common,
      task: "resolve_case_or_ask_targeted_clarification",
      protectedClaimDetailsAvailable: true,
      rememberedCaseHint: structuredClone(session.caseHint),
      caseResolution: structuredClone(session.caseResolution),
      caseCandidates: candidateSummaries(session, data),
    };
  }

  if (session.phase === PHASES.PROCESS_CASE) {
    const grounding = buildCaseGrounding(session, userText, data, { asOfDate });
    if (grounding.temporal.appealDeadline.status === "expired") {
      return {
        ...common,
        task: "explain_expired_appeal_and_offer_human",
        protectedClaimDetailsAvailable: true,
        grounding,
        conversationPolicy: {
          explainGroundedClaimFacts: true,
          ordinarySubmissionPathIsCurrent: false,
          doNotPromiseReReviewOrNormalProcessingTime: true,
          stateLateAppealRuleIsUnavailable: true,
          offerHumanRepresentative: true,
        },
      };
    }
    return {
      ...common,
      task: "answer_from_grounded_case_data",
      protectedClaimDetailsAvailable: true,
      grounding,
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

function candidateSummaries(session, data) {
  if (!session.verifiedPartyId) return [];
  const ids = new Set(session.caseResolution.candidateCaseIds);
  return data.claims
    .filter((claim) => claim.party_id === session.verifiedPartyId && ids.has(claim.case_id))
    .map((claim) => ({
      caseId: claim.case_id,
      caseType: claim.case_type,
      createdAt: claim.created_at,
      status: claim.status,
      summary: claim.summary,
    }));
}

function phaseTask(phase) {
  if (phase === PHASES.VERIFY_ID) return "continue_identity_verification";
  if (phase === PHASES.RESOLVE_INTENT) return "resolve_case_or_ask_targeted_clarification";
  if (phase === PHASES.PROCESS_CASE) return "answer_from_grounded_case_data";
  return "offer_or_resolve_email_summary_choice";
}
