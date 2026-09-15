import {
  applyObservation,
  chooseEmailSummary,
  markCaseComplete,
  publicView,
} from "./controller.js";
import { PHASES } from "./domain.js";
import { buildResponsePlan } from "./response-plan.js";

export async function runAgentTurn({ session, userText, data, model }) {
  const observation = await model.observe(userText);
  const advanced = applyObservation(session, observation, data);
  let current = advanced.session;
  const events = [...advanced.events];

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

  const plan = buildResponsePlan({ session: current, observation, userText, data });
  const text = await model.phrase({ userText, plan });
  return {
    session: current,
    events,
    observation,
    plan,
    text,
    view: publicView(current, data),
  };
}
