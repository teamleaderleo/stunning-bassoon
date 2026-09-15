const DOCUMENT_CANONICAL_NAMES = new Map([
  ["pathology report", "original pathology report"],
  ["office note", "treating provider office note"],
]);

export function buildCaseGrounding(session, userText, data, { asOfDate = currentDate() } = {}) {
  if (!session.verifiedPartyId || !session.resolvedCaseId) {
    throw new Error("case grounding requires a verified caller and resolved case");
  }

  const claim = data.claims.find((item) =>
    item.case_id === session.resolvedCaseId && item.party_id === session.verifiedPartyId,
  );
  if (!claim) throw new Error("resolved claim is unavailable for the verified party");

  const appealDeadline = classifyAppealDeadline(claim.appeal_deadline, asOfDate);
  const ordinarySubmissionPathSupported = appealDeadline.status !== "expired";
  const guide = data.requiredDocumentGuideline;
  const documents = claim.documents_needed ?? [];
  const documentGuidance = documents.map((document) => {
    const key = DOCUMENT_CANONICAL_NAMES.get(document.toLowerCase()) ?? document.toLowerCase();
    return {
      requestedDocument: document,
      guidanceKey: key,
      guidance: guide.document_guidance?.[key]?.en ?? null,
      // Alternatives in the fixture describe the ordinary active submission path.
      // Keep the historical document requirements visible after expiry, but do not
      // present replacement/submission advice as an authorized current next step.
      alternative: ordinarySubmissionPathSupported
        ? guide.document_alternative_guidance?.[key]?.en ?? guide.document_alternative_guidance?.default?.en ?? null
        : null,
    };
  });

  const followups = ordinarySubmissionPathSupported
    ? (guide.claim_followup_guidance ?? []).filter((entry) =>
        (entry.match_any ?? []).some((phrase) => userText.toLowerCase().includes(phrase.toLowerCase())),
      )
    : [];

  return {
    claim,
    temporal: {
      asOfDate: normalizeIsoDate(asOfDate, "as-of date"),
      appealDeadline,
    },
    applicability: ordinarySubmissionPathSupported
      ? {
          ordinarySubmissionPath: "supported",
          lateAppealRuleAvailable: null,
          recommendedEscalation: null,
        }
      : {
          ordinarySubmissionPath: "unsupported_after_deadline",
          lateAppealRuleAvailable: false,
          recommendedEscalation: "human_representative",
          explanation: "The listed appeal deadline has passed. The supplied guidance contains no late-appeal or reopening rule, so ordinary document-submission guidance cannot be presented as the current next step.",
          prohibitedRecommendations: [
            "tell the caller to submit the missing documents now as the active appeal path",
            "claim that submitting documents now will restart review",
            "quote the normal post-submission processing window as applicable to this expired appeal",
          ],
        },
    defaultGuidance: ordinarySubmissionPathSupported ? guide.default_guidance?.en ?? null : null,
    caseTypeGuidance: ordinarySubmissionPathSupported ? guide.case_type_guidance?.[claim.case_type]?.en ?? null : null,
    documentGuidance,
    followupGuidance: followups.map((entry) => ({ topic: entry.topic, template: entry.en })),
    followupFallback: ordinarySubmissionPathSupported ? guide.claim_followup_fallback?.en ?? null : null,
    processingTimeAfterSubmission: ordinarySubmissionPathSupported
      ? guide.claim_followup_settings?.average_processing_time_after_submission?.en ?? null
      : null,
  };
}

export function classifyAppealDeadline(deadline, asOfDate = currentDate()) {
  if (deadline === undefined || deadline === null || String(deadline).trim() === "") {
    return { date: null, status: "absent" };
  }
  const date = normalizeIsoDate(deadline, "appeal deadline");
  const today = normalizeIsoDate(asOfDate, "as-of date");
  return {
    date,
    status: date < today ? "expired" : date === today ? "today" : "future",
  };
}

function currentDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeIsoDate(value, label) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new Error(`${label} must be YYYY-MM-DD`);
  }
  return text;
}
