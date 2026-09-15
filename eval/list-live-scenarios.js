export const LIVE_SCENARIO_IDS = [
  "margaret-one-turn",
  "preverify-injection",
  "angry-refusal",
  "mixed-scope",
  "alias-verification",
  "representative-fails-closed",
  "repeated-out-of-scope-escalates",
  "terse-verification-handoff",
  "ambiguous-january-clarification",
  "open-auto-claim",
  "unsupported-auto-data",
  "post-process-skip-email",
  "retarget-selected-claim",
  "natural-human-transfer",
  "claim-switch-vs-secondary-mention",
  "principal-replacement",
  "late-representative-disclosure",
];

export function selectLiveScenarioIds(filter = "") {
  const requested = String(filter)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (requested.length === 0) return [...LIVE_SCENARIO_IDS];

  const unknown = requested.filter((id) => !LIVE_SCENARIO_IDS.includes(id));
  if (unknown.length > 0) {
    throw new Error(`unknown live scenario(s): ${unknown.join(", ")}`);
  }

  return [...new Set(requested)];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(JSON.stringify(selectLiveScenarioIds(process.argv[2] ?? "")));
}
