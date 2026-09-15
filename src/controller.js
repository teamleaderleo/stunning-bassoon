import { PHASES, PII_FIELDS, newSession } from "./domain.js";

const CASE_TYPES = new Set(["healthcare", "dental", "auto"]);
const CASE_STATUSES = new Set(["denied", "closed", "open"]);
const ACTIONABLE_CLAIM_INTENTS = new Set([
  "denial_question",
  "status_inquiry",
  "document_submission",
  "next_steps",
  "general_claim_question",
]);

export { newSession };

export function applyObservation(session, observation = {}, data) {
  const next = structuredClone(session);
  const events = [];
  const principalChanged = observation.identityPrincipalChange === true
    && hasValue(observation.identity?.name);

  if (principalChanged) {
    const previousPartyId = next.verifiedPartyId ?? next.verificationSubjectPartyId;
    const hadAuthorization = Boolean(next.verifiedPartyId);
    startFreshVerificationEpoch(next);
    if (hadAuthorization) {
      events.push({ type: "authorization_revoked", reason: "principal_replacement" });
    }
    events.push({ type: "verification_epoch_restarted", fromPartyId: previousPartyId ?? null });
  }

  const verifiedPartyAtStart = next.verifiedPartyId;
  const piiEvidenceChanged = Boolean(
    verifiedPartyAtStart
    && observation.identity
    && PII_FIELDS.some((field) => Object.hasOwn(observation.identity, field)
      && hasValue(observation.identity[field])
      && !identityValuesEqual(field, observation.identity[field], next.identity[field])),
  );
  const policyLocatorChanged = Boolean(
    verifiedPartyAtStart
    && observation.identity
    && Object.hasOwn(observation.identity, "policyNumber")
    && hasValue(observation.identity.policyNumber)
    && normalizePolicyNumber(observation.identity.policyNumber) !== normalizePolicyNumber(next.identity.policyNumber),
  );
  const authorizationEvidenceChanged = piiEvidenceChanged || policyLocatorChanged;

  if (observation.caseTargetChange === true) {
    const previousCaseId = next.resolvedCaseId;
    const hadTarget = Boolean(previousCaseId || Object.values(next.caseHint).some(hasValue));
    resetCaseTarget(next);
    if (hadTarget) events.push({ type: "case_retargeted", fromCaseId: previousCaseId });
  }

  const allowPrincipalClaimSemantics = (
    !principalChanged
    && !next.principalReplacementPending
  ) || observation.caseTargetChange === true;
  mergeObservation(next, observation, {
    mergeCaseHint: allowPrincipalClaimSemantics
      && (observation.caseTargetChange === true || !next.resolvedCaseId),
    mergeIntent: allowPrincipalClaimSemantics,
  });

  if (observation.scope === "out_of_scope") {
    next.outOfScopeAttempts += 1;
    if (next.outOfScopeAttempts >= 3) setHumanTransferPending(next);
  } else if (observation.scope === "in_scope" || observation.scope === "mixed") {
    next.outOfScopeAttempts = 0;
  }

  if (next.callerRole === "representative") {
    if (next.emailSummary?.state === "awaiting_choice") next.emailSummary = { state: "not_offered" };
    if (next.verifiedPartyId) {
      revokeAuthorization(next);
      events.push({ type: "authorization_revoked", reason: "representative_disclosure" });
    }
    setHumanTransferPending(next, { reopenDeclined: true });
    applyObservedHumanTransferChoice(next, observation.humanTransferChoice, events);
    events.push({ type: "representative_requires_human" });
    return { session: next, events, view: publicView(next, data) };
  }

  if (verifiedPartyAtStart && next.verifiedPartyId && authorizationEvidenceChanged) {
    const verifiedParty = data.policyholders.find((party) => party.party_id === verifiedPartyAtStart);
    const matchingFields = verifiedParty ? matchingPiiFields(next.identity, verifiedParty) : [];
    const contradiction = verifiedParty
      ? policyNumberContradictsParty(next.identity.policyNumber, verifiedParty, data.policyholders)
      : true;

    next.verification = {
      candidatePartyId: verifiedParty?.party_id ?? null,
      matchingFields,
    };

    if (matchingFields.length < 3 || contradiction) {
      revokeAuthorization(next);
      events.push({ type: "authorization_revoked", reason: "identity_correction" });
      return { session: next, events, view: publicView(next, data) };
    }
  }

  if (next.phase === PHASES.VERIFY_ID) {
    const verification = next.verificationSubjectPartyId
      ? evaluateVerificationForParty(next.identity, next.verificationSubjectPartyId, data.policyholders)
      : evaluateVerification(next.identity, data.policyholders);
    next.verification = verification;
    if (verification.matchingFields.length >= 3 && verification.candidatePartyId) {
      next.verifiedPartyId = verification.candidatePartyId;
      next.verificationSubjectPartyId = verification.candidatePartyId;
      next.principalReplacementPending = false;
      next.phase = PHASES.RESOLVE_INTENT;
      events.push({ type: "identity_verified", partyId: verification.candidatePartyId });
    }
  }

  applyObservedHumanTransferChoice(next, observation.humanTransferChoice, events);

  if (
    next.phase === PHASES.POST_PROCESS
    && next.verifiedPartyId
    && next.resolvedCaseId
    && next.emailSummary.state === "awaiting_choice"
    && isActionableClaimIntent(observation.intent)
  ) {
    next.phase = PHASES.PROCESS_CASE;
    next.emailSummary = { state: "not_offered" };
    events.push({ type: "case_reentered", caseId: next.resolvedCaseId });
  }

  if (next.phase === PHASES.RESOLVE_INTENT && next.verifiedPartyId) {
    const resolution = resolveCase(next.verifiedPartyId, next.caseHint, data.claims);
    next.caseResolution = resolution;
    if (resolution.status === "resolved") {
      next.resolvedCaseId = resolution.candidateCaseIds[0];
      if (isActionableClaimIntent(next.intent)) {
        next.phase = PHASES.PROCESS_CASE;
        events.push({ type: "case_resolved", caseId: next.resolvedCaseId });
      }
    } else {
      next.resolvedCaseId = null;
    }
  }

  return { session: next, events, view: publicView(next, data) };
}

export function markCaseComplete(session) {
  if (session.phase !== PHASES.PROCESS_CASE || !session.resolvedCaseId) {
    throw new Error("case can only be completed from PROCESS_CASE with a resolved case");
  }
  const next = structuredClone(session);
  clearPendingHumanTransfer(next);
  next.phase = PHASES.POST_PROCESS;
  next.emailSummary.state = "awaiting_choice";
  return next;
}

export function chooseEmailSummary(session, choice) {
  if (session.phase !== PHASES.POST_PROCESS || session.emailSummary.state !== "awaiting_choice") {
    throw new Error("email summary choice is only valid while awaiting POST_PROCESS consent");
  }
  if (choice !== "send" && choice !== "skip") throw new Error("choice must be send or skip");
  const next = structuredClone(session);
  next.emailSummary.state = choice;
  return next;
}

export function offerHumanTransfer(session) {
  const next = structuredClone(session);
  setHumanTransferPending(next);
  return next;
}

export function chooseHumanTransfer(session, choice) {
  if (choice !== "accept" && choice !== "decline") {
    throw new Error("human transfer choice must be accept or decline");
  }
  const state = session.humanTransfer?.state ?? "not_offered";
  if (choice === "decline" && state !== "awaiting_choice") {
    throw new Error("human transfer decline is only valid while awaiting a choice");
  }
  if (choice === "accept" && !["not_offered", "awaiting_choice", "declined"].includes(state)) {
    throw new Error("human transfer request is already recorded");
  }
  const next = structuredClone(session);
  next.humanTransferOffered = true;
  next.humanTransfer.state = choice === "accept" ? "requested" : "declined";
  restoreDeferredEmailChoice(next);
  return next;
}

export function publicView(session, data) {
  const claimAccess = session.verifiedPartyId !== null;
  const resolvedClaim = claimAccess && session.resolvedCaseId
    ? data.claims.find((claim) => claim.case_id === session.resolvedCaseId) ?? null
    : null;
  const identity = {
    providedFields: PII_FIELDS.filter((field) => hasValue(session.identity[field])),
    verified: Boolean(session.verifiedPartyId),
  };
  if (identity.verified) identity.matchingFields = [...session.verification.matchingFields];

  return {
    phase: session.phase,
    identity,
    callerRole: session.callerRole,
    rememberedCaseHint: structuredClone(session.caseHint),
    caseResolution: structuredClone(session.caseResolution),
    claimAccess: claimAccess ? "unlocked" : "locked",
    resolvedClaim,
    outOfScopeAttempts: session.outOfScopeAttempts,
    humanTransferOffered: session.humanTransferOffered,
    humanTransfer: structuredClone(session.humanTransfer ?? { state: "not_offered" }),
    emailSummary: structuredClone(session.emailSummary),
  };
}

export function evaluateVerification(identity, policyholders) {
  const ranked = policyholders.map((party) => ({ party, matchingFields: matchingPiiFields(identity, party) }));
  const bestCount = Math.max(0, ...ranked.map(({ matchingFields }) => matchingFields.length));
  const best = ranked.filter(({ matchingFields }) => matchingFields.length === bestCount);

  if (bestCount === 0 || best.length !== 1) return { candidatePartyId: null, matchingFields: [] };
  if (policyNumberContradictsParty(identity.policyNumber, best[0].party, policyholders)) {
    return { candidatePartyId: null, matchingFields: [] };
  }
  return {
    candidatePartyId: best[0].party.party_id,
    matchingFields: best[0].matchingFields,
  };
}

function evaluateVerificationForParty(identity, partyId, policyholders) {
  const party = policyholders.find((candidate) => candidate.party_id === partyId);
  if (!party) return { candidatePartyId: null, matchingFields: [] };
  const matchingFields = matchingPiiFields(identity, party);
  if (policyNumberContradictsParty(identity.policyNumber, party, policyholders)) {
    return { candidatePartyId: null, matchingFields: [] };
  }
  return { candidatePartyId: party.party_id, matchingFields };
}

export function resolveCase(partyId, hint, claims) {
  const hasHint = Object.values(hint).some(hasValue);
  if (!hasHint) return { status: "unresolved", candidateCaseIds: [] };

  const candidates = claims.filter((claim) => {
    if (claim.party_id !== partyId) return false;
    if (hasValue(hint.caseId) && normalizeCaseId(hint.caseId) !== normalizeCaseId(claim.case_id)) return false;
    if (hasValue(hint.caseType) && normalizeCaseType(hint.caseType) !== claim.case_type) return false;
    if (hasValue(hint.status) && normalizeStatus(hint.status) !== claim.status) return false;
    if (hasValue(hint.year) && Number(hint.year) !== Number(claim.created_at.slice(0, 4))) return false;
    if (hasValue(hint.month) && Number(hint.month) !== Number(claim.created_at.slice(5, 7))) return false;
    return true;
  });

  if (candidates.length === 1) return { status: "resolved", candidateCaseIds: [candidates[0].case_id] };
  if (candidates.length > 1) return { status: "ambiguous", candidateCaseIds: candidates.map((claim) => claim.case_id) };
  return { status: "no_match", candidateCaseIds: [] };
}

function resetCaseTarget(session) {
  session.phase = session.verifiedPartyId ? PHASES.RESOLVE_INTENT : PHASES.VERIFY_ID;
  session.caseHint = {};
  session.caseResolution = { status: "unresolved", candidateCaseIds: [] };
  session.resolvedCaseId = null;
  session.intent = null;
  session.emailSummary = { state: "not_offered" };
  clearPendingHumanTransfer(session);
}

function startFreshVerificationEpoch(session) {
  session.phase = PHASES.VERIFY_ID;
  session.identity = {};
  session.callerRole = null;
  session.verifiedPartyId = null;
  session.verificationSubjectPartyId = null;
  session.principalReplacementPending = true;
  session.verification = { candidatePartyId: null, matchingFields: [] };
  session.caseHint = {};
  session.caseResolution = { status: "unresolved", candidateCaseIds: [] };
  session.resolvedCaseId = null;
  session.intent = null;
  session.emailSummary = { state: "not_offered" };
  clearPendingHumanTransfer(session);
}

function revokeAuthorization(session) {
  session.verifiedPartyId = null;
  session.phase = PHASES.VERIFY_ID;
  session.verification = { candidatePartyId: null, matchingFields: [] };
  session.caseHint = {};
  session.caseResolution = { status: "unresolved", candidateCaseIds: [] };
  session.resolvedCaseId = null;
  session.emailSummary = { state: "not_offered" };
  clearPendingHumanTransfer(session);
}

function mergeObservation(session, observation = {}, { mergeCaseHint = true, mergeIntent = true } = {}) {
  if (observation.identity) {
    for (const [key, value] of Object.entries(observation.identity)) {
      if (hasValue(value)) session.identity[key] = String(value).trim();
    }
  }
  if (mergeCaseHint && observation.caseHint) {
    for (const [key, value] of Object.entries(observation.caseHint)) {
      if (hasValue(value)) session.caseHint[key] = value;
    }
  }
  if (hasValue(observation.callerRole) && observation.callerRole !== "unknown") {
    if (session.callerRole && session.callerRole !== observation.callerRole) {
      session.callerRole = "representative";
      setHumanTransferPending(session);
    } else {
      session.callerRole = observation.callerRole;
    }
  }
  if (mergeIntent && hasValue(observation.intent) && observation.intent !== "unknown") session.intent = observation.intent;
  if (hasValue(observation.emotion)) session.emotion = observation.emotion;
  if (typeof observation.refusal === "boolean") session.refusal = observation.refusal;
  if (hasValue(observation.scope)) session.lastScope = observation.scope;
}

function applyObservedHumanTransferChoice(session, choice, events) {
  if (choice === "accept") {
    if (session.humanTransfer?.state !== "requested") {
      session.humanTransferOffered = true;
      session.humanTransfer = { state: "requested" };
      events.push({ type: "human_transfer_requested" });
    }
    restoreDeferredEmailChoice(session);
  } else if (choice === "decline" && session.humanTransfer?.state === "awaiting_choice") {
    session.humanTransferOffered = true;
    session.humanTransfer = { state: "declined" };
    events.push({ type: "human_transfer_declined" });
    restoreDeferredEmailChoice(session);
  }
}

function setHumanTransferPending(session, { reopenDeclined = false } = {}) {
  if (!session.humanTransfer) session.humanTransfer = { state: "not_offered" };
  const shouldAwaitChoice = session.humanTransfer.state === "not_offered"
    || (reopenDeclined && session.humanTransfer.state === "declined");
  if (!shouldAwaitChoice) return;

  if (session.phase === PHASES.POST_PROCESS && session.emailSummary?.state === "awaiting_choice") {
    session.emailSummary = { state: "deferred_for_human" };
  }
  session.humanTransferOffered = true;
  session.humanTransfer.state = "awaiting_choice";
}

function restoreDeferredEmailChoice(session) {
  if (session.phase === PHASES.POST_PROCESS && session.emailSummary?.state === "deferred_for_human") {
    session.emailSummary = { state: "awaiting_choice" };
  }
}

function clearPendingHumanTransfer(session) {
  if (session.humanTransfer?.state === "awaiting_choice") {
    session.humanTransfer = { state: "not_offered" };
    session.humanTransferOffered = false;
  }
}

function matchingPiiFields(identity, party) {
  const fields = [];
  if (hasValue(identity.name) && anyEqual(identity.name, [party.name, ...(party.name_aliases ?? [])], normalizeName)) fields.push("name");
  if (hasValue(identity.dob) && normalizeDate(identity.dob) === normalizeDate(party.dob)) fields.push("dob");
  if (hasValue(identity.phone) && anyEqual(identity.phone, [party.phone, ...(party.phone_aliases ?? [])], normalizePhone)) fields.push("phone");
  if (hasValue(identity.email) && anyEqual(identity.email, [party.email, ...(party.email_aliases ?? [])], normalizeEmail)) fields.push("email");
  if (
    party.id_type === "ssn_last4"
    && hasValue(identity.idLast4)
    && normalizeIdLast4(identity.idLast4) === normalizeIdLast4(party.id_last4)
  ) fields.push("idLast4");
  return fields;
}

function identityValuesEqual(field, left, right) {
  const normalizers = {
    name: normalizeName,
    dob: normalizeDate,
    phone: normalizePhone,
    email: normalizeEmail,
    idLast4: normalizeIdLast4,
  };
  const normalize = normalizers[field] ?? ((value) => String(value ?? "").trim());
  return normalize(left) === normalize(right);
}

function anyEqual(value, candidates, normalize) {
  const target = normalize(value);
  return target !== "" && candidates.some((candidate) => normalize(candidate) === target);
}

function policyNumberMatches(value, expected) {
  return hasValue(value) && normalizePolicyNumber(value) === normalizePolicyNumber(expected);
}

function normalizePolicyNumber(value) {
  return String(value ?? "").trim().toUpperCase();
}

function policyNumberContradictsParty(value, party, policyholders) {
  if (!hasValue(value)) return false;
  const matches = policyholders.filter((candidate) => policyNumberMatches(value, candidate.policy_number));
  return matches.length === 1 && matches[0].party_id !== party.party_id;
}

function isActionableClaimIntent(intent) {
  return ACTIONABLE_CLAIM_INTENTS.has(intent);
}

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeDate(value) {
  return String(value ?? "").trim();
}

function normalizePhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeIdLast4(value) {
  return String(value ?? "").replace(/\D/g, "").slice(-4);
}

function normalizeCaseId(value) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeCaseType(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return CASE_TYPES.has(normalized) ? normalized : normalized;
}

function normalizeStatus(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return CASE_STATUSES.has(normalized) ? normalized : normalized;
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}