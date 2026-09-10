// Real Godot resource roundtrip, with no model calls.
// Run: node --import tsx tests/e2e/resources.mjs [GODOT_EXECUTABLE]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { unzipSync } from "fflate";
import {
  checkGameProject,
  ensureGameProject,
} from "../../src/godot/project.ts";
import { packWorld, importWorld } from "../../src/sharing/package.ts";
import { startPlayer } from "../../src/godot/player.ts";
import { resolveTool } from "../../src/paths.ts";
import { WorldStore } from "../../src/world/world.ts";

const reportPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.output/project-resource-smoke.json",
);
const root = await mkdtemp(join(tmpdir(), "openfun-project-resource-"));
const report = {
  startedAt: new Date().toISOString(),
  node: process.version,
  passed: false,
};
let active;

// A complete deterministic 2x3 RGBA PNG with valid PNG chunk CRCs.
function pngFixture() {
  const chunk = (name, body) => {
    const payload = Buffer.concat([Buffer.from(name), body]);
    let crc = 0xffffffff;
    for (const byte of payload) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    size.writeUInt32BE(body.length);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, payload, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(3, 4);
  header[8] = 8;
  header[9] = 6;
  const row = Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 255]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat([row, row, row]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

try {
  const godot = resolveTool("godot", process.argv[2]);
  assert.ok(godot, "A real Godot executable is required");
  const template = join(root, "template"),
    author = join(root, "author"),
    imported = join(root, "imported");
  await mkdir(template);
  await writeFile(
    join(template, "project.godot"),
    `[application]\nconfig/name="OpenFun resource roundtrip"\nrun/main_scene="res://main.tscn"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n`,
  );
  await writeFile(
    join(template, "main.tscn"),
    `[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://main.gd" id="1"]\n[node name="ResourceSmoke" type="Node"]\nscript = ExtResource("1")\n`,
  );
  await writeFile(
    join(template, "main.gd"),
    `extends Node
const FIXTURE: Texture2D = preload("res://fixture.png")
func _ready() -> void:
    if FIXTURE.get_width() != 2 or FIXTURE.get_height() != 3:
        push_error("Unexpected texture dimensions")
        get_tree().quit(2)
        return
    var pixels := FIXTURE.get_image()
    if pixels == null or pixels.get_pixel(0, 0).r < 0.99 or pixels.get_pixel(1, 0).g < 0.99:
        push_error("Unexpected imported texture pixels")
        get_tree().quit(3)
        return
    print("OPENFUN_RESOURCE_SMOKE_JSON " + JSON.stringify({"ok": true, "width": FIXTURE.get_width(), "height": FIXTURE.get_height(), "pixels_verified": true, "project": ProjectSettings.globalize_path("res://")}))
    get_tree().quit(0)
`,
  );
  const png = pngFixture();
  await writeFile(join(template, "fixture.png"), png);
  WorldStore.create(author, { name: "Resource share smoke" }).close();
  const project = await ensureGameProject(author, template);
  const checked = await checkGameProject(author, godot);
  report.godot =
    checked.output.match(/Godot Engine ([^\n]+)/)?.[1] ??
    "version absent from output";
  report.sourceImportSidecarCreated = existsSync(
    join(project, "fixture.png.import"),
  );
  report.sourceCacheCreated = existsSync(join(project, ".godot", "imported"));
  assert.ok(report.sourceImportSidecarCreated && report.sourceCacheCreated);

  const archive = join(root, "resource.openfun");
  const manifest = await packWorld(author, archive);
  const entries = Object.keys(unzipSync(await readFile(archive)));
  report.packageIncludesPng = entries.includes("game/fixture.png");
  report.packageIncludesImportSidecar = entries.includes(
    "game/fixture.png.import",
  );
  report.packageExcludesGodotCache = entries.every(
    (entry) => !entry.split("/").includes(".godot"),
  );
  report.packageFiles = entries.length;
  report.releaseId = manifest.releaseId;
  assert.ok(
    report.packageIncludesPng &&
      report.packageIncludesImportSidecar &&
      report.packageExcludesGodotCache,
  );

  await importWorld(archive, imported);
  const importedProject = join(imported, "game");
  report.importDidNotCreateCache = !existsSync(join(importedProject, ".godot"));
  assert.ok(report.importDidNotCreateCache);
  assert.deepEqual(await readFile(join(importedProject, "fixture.png")), png);
  report.pngSha256 = createHash("sha256").update(png).digest("hex");
  await assert.rejects(checkGameProject(imported, godot), /trust-project/);
  report.checkWithoutTrustRejected = true;
  await assert.rejects(
    startPlayer(imported, { godot, headless: true, quiet: true }),
    /trust-project/,
  );
  report.playWithoutTrustRejected = true;
  assert.equal(existsSync(join(importedProject, ".godot")), false);
  assert.ok(existsSync(join(imported, ".openfun", "imported-project.json")));

  // Make accidental references to the author's project impossible during playback.
  await rm(author, { recursive: true });
  await rm(template, { recursive: true });
  report.sourceRemovedBeforePlayback = true;
  active = await startPlayer(imported, {
    godot,
    headless: true,
    quiet: true,
    trustProject: true,
    host: { generationMode: "demo" },
  });
  let timer;
  try {
    report.exitCode = await Promise.race([
      active.completion,
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Resource gameplay smoke timed out")),
          30000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  assert.equal(report.exitCode, 0);
  const output = await readFile(active.logPath, "utf8");
  report.playerOutput = output;
  const match = output.match(/^OPENFUN_RESOURCE_SMOKE_JSON (.+)$/m);
  assert.ok(match, "The actual Godot project must print its success marker");
  report.game = JSON.parse(match[1]);
  assert.equal(report.game.ok, true);
  assert.equal(report.game.width, 2);
  assert.equal(report.game.height, 3);
  assert.equal(report.game.pixels_verified, true);
  assert.equal(
    await realpath(report.game.project),
    await realpath(importedProject),
  );
  const cachedFiles = await readdir(
    join(importedProject, ".godot", "imported"),
  );
  report.importedCacheRebuilt = cachedFiles.some(
    (name) => name.startsWith("fixture.png-") && name.endsWith(".ctex"),
  );
  report.trustMarkerCleared = !existsSync(
    join(imported, ".openfun", "imported-project.json"),
  );
  report.hostLockRemoved = !existsSync(join(imported, ".openfun", "host.lock"));
  assert.ok(
    report.importedCacheRebuilt &&
      report.trustMarkerCleared &&
      report.hostLockRemoved,
  );
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  if (active) await active.stop().catch(() => undefined);
  report.finishedAt = new Date().toISOString();
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  await rm(root, { recursive: true, force: true });
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        report: reportPath,
        error: report.error ?? null,
      },
      null,
      2,
    ),
  );
}
