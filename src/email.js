export function buildEmailPreview(session, data, turnRecords = []) {
  if (session.emailSummary.state !== "send" || !session.verifiedPartyId || !session.resolvedCaseId) return null;

  const party = data.policyholders.find((item) => item.party_id === session.verifiedPartyId);
  const claim = data.claims.find((item) => item.case_id === session.resolvedCaseId && item.party_id === session.verifiedPartyId);
  if (!party || !claim) return null;

  const topics = [...new Set(turnRecords.map((turn) => turn.observation?.intent).filter((intent) => intent && intent !== "unknown" && intent !== "end_case"))];
  const nextSteps = [];
  if (claim.documents_needed?.length) nextSteps.push(`Provide: ${claim.documents_needed.join(", ")}.`);
  if (claim.appeal_deadline) nextSteps.push(`Appeal deadline: ${claim.appeal_deadline}.`);
  if (!nextSteps.length) nextSteps.push("Follow the claim status and any instructions discussed during the conversation.");

  const body = [
    `Hello ${party.name},`,
    "",
    `Here is the summary you requested for claim ${claim.case_id}.`,
    `Claim status/outcome: ${claim.status}. ${claim.summary}.`,
    topics.length ? `Topics discussed: ${topics.join(", ")}.` : null,
    `Major follow-up items: ${nextSteps.join(" ")}`,
    "",
    "This summary reflects the sample claim data used in the demo.",
  ].filter(Boolean).join("\n");

  return {
    to: party.email,
    subject: `Claim ${claim.case_id} conversation summary`,
    body,
  };
}
