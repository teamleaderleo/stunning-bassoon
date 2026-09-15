export const PHASES = Object.freeze({
  VERIFY_ID: "VERIFY_ID",
  RESOLVE_INTENT: "RESOLVE_INTENT",
  PROCESS_CASE: "PROCESS_CASE",
  POST_PROCESS: "POST_PROCESS",
});

export const PII_FIELDS = Object.freeze(["name", "dob", "phone", "email", "idLast4"]);

export function newSession() {
  return {
    phase: PHASES.VERIFY_ID,
    identity: {},
    callerRole: null,
    caseHint: {},
    intent: null,
    emotion: "neutral",
    refusal: false,
    lastScope: "in_scope",
    outOfScopeAttempts: 0,
    humanTransferOffered: false,
    humanTransfer: {
      state: "not_offered",
    },
    verifiedPartyId: null,
    verification: {
      candidatePartyId: null,
      matchingFields: [],
    },
    caseResolution: {
      status: "unresolved",
      candidateCaseIds: [],
    },
    resolvedCaseId: null,
    emailSummary: {
      state: "not_offered",
    },
  };
}
