// Headless simulation with installed engines; no model calls, original save unchanged.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WorldStore } from "../../src/world/world.ts";
import { ensureGameProject } from "../../src/godot/project.ts";
import {
  ContentStore,
  exportRuntimeData,
} from "../../src/generation/content-store.ts";
import { captureGamePreview } from "../../src/godot/preview.ts";

const root = await mkdtemp(join(tmpdir(), "openfun-preview-smoke-"));
const artifacts = resolve(".output/previews");
await mkdir(artifacts, { recursive: true });
const reports = [];
try {
  for (const engine of ["godot"]) {
    const world = join(root, engine);
    WorldStore.create(world, { name: `${engine} preview isolation` }).close();
    await ensureGameProject(
      world,
      new URL("../fixtures/games/exploration-3d", import.meta.url).pathname,
    );
    const contents = new ContentStore(world);
    contents.saveState({
      namespace: "preview-sentinel",
      expectedRevision: 0,
      state: { chapter: 3, inventory: ["player-keeps-this"] },
    });
    contents.close();
    const snapshot = () => {
      const store = new WorldStore(world);
      try {
        return JSON.stringify(store.getSnapshot());
      } finally {
        store.close();
      }
    };
    const originalSnapshot = snapshot();
    const before = JSON.stringify(exportRuntimeData(world));
    const result = await captureGamePreview(world, { seconds: 2, demo: true });
    assert.equal(result.isolatedSave, true);
    assert.equal(result.newModelBudget, 0);
    assert.equal(JSON.stringify(exportRuntimeData(world)), before);
    assert.equal(snapshot(), originalSnapshot);
    assert.equal(result.mode, "headless");
    assert.equal(result.imagePath, null);
    assert.deepEqual(result.frames, []);
    assert.equal(result.visualVerification, "unverified-no-rendering");
    assert.equal(result.observation.displayDriver, "headless");
    assert.ok(result.observation.elapsedSeconds >= 2);
    assert.deepEqual(result.consoleErrors, []);
    reports.push({
      ...result,
      originalSaveUnchanged: true,
    });
    console.log(
      JSON.stringify({
        engine,
        width: result.width,
        height: result.height,
        originalSaveUnchanged: true,
      }),
    );
  }
  await writeFile(
    join(artifacts, "report.json"),
    JSON.stringify({ passed: true, reports }, null, 2),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
