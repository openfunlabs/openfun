import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { unzipSync, zipSync } from "fflate";
import {
  ContentStore,
  exportRuntimeData,
} from "../../src/generation/content-store.js";
import {
  ensureGameProject,
  inspectGameProject,
  requireProjectTrust,
} from "../../src/godot/project.js";
import { importWorld, packWorld } from "../../src/sharing/package.js";
import { WorldStore } from "../../src/world/world.js";

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "openfun-runtime-package-"));
  const world = join(root, "world");
  WorldStore.create(world, { name: "Shared Tidal Post" }).close();
  const game = await ensureGameProject(world);
  return {
    root,
    world,
    game,
    archive: join(root, "world.openfun"),
    target: join(root, "imported"),
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}
function rewrite(
  path: string,
  edit: (files: Record<string, Uint8Array>, manifest: any) => void,
) {
  const files = unzipSync(readFileSync(path));
  const manifest = JSON.parse(Buffer.from(files["manifest.json"]!).toString());
  edit(files, manifest);
  manifest.files = Object.fromEntries(
    Object.entries(files)
      .filter(([name]) => name !== "manifest.json")
      .map(([name, bytes]) => [
        name,
        {
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      ]),
  );
  files["manifest.json"] = Buffer.from(JSON.stringify(manifest));
  writeFileSync(path, zipSync(files));
}

test("game sharing rejects common cloud and OAuth credential files before publishing an archive", async (t) => {
  const f = await fixture();
  t.after(f.remove);
  for (const name of [
    "service-account.json",
    "client_secret.json",
    "api-key.json",
  ]) {
    writeFileSync(
      join(f.game, name),
      JSON.stringify({ private_key: "PRIVATE TEST CREDENTIAL" }),
    );
    await assert.rejects(packWorld(f.world, f.archive), name);
    assert.ok(!existsSync(f.archive));
    rmSync(join(f.game, name));
  }
});

test("Godot sharing preserves source, binary resources, design and generic saves under one release", async (t) => {
  const f = await fixture();
  t.after(f.remove);
  const extra = {
    "custom.gd": Buffer.from("extends Node\nvar collected_mail = 3\n"),
    "art/texture.png": Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
      "base64",
    ),
    "art/mesh.bin": Buffer.from([0, 1, 255, 8, 7, 6]),
    "audio/effect.ogg": Buffer.from("OggS fixture audio bytes"),
  };
  for (const [path, bytes] of Object.entries(extra)) {
    const parent = path.includes("/")
      ? path.slice(0, path.lastIndexOf("/"))
      : "";
    mkdirSync(join(f.game, parent), { recursive: true });
    writeFileSync(join(f.game, path), bytes);
  }
  mkdirSync(join(f.world, "design"));
  writeFileSync(
    join(f.world, "design", "MAIL.md"),
    "The lighthouse keeps every delivered letter.",
  );
  const request = {
    namespace: "tidalpost",
    key: "island:2:v1",
    prompt: "Create an island",
    schema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
  };
  const store = new ContentStore(f.world);
  const job = store.insert(request);
  const running = store.claim(job.id)!;
  assert.equal(store.publish(running, { name: "Copper Island" }), true);
  store.saveState({
    namespace: "tidalpost",
    expectedRevision: 0,
    state: { letter: true, nextIslandJob: job.id, position: [6, 0, -2] },
  });
  store.close();
  const runtime = exportRuntimeData(f.world);
  const first = await packWorld(f.world, f.archive);
  assert.deepEqual(first.capabilities, [
    "world.snapshot.v1",
    "assets.glb.v2",
    "game.godot.v1",
    "game.state.v1",
  ]);
  const files = unzipSync(readFileSync(f.archive));
  assert.ok(!Object.keys(files).some((name) => name.includes("node_modules")));
  await importWorld(f.archive, f.target);
  assert.equal(inspectGameProject(f.target)?.engine, "godot");
  for (const [path, bytes] of Object.entries(extra))
    assert.deepEqual(readFileSync(join(f.target, "game", path)), bytes);
  assert.equal(
    readFileSync(join(f.target, "design", "MAIL.md"), "utf8"),
    "The lighthouse keeps every delivered letter.",
  );
  assert.deepEqual(exportRuntimeData(f.target), runtime);
  assert.throws(() => requireProjectTrust(f.target), /executable project code/);
  const imported = new ContentStore(f.target);
  try {
    assert.equal(imported.matchingJob(request)?.id, job.id);
    assert.throws(
      () => imported.matchingJob({ ...request, prompt: "A different island" }),
      /different|conflict|same key/i,
    );
  } finally {
    imported.close();
  }
  const snapshot = new WorldStore(f.target);
  assert.equal(snapshot.inspect().releaseId, first.releaseId);
  snapshot.close();
  const same = await packWorld(f.world, join(f.root, "same.openfun"));
  assert.equal(same.releaseId, first.releaseId);
  writeFileSync(
    join(f.game, "custom.gd"),
    "extends Node\nvar collected_mail = 4\n",
  );
  const codeChanged = await packWorld(f.world, join(f.root, "code.openfun"));
  assert.notEqual(codeChanged.releaseId, first.releaseId);
  const modified = new ContentStore(f.world);
  modified.saveState({
    namespace: "tidalpost",
    expectedRevision: 1,
    state: { letter: false },
  });
  modified.close();
  const saveChanged = await packWorld(f.world, join(f.root, "save.openfun"));
  assert.notEqual(saveChanged.releaseId, codeChanged.releaseId);
  assert.deepEqual(
    exportRuntimeData(f.target),
    runtime,
    "import is an independent saved game",
  );
});

test("sharing excludes local backups and author configuration", async (t) => {
  const f = await fixture();
  t.after(f.remove);
  const backup = join(f.world, ".openfun/project-backups/old");
  mkdirSync(backup, { recursive: true });
  writeFileSync(join(backup, "private.gd"), "PRIVATE_BACKUP_SENTINEL");
  await packWorld(f.world, f.archive);
  const files = unzipSync(readFileSync(f.archive));
  assert.ok(
    !Object.keys(files).some((name) => name.includes("project-backups")),
  );
  assert.ok(
    !Buffer.concat(
      Object.values(files).map((bytes) => Buffer.from(bytes)),
    ).includes(Buffer.from("PRIVATE_BACKUP_SENTINEL")),
  );
});

test("imports reject runtime capability mismatches even when every file hash is valid", async (t) => {
  const f = await fixture();
  t.after(f.remove);
  await packWorld(f.world, f.archive);
  const original = readFileSync(f.archive);
  for (const capabilities of [
    ["world.snapshot.v1", "assets.glb.v2"],
    ["world.snapshot.v1", "assets.glb.v2", "game.state.v1"],
    ["world.snapshot.v1", "assets.glb.v2", "game.godot.v1", "game.state.v1"],
  ]) {
    writeFileSync(f.archive, original);
    rewrite(f.archive, (_files, manifest) => {
      manifest.capabilities = capabilities;
    });
    await assert.rejects(
      importWorld(f.archive, f.target),
      /capabilities do not match/,
    );
    assert.ok(!existsSync(f.target));
  }
  assert.ok(
    !readdirSync(f.root).some((name) => name.startsWith(".openfun-import-")),
  );
});

test("unsupported runtimes and missing Godot entry cannot be shared or imported", async (t) => {
  const f = await fixture();
  t.after(f.remove);
  await packWorld(f.world, f.archive);
  const original = readFileSync(f.archive);
  rewrite(f.archive, (files) => {
    delete files["game/project.godot"];
  });
  await assert.rejects(
    importWorld(f.archive, f.target),
    /missing project.godot/,
  );
  assert.ok(!existsSync(f.target));
  writeFileSync(f.archive, original);
  rewrite(f.archive, (files) => {
    files["game/openfun.runtime.json"] = Buffer.from("{}");
  });
  await assert.rejects(importWorld(f.archive, f.target), /unsupported/);
  assert.ok(!existsSync(f.target));
  writeFileSync(join(f.game, "openfun.runtime.json"), "{}");
  await assert.rejects(
    packWorld(f.world, join(f.root, "bad.openfun")),
    /unsupported/,
  );
});
