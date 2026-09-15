import { PHASES, PII_FIELDS, newSession } from "./domain.js";

const CASE_TYPES = new Set(["healthcare", "dental", "auto"]);
const CASE_STATUSES = new Set(["denied", "closed", "open"]);

export { newSession };

export function applyObservation(session, observation, data) {
  const next = structuredClone(session);
  const events = [];

  if (shouldRetargetResolvedCase(next, observation, data)) {
    const previousCaseId = next.resolvedCaseId;
    resetResolvedCaseTarget(next);
    events.push({ type: "case_retargeted", fromCaseId: previousCaseId });
  }

  mergeObservation(next, observation);

  if (observation.scope === "out_of_scope" || observation.scope === "mixed") {
    next.outOfScopeAttempts += 1;
    if (next.outOfScopeAttempts >= 3) setHumanTransferPending(next);
  }

  if (next.phase === PHASES.VERIFY_ID && next.callerRole === "representative") {
    setHumanTransferPending(next);
    events.push({ type: "representative_requires_human" });
    return { session: next, events, view: publicView(next, data) };
  }

  if (next.phase === PHASES.VERIFY_ID) {
    const verification = evaluateVerification(next.identity, data.policyholders);
    next.verification = verification;
    if (verification.matchingFields.length >= 3 && verification.candidatePartyId) {
      next.verifiedPartyId = verification.candidatePartyId;
      next.phase = PHASES.RESOLVE_INTENT;
      events.push({ type: "identity_verified", partyId: verification.candidatePartyId });
    }
  }

  if (next.phase === PHASES.RESOLVE_INTENT && next.verifiedPartyId) {
    const resolution = resolveCase(next.verifiedPartyId, next.caseHint, data.claims);
    next.caseResolution = resolution;
    if (resolution.status === "resolved") {
      next.resolvedCaseId = resolution.candidateCaseIds[0];
      next.phase = PHASES.PROCESS_CASE;
      events.push({ type: "case_resolved", caseId: next.resolvedCaseId });
    }
  }

  return { session: next, events, view: publicView(next, data) };
}

export function markCaseComplete(session) {
  if (session.phase !== PHASES.PROCESS_CASE || !session.resolvedCaseId) {
    throw new Error("case can only be completed from PROCESS_CASE with a resolved case");
  }
  const next = structuredClone(session);
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
  if (session.humanTransfer?.state !== "awaiting_choice") {
    throw new Error("human transfer choice is only valid while awaiting a choice");
  }
  if (choice !== "accept" && choice !== "decline") {
    throw new Error("human transfer choice must be accept or decline");
  }
  const next = structuredClone(session);
  next.humanTransferOffered = true;
  next.humanTransfer.state = choice === "accept" ? "requested" : "declined";
  return next;
}

export function publicView(session, data) {
  const claimAccess = session.verifiedPartyId !== null;
  const resolvedClaim = claimAccess && session.resolvedCaseId
    ? data.claims.find((claim) => claim.case_id === session.resolvedCaseId) ?? null
    : null;

  return {
    phase: session.phase,
    identity: {
      providedFields: PII_FIELDS.filter((field) => hasValue(session.identity[field])),
      matchingFields: [...session.verification.matchingFields],
      verified: Boolean(session.verifiedPartyId),
    },
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
  const candidates = policyholders
    .map((party) => ({ party, matchingFields: matchingPiiFields(identity, party) }))
    .filter(({ party, matchingFields }) =>
      matchingFields.length > 0 || policyNumberMatches(identity.policyNumber, party.policy_number),
    );

  const policyMatches = candidates.filter(({ party }) => policyNumberMatches(identity.policyNumber, party.policy_number));
  const pool = policyMatches.length === 1 ? policyMatches : candidates;
  const bestCount = Math.max(0, ...pool.map(({ matchingFields }) => matchingFields.length));
  const best = pool.filter(({ matchingFields }) => matchingFields.length === bestCount);

  if (best.length !== 1) return { candidatePartyId: null, matchingFields: [] };
  return {
    candidatePartyId: best[0].party.party_id,
    matchingFields: best[0].matchingFields,
  };
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

function shouldRetargetResolvedCase(session, observation = {}, data) {
  if (session.phase !== PHASES.PROCESS_CASE || !session.verifiedPartyId || !session.resolvedCaseId) return false;
  const hint = observation.caseHint ?? {};
  if (!Object.values(hint).some(hasValue)) return false;

  const claim = data.claims.find((item) =>
    item.case_id === session.resolvedCaseId && item.party_id === session.verifiedPartyId,
  );
  if (!claim) return false;

  if (hasValue(hint.caseId) && normalizeCaseId(hint.caseId) !== normalizeCaseId(claim.case_id)) return true;
  if (hasValue(hint.caseType) && normalizeCaseType(hint.caseType) !== claim.case_type) return true;
  if (hasValue(hint.status) && normalizeStatus(hint.status) !== claim.status) return true;
  if (hasValue(hint.year) && Number(hint.year) !== Number(claim.created_at.slice(0, 4))) return true;
  if (hasValue(hint.month) && Number(hint.month) !== Number(claim.created_at.slice(5, 7))) return true;
  return false;
}

function resetResolvedCaseTarget(session) {
  session.phase = PHASES.RESOLVE_INTENT;
  session.caseHint = {};
  session.caseResolution = { status: "unresolved", candidateCaseIds: [] };
  session.resolvedCaseId = null;
  session.intent = null;
  session.humanTransferOffered = false;
  session.humanTransfer = { state: "not_offered" };
  session.emailSummary = { state: "not_offered" };
}

function mergeObservation(session, observation = {}) {
  if (observation.identity) {
    for (const [key, value] of Object.entries(observation.identity)) {
      if (hasValue(value)) session.identity[key] = String(value).trim();
    }
  }
  if (observation.caseHint) {
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
  if (hasValue(observation.intent)) session.intent = observation.intent;
  if (hasValue(observation.emotion)) session.emotion = observation.emotion;
  if (typeof observation.refusal === "boolean") session.refusal = observation.refusal;
  if (hasValue(observation.scope)) session.lastScope = observation.scope;
}

function setHumanTransferPending(session) {
  session.humanTransferOffered = true;
  if (!session.humanTransfer) session.humanTransfer = { state: "not_offered" };
  if (session.humanTransfer.state === "not_offered") {
    session.humanTransfer.state = "awaiting_choice";
  }
}

function matchingPiiFields(identity, party) {
  const fields = [];
  if (hasValue(identity.name) && anyEqual(identity.name, [party.name, ...(party.name_aliases ?? [])], normalizeName)) fields.push("name");
  if (hasValue(identity.dob) && normalizeDate(identity.dob) === normalizeDate(party.dob)) fields.push("dob");
  if (hasValue(identity.phone) && anyEqual(identity.phone, [party.phone, ...(party.phone_aliases ?? [])], normalizePhone)) fields.push("phone");
  if (hasValue(identity.email) && anyEqual(identity.email, [party.email, ...(party.email_aliases ?? [])], normalizeEmail)) fields.push("email");
  if (hasValue(identity.idLast4) && normalizeIdLast4(identity.idLast4) === normalizeIdLast4(party.id_last4)) fields.push("idLast4");
  return fields;
}

function anyEqual(value, candidates, normalize) {
  const target = normalize(value);
  return target !== "" && candidates.some((candidate) => normalize(candidate) === target);
}

function policyNumberMatches(value, expected) {
  return hasValue(value) && String(value).trim().toUpperCase() === String(expected).trim().toUpperCase();
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
