import {
  applyObservation,
  chooseEmailSummary,
  chooseHumanTransfer,
  markCaseComplete,
  offerHumanTransfer,
  publicView,
} from "./controller.js";
import { PHASES } from "./domain.js";
import { classifyAppealDeadline } from "./grounding.js";
import { buildObservationContext } from "./observation-context.js";
import { buildResponsePlan } from "./response-plan.js";

const HUMAN_TRANSFER_ACCEPT = new Set([
  "yes",
  "yes please",
  "yeah",
  "yep",
  "sure",
  "ok",
  "okay",
  "please do",
  "do it",
  "connect me",
  "transfer me",
  "request human representative",
]);

const HUMAN_TRANSFER_DECLINE = new Set([
  "no",
  "no thanks",
  "no thank you",
  "not now",
  "nope",
  "don't",
  "do not",
  "continue here",
]);

const EMAIL_SUMMARY_SEND = new Set(["send email summary"]);
const EMAIL_SUMMARY_SKIP = new Set(["skip email"]);

export async function runAgentTurn({
  session,
  userText,
  data,
  model,
  previousAssistantText = null,
  asOfDate = new Date().toISOString().slice(0, 10),
}) {
  const deterministicTransferChoice = classifyPendingHumanTransferChoice(session, userText);
  if (deterministicTransferChoice) {
    const current = chooseHumanTransfer(session, deterministicTransferChoice);
    const requested = deterministicTransferChoice === "accept";
    const event = {
      type: requested ? "human_transfer_requested" : "human_transfer_declined",
    };
    const text = requested
      ? "Okay — I’ve recorded that you want a human representative. This demo does not connect to a live call-center system, so no live transfer has occurred, but the handoff request is recorded."
      : "Okay — I won’t request a human representative right now. We can continue with the information available here.";
    return deterministicChoiceResult({
      session,
      current,
      data,
      previousAssistantText,
      event,
      observation: { humanTransferChoice: deterministicTransferChoice },
      task: "record_human_transfer_choice",
      text,
    });
  }

  const deterministicEmailChoice = classifyPendingEmailSummaryChoice(session, userText);
  if (deterministicEmailChoice) {
    const current = chooseEmailSummary(session, deterministicEmailChoice);
    const event = { type: "email_summary_choice", choice: deterministicEmailChoice };
    const text = deterministicEmailChoice === "send"
      ? "Okay — I’ll prepare the conversation summary for the email address on your policy."
      : "Okay — I’ll skip the email summary.";
    return deterministicChoiceResult({
      session,
      current,
      data,
      previousAssistantText,
      event,
      observation: { postProcessChoice: deterministicEmailChoice },
      task: "record_email_summary_choice",
      text,
    });
  }

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
      const previousTransferState = current.humanTransfer?.state ?? "not_offered";
      current = offerHumanTransfer(current);
      if (previousTransferState === "not_offered") {
        events.push({
          type: "expired_appeal_requires_human",
          caseId: claim.case_id,
          appealDeadline: claim.appeal_deadline,
        });
      }
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

  const plan = buildResponsePlan({ session: current, observation, userText, data, asOfDate, events });
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

function deterministicChoiceResult({ session, current, data, previousAssistantText, event, observation, task, text }) {
  return {
    session: current,
    events: [event],
    observation,
    observationContext: buildObservationContext(session, previousAssistantText),
    plan: {
      phase: current.phase,
      task,
      humanTransfer: structuredClone(current.humanTransfer),
      emailSummary: structuredClone(current.emailSummary),
      protectedClaimDetailsAvailable: Boolean(current.verifiedPartyId),
    },
    text,
    view: publicView(current, data),
  };
}

function classifyPendingHumanTransferChoice(session, userText) {
  if (session.humanTransfer?.state !== "awaiting_choice") return null;
  const normalized = normalizeClosedChoice(userText);
  if (HUMAN_TRANSFER_ACCEPT.has(normalized)) return "accept";
  if (HUMAN_TRANSFER_DECLINE.has(normalized)) return "decline";
  return null;
}

function classifyPendingEmailSummaryChoice(session, userText) {
  if (session.phase !== PHASES.POST_PROCESS || session.emailSummary?.state !== "awaiting_choice") return null;
  const normalized = normalizeClosedChoice(userText);
  if (EMAIL_SUMMARY_SEND.has(normalized)) return "send";
  if (EMAIL_SUMMARY_SKIP.has(normalized)) return "skip";
  return null;
}

function normalizeClosedChoice(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");
}
