import { PHASES, PII_FIELDS } from "./domain.js";

const MAX_ASSISTANT_CONTEXT_CHARS = 2_000;

export function buildObservationContext(session, previousAssistantText = null) {
  const context = {
    phase: session.phase,
    previousAssistantText: boundedText(previousAssistantText),
    callerRole: session.callerRole,
    providedIdentityFields: PII_FIELDS.filter((field) => hasValue(session.identity[field])),
    rememberedCaseHint: structuredClone(session.caseHint),
    caseResolutionStatus: session.caseResolution.status,
    humanTransferState: session.humanTransfer?.state ?? "not_offered",
    emailSummaryState: session.emailSummary.state,
    activeClosedChoice: activeClosedChoice(session),
  };

  if (session.phase === PHASES.VERIFY_ID || !session.verifiedPartyId) {
    return {
      ...context,
      protectedClaimDetailsAvailable: false,
    };
  }

  return {
    ...context,
    protectedClaimDetailsAvailable: true,
    matchingIdentityFields: [...session.verification.matchingFields],
    resolvedCaseId: session.resolvedCaseId,
  };
}

function activeClosedChoice(session) {
  if (session.phase === PHASES.POST_PROCESS && session.emailSummary?.state === "awaiting_choice") return "email_summary";
  if (session.humanTransfer?.state === "awaiting_choice") return "human_transfer";
  return null;
}

function boundedText(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.slice(-MAX_ASSISTANT_CONTEXT_CHARS);
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}
