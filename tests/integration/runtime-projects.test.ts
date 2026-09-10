import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  symlinkSync,
  readdirSync,
} from "node:fs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  ensureGameProject,
  inspectGameProject,
  gameTemplateSource,
} from "../../src/godot/project.js";

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "openfun-project-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test("Blank Godot scaffolds create projects and reopening preserves edits", async (t) => {
  const dir = fixture(t);
  const game = await ensureGameProject(dir);
  assert.equal(inspectGameProject(dir)?.engine, "godot");
  assert.match(
    readFileSync(join(game, "openfun_death_lifecycle.gd"), "utf8"),
    /signal presentation_finished/,
  );
  assert.ok(existsSync(join(game, "openfun_mesh_materials.gd")));
  writeFileSync(join(game, "custom.gd"), "extends Node\n");
  assert.equal(await ensureGameProject(dir), game);
  assert.equal(readFileSync(join(game, "custom.gd"), "utf8"), "extends Node\n");
  assert.match(
    readFileSync(join(game, "OPENFUN.md"), "utf8"),
    /proactively use world_generate_model/,
  );
  assert.throws(() => gameTemplateSource("roguelite2d"), /project.godot/);
  assert.ok(!existsSync(join(game, "world.gd")));
  assert.ok(!existsSync(join(game, "game.gd")));
  assert.equal(
    readFileSync(join(game, "main.tscn"), "utf8"),
    '[gd_scene format=3]\n\n[node name="Game" type="Node"]\n',
  );
});
test("unsupported templates and incomplete projects preserve user files", async (t) => {
  const dir = fixture(t),
    template = join(dir, "browser");
  mkdirSync(template);
  writeFileSync(join(template, "index.html"), "<html></html>");
  await assert.rejects(ensureGameProject(dir, template), /project.godot/);
  assert.ok(!existsSync(join(dir, "game")));
  mkdirSync(join(dir, "game"));
  writeFileSync(join(dir, "game/notes.txt"), "unfinished");
  await assert.rejects(ensureGameProject(dir), /preserved/);
  assert.equal(readFileSync(join(dir, "game/notes.txt"), "utf8"), "unfinished");
});
test("project paths reject symlinks and obsolete descriptors", async (t) => {
  const dir = fixture(t),
    outside = fixture(t);
  mkdirSync(join(outside, "project"));
  symlinkSync(join(outside, "project"), join(dir, "game"));
  assert.throws(() => inspectGameProject(dir), /symbolic link/);
  rmSync(join(dir, "game"));
  mkdirSync(join(dir, "game"));
  writeFileSync(join(outside, "project.godot"), "config_version=5");
  symlinkSync(join(outside, "project.godot"), join(dir, "game/project.godot"));
  assert.throws(() => inspectGameProject(dir), /symbolic links/);
  rmSync(join(dir, "game/project.godot"));
  writeFileSync(join(dir, "game/openfun.runtime.json"), "{}");
  await assert.rejects(ensureGameProject(dir), /unsupported/);
});
test("failed template copy leaves no partial game and preserves world files", async (t) => {
  const dir = fixture(t);
  writeFileSync(join(dir, "WORLD.md"), "my world");
  t.mock.method(fsPromises, "cp", async () => {
    throw new Error("copy failed");
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(ensureGameProject(dir), /copy failed/);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.deepEqual(readdirSync(dir), ["WORLD.md"]);
});
