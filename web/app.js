let sessionId = null;
let busy = false;

const messages = document.querySelector("#messages");
const form = document.querySelector("#chat-form");
const input = document.querySelector("#message");
const reset = document.querySelector("#reset");
const workflowActions = document.querySelector("#workflow-actions");

async function start() {
  const response = await fetch("/api/session", { method: "POST" });
  const data = await response.json();
  sessionId = data.sessionId;
  messages.replaceChildren();
  addMessage("agent", "Hi. I can help with an insurance claim. Before I can discuss protected claim details, I’ll need to verify your identity.");
  render(data.view, null);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  await submitTurn(text);
});

reset.addEventListener("click", start);

async function submitTurn(text) {
  if (busy || !sessionId) return;
  addMessage("user", text);
  setBusy(true);
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, text }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "request failed");
    addMessage("agent", data.text);
    render(data.view, data.emailPreview);
  } catch (error) {
    addMessage("system", `Request failed: ${error.message}`);
  } finally {
    setBusy(false);
    input.focus();
  }
}

function addMessage(kind, text) {
  const item = document.createElement("div");
  item.className = `message ${kind}`;
  item.textContent = text;
  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
}

function render(view, emailPreview) {
  document.querySelector("#phase").textContent = view.phase;
  document.querySelector("#audit").innerHTML = [
    ["Identity", view.identity.verified ? "verified" : `${view.identity.matchingFields.length}/3 matching PII`],
    ["Matching fields", view.identity.matchingFields.join(", ") || "none yet"],
    ["Claim access", view.claimAccess],
    ["Case resolution", view.caseResolution.status],
    ["Irrelevant retries", String(view.outOfScopeAttempts)],
    ["Human transfer", humanTransferLabel(view)],
    ["Email summary", view.emailSummary.state],
  ].map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join("");
  document.querySelector("#hint").textContent = JSON.stringify(view.rememberedCaseHint, null, 2);
  document.querySelector("#claim").textContent = view.resolvedClaim ? JSON.stringify(view.resolvedClaim, null, 2) : "Locked / unresolved";

  renderWorkflowActions(view);

  const card = document.querySelector("#email-card");
  card.hidden = !emailPreview;
  if (emailPreview) {
    document.querySelector("#email-meta").textContent = `To: ${emailPreview.to} · ${emailPreview.subject}`;
    document.querySelector("#email-body").textContent = emailPreview.body;
  }
}

function renderWorkflowActions(view) {
  const actions = [];

  if (view.humanTransfer?.state === "awaiting_choice") {
    actions.push(
      { label: "Request human representative", text: "request human representative" },
      { label: "Continue here", text: "continue here", secondary: true },
    );
  } else if (view.emailSummary?.state === "awaiting_choice") {
    actions.push(
      { label: "Send email summary", text: "send email summary" },
      { label: "Skip email", text: "skip email", secondary: true },
    );
  }

  workflowActions.replaceChildren();
  workflowActions.hidden = actions.length === 0;
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.disabled = busy;
    if (action.secondary) button.classList.add("secondary");
    button.addEventListener("click", () => submitTurn(action.text));
    workflowActions.append(button);
  }
}

function humanTransferLabel(view) {
  const state = view.humanTransfer?.state;
  if (state === "awaiting_choice") return "offered · awaiting choice";
  if (state === "requested") return "requested";
  if (state === "declined") return "declined";
  return view.humanTransferOffered ? "offered" : "not needed";
}

function setBusy(value) {
  busy = value;
  input.disabled = value;
  form.querySelector("button").disabled = value;
  for (const button of workflowActions.querySelectorAll("button")) button.disabled = value;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

start();
