// Explicit paid quality test. Stable keys resume Meshy work instead of duplicating jobs.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { piRuntimePaths } from "../../src/agent/pi-environment.ts";
import { assetProvider } from "../../src/agent/asset-providers.ts";
import {
  animationLibrary,
  modelStatus,
  processModel,
} from "../../src/assets/meshy.ts";
const [directory, sourceKey, prefix, ...ids] = process.argv.slice(2);
assert.ok(
  directory && sourceKey && prefix && ids.length === 3,
  "animation <project> <existing-model-key> <revision-prefix> <attack-id> <hit-id> <death-id>: real Meshy credits; query the live catalog first",
);
const actionIds = ids.map(Number);
assert.ok(actionIds.every(Number.isSafeInteger));
const cwd = resolve(directory);
const runtime = await ModelRuntime.create({
  ...piRuntimePaths(),
  allowModelNetwork: false,
  refreshOnCreate: false,
});
runtime.registerNativeProvider(assetProvider("meshy"));
const ctx = {
  cwd,
  modelRegistry: {
    getApiKeyForProvider: async () =>
      (await runtime.getAuth("meshy"))?.auth.apiKey,
  },
};
const signal = AbortSignal.timeout(20 * 60 * 1000);
const catalog = await animationLibrary(ctx, { actionIds, limit: 100 }, signal);
for (const id of actionIds)
  assert.ok(
    catalog.actions.some((a) => a.action_id === id),
    `Unknown action ${id}`,
  );
const receipt = {
  sourceKey,
  catalog: catalog.actions,
  assets: {},
  note: "Actual API assets, not proof of motion quality. Inspect clips and render gameplay before acceptance.",
};
const dir = join(cwd, "artifacts", "animation");
await mkdir(dir, { recursive: true });
async function record() {
  await writeFile(
    join(dir, `${prefix}.json`),
    JSON.stringify(receipt, null, 2),
  );
}
async function wait(key) {
  while (true) {
    const result = await modelStatus(ctx, { key }, signal);
    console.log(JSON.stringify(result));
    if (result.asset) return result;
    assert.ok(
      result.taskId,
      `Uncertain submission for ${key}; recover the existing task ID before retrying`,
    );
    assert.ok(
      !["FAILED", "CANCELED"].includes(result.status),
      `Meshy ${key} ${result.status}`,
    );
    await setTimeout(10000, undefined, { signal });
  }
}
receipt.assets.source = await wait(sourceKey);
await record();
const rigKey = `${prefix}-rig`;
console.log(
  JSON.stringify(
    await processModel(
      ctx,
      { operation: "rig", key: rigKey, sourceKey, heightMeters: 1.7 },
      signal,
    ),
  ),
);
receipt.assets.rig = await wait(rigKey);
await record();
for (const [index, name] of ["attack", "hit", "death"].entries()) {
  console.log(
    JSON.stringify(
      await processModel(
        ctx,
        {
          operation: "animate",
          key: `${prefix}-${name}`,
          sourceKey: rigKey,
          actionId: actionIds[index],
        },
        signal,
      ),
    ),
  );
}
for (const name of ["attack", "hit", "death"]) {
  receipt.assets[name] = await wait(`${prefix}-${name}`);
  await record();
}
receipt.reportedCredits = Object.values(receipt.assets).reduce(
  (total, asset) => total + (asset.consumedCredits ?? 0),
  0,
);
await record();
console.log(
  JSON.stringify({
    readyForVisualReview: true,
    receipt: join(dir, `${prefix}.json`),
    reportedCredits: receipt.reportedCredits,
  }),
);
