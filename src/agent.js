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

const GENERIC_ACCEPT = new Set([
  "yes",
  "yes please",
  "yeah",
  "yep",
  "sure",
  "ok",
  "okay",
  "please do",
  "do it",
]);

const GENERIC_DECLINE = new Set([
  "no",
  "no thanks",
  "no thank you",
  "not now",
  "nope",
  "don't",
  "do not",
]);

const HUMAN_TRANSFER_ACCEPT = new Set([
  ...GENERIC_ACCEPT,
  "connect me",
  "transfer me",
  "request human representative",
]);

const HUMAN_TRANSFER_DECLINE = new Set([
  ...GENERIC_DECLINE,
  "continue here",
]);

const EMAIL_SUMMARY_SEND = new Set([
  ...GENERIC_ACCEPT,
  "send email summary",
]);
const EMAIL_SUMMARY_SKIP = new Set([
  ...GENERIC_DECLINE,
  "skip email",
]);

export async function runAgentTurn({
  session,
  userText,
  data,
  model,
  previousAssistantText = null,
  asOfDate = new Date().toISOString().slice(0, 10),
}) {
  const deterministicChoice = classifyActiveClosedChoice(session, userText);
  if (deterministicChoice?.kind === "human_transfer") {
    const current = chooseHumanTransfer(session, deterministicChoice.choice);
    const requested = deterministicChoice.choice === "accept";
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
      observation: { humanTransferChoice: deterministicChoice.choice },
      task: "record_human_transfer_choice",
      text,
    });
  }

  if (deterministicChoice?.kind === "email_summary") {
    const current = chooseEmailSummary(session, deterministicChoice.choice);
    const event = { type: "email_summary_choice", choice: deterministicChoice.choice };
    const text = deterministicChoice.choice === "send"
      ? "Okay — I’ll prepare the conversation summary for the email address on your policy."
      : "Okay — I’ll skip the email summary.";
    return deterministicChoiceResult({
      session,
      current,
      data,
      previousAssistantText,
      event,
      observation: { postProcessChoice: deterministicChoice.choice },
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

  const humanChoiceHandled = events.some((event) =>
    event.type === "human_transfer_requested" || event.type === "human_transfer_declined",
  );

  if (current.phase === PHASES.PROCESS_CASE && observation.intent === "end_case") {
    current = markCaseComplete(current);
    events.push({ type: "case_completed" });
  } else if (
    !humanChoiceHandled
    && current.phase === PHASES.POST_PROCESS
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

function classifyActiveClosedChoice(session, userText) {
  const normalized = normalizeClosedChoice(userText);

  if (session.phase === PHASES.POST_PROCESS && session.emailSummary?.state === "awaiting_choice") {
    if (EMAIL_SUMMARY_SEND.has(normalized)) return { kind: "email_summary", choice: "send" };
    if (EMAIL_SUMMARY_SKIP.has(normalized)) return { kind: "email_summary", choice: "skip" };
    return null;
  }

  if (session.humanTransfer?.state === "awaiting_choice") {
    if (HUMAN_TRANSFER_ACCEPT.has(normalized)) return { kind: "human_transfer", choice: "accept" };
    if (HUMAN_TRANSFER_DECLINE.has(normalized)) return { kind: "human_transfer", choice: "decline" };
  }

  return null;
}

function normalizeClosedChoice(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");
}
