import { readFileSync } from "node:fs";
import { buildSurfacePolishEvaluationReport } from "../src/features/ai/surface-polish-evaluation.ts";

function loadSurfacePolishEvalSet() {
  const raw = readFileSync(new URL("../data/ai/surface-polish-eval-set.json", import.meta.url), "utf8");
  return JSON.parse(raw);
}

function main() {
  const report = buildSurfacePolishEvaluationReport(loadSurfacePolishEvalSet());

  console.log(JSON.stringify(report, null, 2));

  if (report.failedCases > 0) {
    process.exitCode = 1;
  }
}

main();
