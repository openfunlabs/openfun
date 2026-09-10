import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { unzipSync, zipSync } from "fflate";
import {
  importWorld,
  packWorld,
  PACKAGE_LIMITS,
} from "../../src/sharing/package.js";
import { WorldStore } from "../../src/world/world.js";
import {
  ContentStore,
  exportRuntimeData,
} from "../../src/generation/content-store.js";
import { importAsset } from "../../src/assets/import.js";
import {
  checkGameProject,
  ensureGameProject,
  requireProjectTrust,
} from "../../src/godot/project.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function makeGlb(
  document: unknown = {
    asset: { version: "2.0" },
    scenes: [{ nodes: [] }],
    scene: 0,
  },
): Buffer {
  const json = Buffer.from(JSON.stringify(document));
  const length = Math.ceil(json.length / 4) * 4;
  const bytes = Buffer.alloc(20 + length, 0x20);
  bytes.writeUInt32LE(0x46546c67, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(length, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  json.copy(bytes, 20);
  return bytes;
}

async function fixture(asset = makeGlb()) {
  const root = await mkdtemp(join(tmpdir(), "openfun-package-test-"));
  directories.push(root);
  const world = join(root, "source");
  const assetName = `${createHash("sha256").update(asset).digest("hex")}.glb`;
  const store = WorldStore.create(world, {
    name: "分享森林",
    assets: { tree: assetName },
  });
  try {
    await writeFile(join(world, "assets", assetName), asset);
    const chunk = store.generateDemoChunk(0, 0);
    const tree = chunk.entities.find((entity) => entity.kind === "tree");
    assert.ok(tree);
    store.updateEntity(tree.id, { state: { removed: true } });
    store.applyCommand({
      id: "test-move",
      type: "move",
      position: [1, 1.7, 4],
    });
  } finally {
    store.close();
  }
  return {
    root,
    world,
    asset,
    assetName,
    archive: join(root, "world.openfun"),
    target: join(root, "imported"),
  };
}

async function rewriteArchive(
  path: string,
  edit: (files: Record<string, Uint8Array>) => void,
) {
  const files = unzipSync(await readFile(path));
  edit(files);
  await writeFile(path, zipSync(files));
}

test("sharing preserves editable game source and requires explicit trust before execution", async () => {
  const f = await fixture();
  const game = await ensureGameProject(f.world);
  await writeFile(
    join(game, "custom.gd"),
    "extends Node\n# Custom mechanics\n",
  );
  const first = await packWorld(f.world, f.archive);
  assert.ok(first.capabilities.includes("game.godot.v1"));
  await importWorld(f.archive, f.target);
  assert.equal(
    await readFile(join(f.target, "game", "custom.gd"), "utf8"),
    "extends Node\n# Custom mechanics\n",
  );
  assert.throws(() => requireProjectTrust(f.target), /executable project code/);
  await assert.rejects(checkGameProject(f.target), /executable project code/);
  requireProjectTrust(f.target, true);
  assert.doesNotThrow(() => requireProjectTrust(f.target));
  const unchanged = await packWorld(f.world, join(f.root, "same.openfun"));
  assert.equal(unchanged.releaseId, first.releaseId);
  await writeFile(
    join(game, "custom.gd"),
    "extends Node2D\n# Changed mechanics\n",
  );
  const changed = await packWorld(f.world, join(f.root, "changed.openfun"));
  assert.notEqual(changed.releaseId, first.releaseId);
});

test("sharing carries generated project content and gameplay state into an independent save", async () => {
  const f = await fixture();
  const runtime = new ContentStore(f.world);
  const request = {
    namespace: "cards",
    key: "encounter:1",
    prompt: "Create one encounter",
    schema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
  };
  const pending = runtime.insert(request);
  const running = runtime.claim(pending.id)!;
  assert.ok(runtime.publish(running, { name: "Moonlit duel" }));
  runtime.saveState({
    namespace: "cards",
    expectedRevision: 0,
    state: { hp: 42, hand: ["moon", "sun"], turn: 3 },
  });
  runtime.close();
  const original = exportRuntimeData(f.world);
  const manifest = await packWorld(f.world, f.archive);
  assert.ok(manifest.capabilities.includes("game.state.v1"));
  await importWorld(f.archive, f.target);
  assert.deepEqual(exportRuntimeData(f.target), original);
  const imported = new ContentStore(f.target);
  try {
    assert.equal(imported.matchingJob(request)?.id, pending.id);
    imported.saveState({
      namespace: "cards",
      expectedRevision: 1,
      state: { hp: 12 },
    });
  } finally {
    imported.close();
  }
  assert.deepEqual(exportRuntimeData(f.world), original);
});

test("external GLB imports are content-addressed, deduplicated and do not publish entities", async () => {
  const f = await fixture();
  const file = join(f.root, "generated.glb");
  await writeFile(file, f.asset);
  const before = new WorldStore(f.world);
  const revision = before.inspect().revision;
  before.close();
  const first = await importAsset(f.world, file);
  assert.equal(first.asset, f.assetName);
  assert.deepEqual(await importAsset(f.world, file), first);
  const after = new WorldStore(f.world);
  assert.equal(after.inspect().revision, revision);
  after.close();
  assert.deepEqual(
    await readFile(join(f.world, "assets", first.asset)),
    f.asset,
  );
  assert.ok(
    !(await readdir(join(f.world, "assets"))).some((name) =>
      name.endsWith(".tmp"),
    ),
  );
});

test("external GLB imports reject source symlinks, remote resources and damaged hash targets", async () => {
  const f = await fixture();
  const file = join(f.root, "generated.glb");
  await writeFile(file, f.asset);
  const linked = join(f.root, "linked.glb");
  await symlink(file, linked);
  await assert.rejects(importAsset(f.world, linked));
  const remote = join(f.root, "remote.glb");
  await writeFile(
    remote,
    makeGlb({
      asset: { version: "2.0" },
      buffers: [{ uri: "https://example.invalid/model.bin" }],
    }),
  );
  await assert.rejects(importAsset(f.world, remote), /URI references/);
  await writeFile(join(f.world, "assets", f.assetName), "damaged");
  await assert.rejects(importAsset(f.world, file), /damaged/);
  await assert.rejects(importAsset(join(f.root, "absent"), file));
});

test("roundtrip preserves world state and referenced GLB, with a distinct local save", async () => {
  const f = await fixture();
  const manifest = await packWorld(f.world, f.archive);
  assert.equal(manifest.license, "UNLICENSED");
  assert.deepEqual(await importWorld(f.archive, f.target), manifest);
  const original = new WorldStore(f.world);
  const imported = new WorldStore(f.target);
  try {
    assert.deepEqual(imported.getSpec(), original.getSpec());
    assert.deepEqual(imported.getChunk(0, 0), original.getChunk(0, 0));
    assert.deepEqual(imported.inspect().player, original.inspect().player);
    assert.equal(imported.inspect().worldId, original.inspect().worldId);
    assert.notEqual(imported.inspect().saveId, original.inspect().saveId);
    assert.equal(imported.inspect().releaseId, manifest.releaseId);
    assert.equal(imported.inspect().events, 0);
  } finally {
    original.close();
    imported.close();
  }
  assert.deepEqual(
    await readFile(join(f.target, "assets", f.assetName)),
    f.asset,
  );
});

test("export excludes credentials, author files, chats, recipes and unreferenced assets", async () => {
  const f = await fixture();
  for (const directory of [".pi", ".openfun"])
    await mkdir(join(f.world, directory));
  await writeFile(
    join(f.world, ".pi", "auth.json"),
    '{"token":"should-never-be-shared"}',
  );
  await writeFile(join(f.world, ".pi", "conversation.jsonl"), "private chat");
  await writeFile(join(f.world, ".openfun", "recipe.json"), "private recipe");
  await writeFile(join(f.world, ".env"), "OPENAI_API_KEY=private");
  await writeFile(join(f.world, "author.md"), "private author notes");
  await writeFile(join(f.world, "assets", `${"a".repeat(64)}.glb`), makeGlb());
  await packWorld(f.world, f.archive);
  const files = unzipSync(await readFile(f.archive));
  assert.deepEqual(Object.keys(files).sort(), [
    `assets/${f.assetName}`,
    "manifest.json",
    "snapshot.json",
  ]);
  const content = Object.values(files)
    .map((bytes) => Buffer.from(bytes).toString())
    .join("\n");
  assert.doesNotMatch(
    content,
    /should-never-be-shared|private chat|private recipe|OPENAI_API_KEY|private author/,
  );
});

test("export never overwrites an existing package", async () => {
  const f = await fixture();
  await writeFile(f.archive, "keep this");
  await assert.rejects(packWorld(f.world, f.archive), /already exists/);
  assert.equal(await readFile(f.archive, "utf8"), "keep this");
});

test("import protects existing target directories and their contents", async () => {
  const f = await fixture();
  await packWorld(f.world, f.archive);
  await mkdir(f.target);
  await writeFile(join(f.target, "keep.txt"), "original");
  await assert.rejects(importWorld(f.archive, f.target), /already exists/);
  assert.equal(await readFile(join(f.target, "keep.txt"), "utf8"), "original");
});

test("tampered contents fail their manifest hash even with a valid ZIP checksum", async () => {
  const f = await fixture();
  await packWorld(f.world, f.archive);
  await rewriteArchive(f.archive, (files) => {
    const snapshot = JSON.parse(
      Buffer.from(files["snapshot.json"]!).toString(),
    );
    snapshot.spec.name = "被篡改的世界";
    files["snapshot.json"] = Buffer.from(JSON.stringify(snapshot));
  });
  await assert.rejects(
    importWorld(f.archive, f.target),
    /hash or size mismatch/,
  );
  assert.ok(!(await readdir(f.root)).includes("imported"));
});

test("path traversal and executable entries are rejected without extraction", async () => {
  const f = await fixture();
  await packWorld(f.world, f.archive);
  const original = await readFile(f.archive);
  for (const path of [
    "../../escape.json",
    "/absolute.json",
    "assets\\escape.glb",
    ".pi/auth.json",
    "code.gd",
  ]) {
    await writeFile(f.archive, original);
    await rewriteArchive(f.archive, (files) => {
      files[path] = Buffer.from("{}");
    });
    await assert.rejects(importWorld(f.archive, f.target), /Unsafe ZIP path/);
  }
  assert.ok(!(await readdir(f.root)).includes("escape.json"));
});

test("ZIP symbolic links are rejected even with a whitelisted filename", async () => {
  const f = await fixture();
  await packWorld(f.world, f.archive);
  const files = unzipSync(await readFile(f.archive));
  await writeFile(
    f.archive,
    zipSync({
      ...files,
      "snapshot.json": [files["snapshot.json"]!, { os: 3, attrs: 0xa1ff0000 }],
    }),
  );
  await assert.rejects(importWorld(f.archive, f.target), /symbolic link/);
});

test("export rejects symbolic-link assets and assets directories", async () => {
  const f = await fixture();
  const assetPath = join(f.world, "assets", f.assetName);
  const outside = join(f.root, "outside.glb");
  await writeFile(outside, f.asset);
  await rm(assetPath);
  await symlink(outside, assetPath);
  await assert.rejects(packWorld(f.world, f.archive));
  await rm(join(f.world, "assets"), { recursive: true });
  await symlink(f.root, join(f.world, "assets"));
  await assert.rejects(packWorld(f.world, f.archive), /regular directory/);
});

test("oversized archives and decompressed entries are rejected", async () => {
  const f = await fixture();
  await writeFile(f.archive, "");
  await truncate(f.archive, PACKAGE_LIMITS.archiveBytes + 1);
  await assert.rejects(importWorld(f.archive, f.target), /byte limit/);
  await rm(f.archive);
  await packWorld(f.world, f.archive);
  await rewriteArchive(f.archive, (files) => {
    files["snapshot.json"] = new Uint8Array(PACKAGE_LIMITS.snapshotBytes + 1);
  });
  await assert.rejects(importWorld(f.archive, f.target), /byte limit/);
});

test("archive entry count is bounded before processing the payload", async () => {
  const f = await fixture();
  await packWorld(f.world, f.archive);
  await rewriteArchive(f.archive, (files) => {
    for (let index = 0; index < PACKAGE_LIMITS.entries; index++) {
      files[`assets/${index.toString(16).padStart(64, "0")}.glb`] =
        new Uint8Array();
    }
  });
  await assert.rejects(importWorld(f.archive, f.target), /entry limit/);
});

test("inflation is bounded even when an attacker lies about decompressed size", async () => {
  const f = await fixture();
  await packWorld(f.world, f.archive);
  await rewriteArchive(f.archive, (files) => {
    files["snapshot.json"] = new Uint8Array(64 * 1024);
  });
  const bytes = await readFile(f.archive);
  const footer = bytes.length - 22;
  let offset = bytes.readUInt32LE(footer + 16);
  while (offset < footer) {
    const nameLength = bytes.readUInt16LE(offset + 28);
    const name = bytes
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString();
    if (name === "snapshot.json") {
      const local = bytes.readUInt32LE(offset + 42);
      bytes.writeUInt32LE(1, offset + 24);
      bytes.writeUInt32LE(1, local + 22);
      break;
    }
    offset +=
      46 +
      nameLength +
      bytes.readUInt16LE(offset + 30) +
      bytes.readUInt16LE(offset + 32);
  }
  await writeFile(f.archive, bytes);
  await assert.rejects(importWorld(f.archive, f.target));
  assert.ok(!(await readdir(f.root)).includes("imported"));
});

test("incompatible format, runtime and capabilities fail before creating a world", async () => {
  const f = await fixture();
  await packWorld(f.world, f.archive);
  const original = await readFile(f.archive);
  for (const patch of [
    { formatVersion: 2 },
    { runtimeVersion: "999" },
    { capabilities: ["execute.arbitrary-code"] },
  ]) {
    await writeFile(f.archive, original);
    await rewriteArchive(f.archive, (files) => {
      const manifest = JSON.parse(
        Buffer.from(files["manifest.json"]!).toString(),
      );
      files["manifest.json"] = Buffer.from(
        JSON.stringify({ ...manifest, ...patch }),
      );
    });
    await assert.rejects(importWorld(f.archive, f.target), /incompatible/);
    assert.ok(!(await readdir(f.root)).includes("imported"));
  }
});

test("self-contained GLB validation rejects external resources and invalid headers", async () => {
  const f = await fixture(
    makeGlb({
      asset: { version: "2.0" },
      buffers: [{ uri: "https://example.com/private.bin", byteLength: 16 }],
    }),
  );
  await assert.rejects(packWorld(f.world, f.archive), /self-contained/);
  const invalid = await fixture(Buffer.from("not a GLB"));
  await assert.rejects(packWorld(invalid.world, invalid.archive), /GLB header/);
});

test("invalid world snapshots clean staging and leave the target absent", async () => {
  const f = await fixture();
  await packWorld(f.world, f.archive);
  await rewriteArchive(f.archive, (files) => {
    const snapshot = JSON.parse(
      Buffer.from(files["snapshot.json"]!).toString(),
    );
    snapshot.chunks[0].id = "inconsistent";
    files["snapshot.json"] = Buffer.from(JSON.stringify(snapshot));
    const manifest = JSON.parse(
      Buffer.from(files["manifest.json"]!).toString(),
    );
    manifest.files["snapshot.json"] = {
      bytes: files["snapshot.json"].length,
      sha256: createHash("sha256").update(files["snapshot.json"]).digest("hex"),
    };
    files["manifest.json"] = Buffer.from(JSON.stringify(manifest));
  });
  await assert.rejects(
    importWorld(f.archive, f.target),
    /Invalid chunk identity/,
  );
  assert.deepEqual((await readdir(f.root)).sort(), ["source", "world.openfun"]);
});

test("sharing roundtrips asset kits with import settings beyond the old 480-file limit", async () => {
  const f = await fixture();
  const game = await ensureGameProject(f.world);
  const kit = join(game, "assets", "kit");
  await mkdir(kit, { recursive: true });
  for (let i = 0; i < 260; i++) {
    await writeFile(join(kit, `${i}.txt`), `source resource ${i}`);
    await writeFile(join(kit, `${i}.txt.import`), `[params]\nfixture=${i}\n`);
  }
  await packWorld(f.world, f.archive);
  await importWorld(f.archive, f.target);
  assert.equal(
    await readFile(join(f.target, "game/assets/kit/259.txt.import"), "utf8"),
    "[params]\nfixture=259\n",
  );
});
