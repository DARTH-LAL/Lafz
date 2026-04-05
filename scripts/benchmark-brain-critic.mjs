import { readFileSync } from "node:fs";
import { buildBrainCriticEvaluationReport } from "../src/features/brain/critic-evaluation.ts";

function loadCriticEvalSet() {
  const raw = readFileSync(new URL("../data/brain/critic-eval-set.json", import.meta.url), "utf8");
  return JSON.parse(raw);
}

function main() {
  const report = buildBrainCriticEvaluationReport(loadCriticEvalSet());

  console.log(JSON.stringify(report, null, 2));

  if (report.failedCases > 0) {
    process.exitCode = 1;
  }
}

main();

