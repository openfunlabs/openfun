// Explicit network test: official free catalogs, no model requests or paid tasks.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  searchAssets,
  assetInfo,
  importAsset,
} from "../../src/assets/library.ts";
const cwd = resolve(process.argv[2] ?? ".output/library-live");
await mkdir(cwd, { recursive: true });
const searches = await Promise.all([
  searchAssets(cwd, {
    source: "polyhaven",
    query: "wooden crate",
    kind: "models",
  }),
  searchAssets(cwd, {
    source: "ambientcg",
    query: "wood",
    kind: "textures",
    limit: 3,
  }),
]);
assert.ok(searches.every((s) => s.results.length > 0));
const modelId =
  searches[0].results.find((a) => a.id === "wooden_crate_01")?.id ??
  searches[0].results[0].id;
const materialId = searches[1].results[0].id;
const modelInfo = await assetInfo({ provider: "polyhaven", id: modelId });
const materialInfo = await assetInfo({ provider: "ambientcg", id: materialId });
const modelVariant = modelInfo.variants.find((v) => v.key === "gltf/1k/gltf");
const materialVariant = materialInfo.variants.find(
  (v) => v.key === "default/1K-JPG",
);
assert.ok(modelVariant);
assert.ok(materialVariant);
const model = await importAsset(cwd, {
  provider: "polyhaven",
  id: modelId,
  variant: modelVariant.key,
});
const material = await importAsset(cwd, {
  provider: "ambientcg",
  id: materialId,
  variant: materialVariant.key,
});
assert.ok(model.files.some((p) => p.endsWith(".gltf")));
assert.ok(model.files.some((p) => p.endsWith(".jpg")));
assert.ok(material.files.some((p) => /Color\.(jpg|png)$/.test(p)));
const nativeFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => {
    throw new Error("Offline reuse test");
  };
  assert.equal(
    (
      await importAsset(cwd, {
        provider: "polyhaven",
        id: modelId,
        variant: modelVariant.key,
      })
    ).cached,
    true,
  );
  assert.equal(
    (
      await importAsset(cwd, {
        provider: "ambientcg",
        id: materialId,
        variant: materialVariant.key,
      })
    ).cached,
    true,
  );
} finally {
  globalThis.fetch = nativeFetch;
}
const report = {
  passed: true,
  model,
  material,
  offlineReuse: true,
  modelRequests: 0,
  paidTasks: 0,
};
await writeFile(join(cwd, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
