import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [inputDir = "report/scenarios", outputDir = "report"] = process.argv.slice(2);
await mkdir(outputDir, { recursive: true });

const files = (await readdir(inputDir)).filter((name) => name.endsWith(".json")).sort();
const runs = [];
for (const file of files) {
  const parsed = JSON.parse(await readFile(path.join(inputDir, file), "utf8"));
  for (const result of parsed.scenarioResults ?? []) runs.push(result);
}

runs.sort((a, b) => a.id.localeCompare(b.id));
const passed = runs.filter((item) => item.status === "pass").length;
const failed = runs.length - passed;
const summary = {
  generatedAt: new Date().toISOString(),
  total: runs.length,
  passed,
  failed,
  model: [...new Set(runs.map((item) => item.model).filter(Boolean))],
  reasoningEffort: [...new Set(runs.map((item) => item.reasoningEffort).filter(Boolean))],
  asOfDate: [...new Set(runs.map((item) => item.asOfDate).filter(Boolean))],
  scenarios: runs.map((item) => ({
    id: item.id,
    status: item.status,
    durationMs: item.durationMs,
    finalState: item.finalState,
    error: item.error ?? null,
  })),
};

await writeFile(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
const markdown = [
  "# Live eval report",
  "",
  `**Result:** ${passed}/${runs.length} passed`,
  `**Model:** ${summary.model.join(", ") || "unknown"}`,
  `**Reasoning:** ${summary.reasoningEffort.join(", ") || "provider-default"}`,
  `**As of:** ${summary.asOfDate.join(", ") || "unknown"}`,
  "",
  "| Scenario | Result | Duration | Final state |",
  "| --- | --- | ---: | --- |",
  ...runs.map((item) => `| ${item.id} | ${item.status.toUpperCase()} | ${item.durationMs} ms | ${item.finalState?.phase ?? "unknown"}${item.finalState?.resolvedCaseId ? ` / ${item.finalState.resolvedCaseId}` : ""} |`),
  "",
  failed ? "See the per-scenario JSON files for transcripts and failure details." : "All scripted live-model scenarios passed.",
  "",
].join("\n");
await writeFile(path.join(outputDir, "summary.md"), markdown);
console.log(markdown);
if (failed || runs.length === 0) process.exitCode = 1;
