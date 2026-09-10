// Explicit public-network acceptance; no paid service or model calls.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  searchAssets,
  assetInfo,
  importAsset,
} from "../../src/assets/library.ts";
import { readDesignReference } from "../../src/agent/design-references.ts";
const cwd = resolve(process.argv[2] ?? ".output/resources-live");
await mkdir(cwd, { recursive: true });
const assets = {};
for (const [id, query, kind, ext] of [
  ["tiny-dungeon", "dungeon", "sprites", ".png"],
  ["interface-sounds", "interface", "audio", ".ogg"],
  ["mini-dungeon", "dungeon", "models", ".glb"],
]) {
  const search = await searchAssets(cwd, { source: "kenney", query, kind });
  assert.ok(search.results.some((r) => r.id === id));
  const info = await assetInfo({ provider: "kenney", id });
  assert.equal(info.asset.license, "CC0-1.0");
  const result = await importAsset(cwd, {
    provider: "kenney",
    id,
    variant: "pack",
  });
  assert.ok(
    result.files.some((p) => p.endsWith(ext)),
    `${id} must contain ${ext}`,
  );
  assets[id] = result;
  console.log(
    JSON.stringify({
      id,
      files: result.files.length,
      skipped: result.skippedFiles?.length,
      cached: result.cached,
    }),
  );
}
const references = [];
for (const [id, find] of [
  ["ink-writing", "conditional"],
  ["mechanics-dynamics", "feedback"],
]) {
  const r = await readDesignReference({ id, find, length: 1000 });
  assert.ok(r.text?.length > 100);
  references.push({ id, url: r.url, characters: r.text.length });
}
const fetch = globalThis.fetch;
try {
  globalThis.fetch = async () => {
    throw new Error("offline acceptance");
  };
  for (const id of Object.keys(assets))
    assert.equal(
      (await importAsset(cwd, { provider: "kenney", id, variant: "pack" }))
        .cached,
      true,
    );
} finally {
  globalThis.fetch = fetch;
}
const report = {
  passed: true,
  assets,
  references,
  offlineReuse: true,
  paidTasks: 0,
  modelRequests: 0,
};
await writeFile(join(cwd, "report.json"), JSON.stringify(report, null, 2));
console.log("Resources and reference reading passed");
