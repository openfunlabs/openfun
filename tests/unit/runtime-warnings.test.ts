import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
const run = promisify(execFile);
const filter = new URL("../../src/runtime-warnings.ts", import.meta.url).href;

test("startup filters only SQLite's experimental warning and preserves diagnostics", async () => {
  const result = await run(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      "--import",
      filter,
      "--input-type=module",
      "-e",
      `
    await import("node:sqlite");
    process.emitWarning("OTHER_EXPERIMENTAL_FEATURE", "ExperimentalWarning");
    process.emitWarning("IMPORTANT_DEPRECATION", "DeprecationWarning");
    process.emitWarning("APPLICATION_WARNING");
    console.log("ready");
  `,
    ],
    { env: { ...process.env, OPENFUN_SHOW_RUNTIME_WARNINGS: "0" } },
  );
  assert.doesNotMatch(result.stderr, /SQLite is an experimental feature/);
  for (const message of [
    "OTHER_EXPERIMENTAL_FEATURE",
    "IMPORTANT_DEPRECATION",
    "APPLICATION_WARNING",
  ])
    assert.match(result.stderr, new RegExp(message));
  assert.match(result.stdout, /ready/);
});

test("SQLite runtime diagnostics can be explicitly restored", async () => {
  const result = await run(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      "--import",
      filter,
      "--input-type=module",
      "-e",
      'process.emitWarning("SQLite is an experimental feature and might change at any time", "ExperimentalWarning");',
    ],
    { env: { ...process.env, OPENFUN_SHOW_RUNTIME_WARNINGS: "1" } },
  );
  assert.match(result.stderr, /SQLite is an experimental feature/);
});
