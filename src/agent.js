import { applyObservation } from "./controller.js";
import { buildResponsePlan } from "./response-plan.js";

export async function runAgentTurn({ session, userText, data, model }) {
  const observation = await model.observe(userText);
  const advanced = applyObservation(session, observation, data);
  const plan = buildResponsePlan({
    session: advanced.session,
    observation,
    userText,
    data,
  });
  const text = await model.phrase({ userText, plan });
  return {
    session: advanced.session,
    events: advanced.events,
    observation,
    plan,
    text,
    view: advanced.view,
  };
}
