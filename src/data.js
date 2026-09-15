import { readFileSync } from "node:fs";

function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));
}

export function loadFixtures() {
  return {
    policyholders: fixture("policyholders.json"),
    claims: fixture("claims.json"),
    representatives: fixture("representatives.json"),
    consentScenarios: fixture("consent_scenarios.json"),
    claimSchema: fixture("claim_schema.json"),
    requiredDocumentGuideline: fixture("required_document_guideline.json"),
  };
}
