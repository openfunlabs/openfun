// Explicit paid API test; rerunning the same key recovers its persisted task.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { piRuntimePaths } from "../../src/agent/pi-environment.ts";
import { assetProvider } from "../../src/agent/asset-providers.ts";
import { generateModel, modelStatus } from "../../src/assets/meshy.ts";
import { validateGlb } from "../../src/sharing/package.ts";

const [directory, reference, key] = process.argv.slice(2);
assert.ok(
  directory && reference && key,
  "Usage: pnpm test:live meshy <project-directory> <project-relative-reference.png> <asset-revision-key>. Uses separate Meshy credits.",
);
const runtime = await ModelRuntime.create({
  ...piRuntimePaths(),
  allowModelNetwork: false,
  refreshOnCreate: false,
});
runtime.registerNativeProvider(assetProvider("meshy"));
const ctx = {
  cwd: resolve(directory),
  modelRegistry: {
    getApiKeyForProvider: async () =>
      (await runtime.getAuth("meshy"))?.auth.apiKey,
  },
};
const signal = AbortSignal.timeout(12 * 60 * 1000);
let result = await generateModel(ctx, { key, reference }, signal);
console.log(JSON.stringify(result));
while (!result.asset) {
  assert.ok(
    result.taskId,
    "Submission is unresolved; check Meshy dashboard before creating another task.",
  );
  assert.ok(
    !["FAILED", "CANCELED"].includes(result.status),
    `Meshy task ${result.status}`,
  );
  await setTimeout(10000, undefined, { signal });
  result = await modelStatus(ctx, { key }, signal);
  console.log(JSON.stringify(result));
}
const bytes = await readFile(resolve(ctx.cwd, result.path));
validateGlb(bytes);
console.log(
  JSON.stringify({
    passed: true,
    taskId: result.taskId,
    path: result.path,
    bytes: bytes.length,
    note: "Real API and local GLB verified. Visual quality, rigging, animation and gameplay still require Godot/Blender review.",
  }),
);
