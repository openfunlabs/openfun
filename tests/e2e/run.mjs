import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { resolveTool } from "../../src/paths.ts";
import { root, output, version } from "../helpers/paths.mjs";
import { runScript } from "../helpers/process.mjs";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: { cli: { type: "string" } },
});
const cli = resolve(values.cli ?? resolve(root, "dist/cli.js"));
const godot = resolveTool("godot"),
  blender = resolveTool("blender");
if (!godot || !blender)
  throw new Error("Install/configure Godot and Blender before e2e tests.");
await mkdir(output(), { recursive: true });
const checks = [
  ["installation", [cli, godot]],
  ["plugins", [cli]],
  ["resources", [godot]],
  ["assets", []],
  ["roguelite", []],
  ["streaming", []],
  ["preview", []],
  ["motion", []],
];
const report = {
  version,
  cli,
  godot,
  blender,
  passed: false,
  modelRequests: 0,
  completed: [],
};
try {
  for (const [name, args] of checks) {
    console.log(`Running ${name}`);
    await runScript(`tests/e2e/${name}.mjs`, args);
    report.completed.push(name);
  }
  report.passed = true;
} finally {
  await writeFile(output("e2e.json"), JSON.stringify(report, null, 2));
}
