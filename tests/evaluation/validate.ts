import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { validateEvaluationReport } from "./report.js";

const [file, ...extra] = process.argv.slice(2);
if (!file || extra.length) {
  console.error(
    "Usage: node --import tsx tests/evaluation/validate.ts /path/to/run/review.json",
  );
  process.exitCode = 1;
} else {
  try {
    const path = resolve(file);
    const result = await validateEvaluationReport(
      JSON.parse(await readFile(path, "utf8")),
      dirname(path),
    );
    console.log(JSON.stringify(result, null, 2));
    if (!result.recordValid) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
