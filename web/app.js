let sessionId = null;

const messages = document.querySelector("#messages");
const form = document.querySelector("#chat-form");
const input = document.querySelector("#message");
const reset = document.querySelector("#reset");

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
  addMessage("user", text);
  input.value = "";
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
});

reset.addEventListener("click", start);

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

  const card = document.querySelector("#email-card");
  card.hidden = !emailPreview;
  if (emailPreview) {
    document.querySelector("#email-meta").textContent = `To: ${emailPreview.to} · ${emailPreview.subject}`;
    document.querySelector("#email-body").textContent = emailPreview.body;
  }
}

function humanTransferLabel(view) {
  const state = view.humanTransfer?.state;
  if (state === "awaiting_choice") return "offered · awaiting choice";
  if (state === "requested") return "requested";
  if (state === "declined") return "declined";
  return view.humanTransferOffered ? "offered" : "not needed";
}

function setBusy(busy) {
  input.disabled = busy;
  form.querySelector("button").disabled = busy;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

start();
