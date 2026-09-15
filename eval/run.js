import { runAgentTurn } from "../src/agent.js";
import { newSession } from "../src/controller.js";
import { loadFixtures } from "../src/data.js";
import { scenarios } from "./scenarios.js";

const data = loadFixtures();
let failures = 0;

for (const scenario of scenarios) {
  let session = newSession();
  const timeline = [];
  const allEvents = [];

  for (const turn of scenario.turns) {
    const before = session.phase;
    const model = {
      async observe() { return structuredClone(turn.observation); },
      async phrase({ plan }) { return `[${plan.task}]`; },
    };
    const result = await runAgentTurn({ session, userText: turn.text, data, model });
    session = result.session;
    timeline.push(`${before}->${session.phase}`);
    allEvents.push(...result.events);
  }

  const errors = checkExpectations(session, allEvents, scenario.expect, data);
  if (errors.length) {
    failures += 1;
    console.log(`FAIL ${scenario.id}`);
    console.log(`  ${scenario.description}`);
    console.log(`  timeline: ${timeline.join(" | ")}`);
    for (const error of errors) console.log(`  - ${error}`);
  } else {
    console.log(`PASS ${scenario.id}`);
    console.log(`  timeline: ${timeline.join(" | ")}`);
    if (allEvents.length) console.log(`  events: ${allEvents.map((event) => event.type).join(", ")}`);
  }
}

console.log(`\n${scenarios.length - failures}/${scenarios.length} scenarios passed`);
if (failures) process.exitCode = 1;

function checkExpectations(session, events, expect, data) {
  const errors = [];
  const resolvedClaim = session.verifiedPartyId && session.resolvedCaseId
    ? data.claims.find((claim) => claim.party_id === session.verifiedPartyId && claim.case_id === session.resolvedCaseId) ?? null
    : null;
  const actual = {
    phase: session.phase,
    verifiedPartyId: session.verifiedPartyId,
    resolvedCaseId: session.resolvedCaseId,
    claimAccess: session.verifiedPartyId ? "unlocked" : "locked",
    matchingFieldCount: session.verification.matchingFields.length,
    rememberedStatus: session.caseHint.status,
    identityName: session.identity.name,
    outOfScopeAttempts: session.outOfScopeAttempts,
    humanTransferOffered: session.humanTransferOffered,
    caseResolutionStatus: session.caseResolution.status,
    candidateCaseIds: [...session.caseResolution.candidateCaseIds].sort(),
    emailSummaryState: session.emailSummary.state,
    eventType: events.at(-1)?.type ?? null,
    resolvedClaimStatus: resolvedClaim?.status ?? null,
  };

  for (const [key, wanted] of Object.entries(expect)) {
    const got = actual[key];
    const equal = Array.isArray(wanted)
      ? JSON.stringify(got) === JSON.stringify([...wanted].sort())
      : got === wanted;
    if (!equal) errors.push(`${key}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(got)}`);
  }
  return errors;
}
