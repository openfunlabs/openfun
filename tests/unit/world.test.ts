import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WorldStore } from "../../src/world/world.js";

test("exploration, player actions, revisits and process restart preserve authoritative state", () => {
  const dir = mkdtempSync(join(tmpdir(), "openfun-state-"));
  let store: WorldStore | undefined;
  try {
    store = WorldStore.create(dir, { name: "雨林", seed: "rain" });
    for (let x = -1; x <= 1; x++)
      for (let z = -1; z <= 1; z++) store.generateDemoChunk(x, z);
    const first = store.getSnapshot();
    assert.equal(first.chunks.length, 9);
    const original = store.getChunk(0, 0)!;
    const crystal = original.entities.find((e) => e.kind === "crystal")!;
    const command = {
      id: randomUUID(),
      type: "interact",
      entityId: crystal.id,
    };
    const result = store.applyCommand(command);
    assert.equal(store.applyCommand(command).revision, result.revision);
    assert.throws(
      () =>
        store!.applyCommand({
          ...command,
          type: "move",
          position: [0, 1.7, 8],
        }),
      /different contents/,
    );
    assert.throws(
      () => store!.applyCommand({ ...command, id: randomUUID() }),
      /already/,
    );
    const changed = store.getChunk(0, 0)!;
    store.getSnapshot(96, 0);
    store.getSnapshot(0, 0);
    assert.deepEqual(store.getChunk(0, 0), changed);
    store.updateSpec({ description: "新的历史发生了" });
    assert.equal(store.getSpec().seed, "rain");
    assert.deepEqual(store.getChunk(0, 0), changed);
    store.close();
    store = new WorldStore(dir);
    assert.deepEqual(store.getChunk(0, 0), changed);
    assert.equal(
      store.getChunk(0, 0)!.entities.find((e) => e.id === crystal.id)!.state
        .removed,
      true,
    );
    assert.throws(
      () => store!.updateSpec({ seed: "another" }),
      /seed is fixed/,
    );
  } finally {
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid content is rejected without partial chunk publication", () => {
  const dir = mkdtempSync(join(tmpdir(), "openfun-rollback-"));
  const store = WorldStore.create(dir, { name: "test" });
  try {
    assert.throws(
      () =>
        store.generateChunk(0, 0, {
          entities: [
            {
              kind: "tree",
              name: "outside",
              position: [100, 0, 0],
              color: "#ffffff",
            },
          ],
        }),
      /outside/,
    );
    assert.equal(store.inspect().chunks, 0);
    assert.equal(store.inspect().events, 0);
    assert.throws(
      () =>
        store.generateChunk(0, 0, {
          entities: [
            {
              kind: "tree",
              name: "missing",
              position: [1, 0, 0],
              color: "#ffffff",
              asset: "a".repeat(64) + ".glb",
            },
          ],
        }),
      /Missing asset/,
    );
    assert.equal(store.inspect().jobs, 0);
    assert.throws(() =>
      store.generateChunk(0, 0, { entities: [], script: "evil" }),
    );
    assert.throws(() => store.generateChunk(1e9, 0));
    assert.throws(() => store.updateSpec({ provider: "untrusted" }));
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("two processes requesting the same chunk produce one publication and one generation job", async () => {
  const dir = mkdtempSync(join(tmpdir(), "openfun-race-"));
  const initial = WorldStore.create(dir, { name: "race" });
  initial.close();
  try {
    const script = `import {WorldStore} from ${JSON.stringify(new URL("../../src/world/world.ts", import.meta.url).href)};const s=new WorldStore(process.env.OPENFUN_TEST_WORLD);s.generateDemoChunk(2,3);s.close();`;
    const exec = promisify(execFile);
    await Promise.all(
      [1, 2].map(() =>
        exec(
          process.execPath,
          ["--import", "tsx", "--input-type=module", "-e", script],
          { env: { ...process.env, OPENFUN_TEST_WORLD: dir } },
        ),
      ),
    );
    const store = new WorldStore(dir);
    try {
      assert.equal(store.inspect().chunks, 1);
      assert.equal(store.inspect().jobs, 1);
      assert.equal(store.inspect().events, 1);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("import preserves release and world identity but creates a distinct save and bounds spawn", () => {
  const dir = mkdtempSync(join(tmpdir(), "openfun-import-"));
  const source = WorldStore.create(join(dir, "source"), { name: "source" });
  try {
    source.generateDemoChunk(0, 0);
    const portable = source.exportWorld();
    assert.equal(source.exportWorld().releaseId, portable.releaseId);
    const restored = WorldStore.importWorld(join(dir, "copy"), portable);
    try {
      assert.equal(restored.inspect().worldId, source.inspect().worldId);
      assert.equal(restored.inspect().releaseId, portable.releaseId);
      assert.notEqual(restored.inspect().saveId, source.inspect().saveId);
    } finally {
      restored.close();
    }
    assert.throws(() =>
      WorldStore.importWorld(join(dir, "bad"), {
        ...portable,
        player: { position: [1e200, 0, 0] },
      }),
    );
  } finally {
    source.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
