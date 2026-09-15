const DOCUMENT_CANONICAL_NAMES = new Map([
  ["pathology report", "original pathology report"],
  ["office note", "treating provider office note"],
]);

export function buildCaseGrounding(session, userText, data) {
  if (!session.verifiedPartyId || !session.resolvedCaseId) {
    throw new Error("case grounding requires a verified caller and resolved case");
  }

  const claim = data.claims.find((item) =>
    item.case_id === session.resolvedCaseId && item.party_id === session.verifiedPartyId,
  );
  if (!claim) throw new Error("resolved claim is unavailable for the verified party");

  const guide = data.requiredDocumentGuideline;
  const documents = claim.documents_needed ?? [];
  const documentGuidance = documents.map((document) => {
    const key = DOCUMENT_CANONICAL_NAMES.get(document.toLowerCase()) ?? document.toLowerCase();
    return {
      requestedDocument: document,
      guidanceKey: key,
      guidance: guide.document_guidance?.[key]?.en ?? null,
      alternative: guide.document_alternative_guidance?.[key]?.en ?? guide.document_alternative_guidance?.default?.en ?? null,
    };
  });

  const followups = (guide.claim_followup_guidance ?? []).filter((entry) =>
    (entry.match_any ?? []).some((phrase) => userText.toLowerCase().includes(phrase.toLowerCase())),
  );

  return {
    claim,
    defaultGuidance: guide.default_guidance?.en ?? null,
    caseTypeGuidance: guide.case_type_guidance?.[claim.case_type]?.en ?? null,
    documentGuidance,
    followupGuidance: followups.map((entry) => ({ topic: entry.topic, template: entry.en })),
    followupFallback: guide.claim_followup_fallback?.en ?? null,
    processingTimeAfterSubmission: guide.claim_followup_settings?.average_processing_time_after_submission?.en ?? null,
  };
}
