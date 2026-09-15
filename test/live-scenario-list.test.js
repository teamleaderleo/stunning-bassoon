import test from "node:test";
import assert from "node:assert/strict";

import { LIVE_SCENARIO_IDS, selectLiveScenarioIds } from "../eval/list-live-scenarios.js";

test("live scenario matrix includes every current scripted scenario", () => {
  assert.equal(LIVE_SCENARIO_IDS.length, 17);
  assert.deepEqual(LIVE_SCENARIO_IDS.slice(-4), [
    "natural-human-transfer",
    "claim-switch-vs-secondary-mention",
    "principal-replacement",
    "late-representative-disclosure",
  ]);
});

test("live scenario matrix can select a targeted subset without duplicates", () => {
  assert.deepEqual(
    selectLiveScenarioIds("principal-replacement,natural-human-transfer,principal-replacement"),
    ["principal-replacement", "natural-human-transfer"],
  );
});

test("live scenario matrix rejects unknown targeted ids", () => {
  assert.throws(
    () => selectLiveScenarioIds("principal-replacement,does-not-exist"),
    /unknown live scenario\(s\): does-not-exist/,
  );
});
