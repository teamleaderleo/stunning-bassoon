import {
  applyObservation,
  chooseEmailSummary,
  markCaseComplete,
  publicView,
} from "./controller.js";
import { PHASES } from "./domain.js";
import { classifyAppealDeadline } from "./grounding.js";
import { buildObservationContext } from "./observation-context.js";
import { buildResponsePlan } from "./response-plan.js";

export async function runAgentTurn({
  session,
  userText,
  data,
  model,
  previousAssistantText = null,
  asOfDate = new Date().toISOString().slice(0, 10),
}) {
  const observationContext = buildObservationContext(session, previousAssistantText);
  const observation = await model.observe(userText, observationContext);
  const advanced = applyObservation(session, observation, data);
  let current = advanced.session;
  const events = [...advanced.events];

  if (current.phase === PHASES.PROCESS_CASE && current.resolvedCaseId) {
    const claim = data.claims.find((item) =>
      item.case_id === current.resolvedCaseId && item.party_id === current.verifiedPartyId,
    );
    if (claim && classifyAppealDeadline(claim.appeal_deadline, asOfDate).status === "expired") {
      current = structuredClone(current);
      current.humanTransferOffered = true;
      events.push({
        type: "expired_appeal_requires_human",
        caseId: claim.case_id,
        appealDeadline: claim.appeal_deadline,
      });
    }
  }

  if (current.phase === PHASES.PROCESS_CASE && observation.intent === "end_case") {
    current = markCaseComplete(current);
    events.push({ type: "case_completed" });
  } else if (
    current.phase === PHASES.POST_PROCESS
    && current.emailSummary.state === "awaiting_choice"
    && (observation.postProcessChoice === "send" || observation.postProcessChoice === "skip")
  ) {
    current = chooseEmailSummary(current, observation.postProcessChoice);
    events.push({ type: "email_summary_choice", choice: observation.postProcessChoice });
  }

  const plan = buildResponsePlan({ session: current, observation, userText, data, asOfDate });
  const text = await model.phrase({ userText, plan });
  return {
    session: current,
    events,
    observation,
    observationContext,
    plan,
    text,
    view: publicView(current, data),
  };
}
