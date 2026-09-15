import { PHASES, PII_FIELDS } from "./domain.js";

const MAX_ASSISTANT_CONTEXT_CHARS = 2_000;

export function buildObservationContext(session, previousAssistantText = null) {
  const context = {
    phase: session.phase,
    previousAssistantText: boundedText(previousAssistantText),
    callerRole: session.callerRole,
    providedIdentityFields: PII_FIELDS.filter((field) => hasValue(session.identity[field])),
    matchingIdentityFields: [...session.verification.matchingFields],
    rememberedCaseHint: structuredClone(session.caseHint),
    caseResolutionStatus: session.caseResolution.status,
    emailSummaryState: session.emailSummary.state,
  };

  if (session.phase === PHASES.VERIFY_ID) {
    return {
      ...context,
      protectedClaimDetailsAvailable: false,
    };
  }

  return {
    ...context,
    protectedClaimDetailsAvailable: Boolean(session.verifiedPartyId),
    resolvedCaseId: session.resolvedCaseId,
  };
}

function boundedText(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.slice(-MAX_ASSISTANT_CONTEXT_CHARS);
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}
