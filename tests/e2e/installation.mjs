import { version } from "../helpers/paths.mjs";
// Verify an explicitly selected installed CLI, with no model requests.
// Run with Node 22: node tests/e2e/installation.mjs /absolute/path/to/openfun /absolute/path/to/Godot
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

assert.ok(
  process.argv[2] && process.argv[3],
  "Pass installed CLI and Godot paths",
);
const cli = resolve(process.argv[2]);
const godot = resolve(process.argv[3]);
const run = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "openfun-installed-"));
const report = { passed: false, node: process.version, cli, godot };
const env = {
  ...process.env,
  PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
  OPENFUN_HOME: join(root, "library"),
  OPENFUN_GODOT: godot,
  PI_CODING_AGENT_DIR: join(root, "unused-pi"),
  PI_OFFLINE: "1",
  PI_TELEMETRY: "0",
};
const invoke = async (cwd, ...args) =>
  run(process.execPath, [cli, ...args], {
    cwd,
    env,
    timeout: 90000,
    maxBuffer: 2 * 1024 * 1024,
  });
try {
  report.version = (await invoke(root, "--version")).stdout.trim();
  assert.equal(report.version, version);
  const a = join(root, "world a"),
    b = join(a, "world b");
  await mkdir(b, { recursive: true });
  for (const cwd of [a, b]) {
    const opened = await invoke(cwd, "--", "--offline", "--help");
    assert.match(opened.stdout, /OpenFun - AI coding assistant/);
    assert.ok(existsSync(join(cwd, "game", "project.godot")));
  }
  const inspect = async (cwd) =>
    JSON.parse((await invoke(root, "inspect", cwd)).stdout);
  const before = await inspect(a),
    second = await inspect(b);
  assert.notEqual(before.worldId, second.worldId);
  await invoke(a, "--", "--offline", "--help");
  assert.deepEqual(await inspect(a), before);
  report.exactCwdAndReopen = true;
  report.worldIds = [before.worldId, second.worldId];

  const arena = join(root, "arena"),
    imported = join(root, "shared arena");
  await invoke(root, "create", arena, "--no-chat");
  assert.equal(existsSync(join(arena, "game", "game.gd")), false);
  assert.equal(existsSync(join(arena, "game", "world.gd")), false);
  assert.match(
    await readFile(join(arena, "game", "main.tscn"), "utf8"),
    /type="Node"/,
  );
  assert.equal(existsSync(join(arena, "game", "tests")), false);
  assert.equal(existsSync(join(arena, "game", ".output")), false);
  await invoke(root, "check", arena);
  // Blank scaffolds deliberately contain no playable sample. Author a tiny lifecycle
  // fixture here to verify installed play without importing a genre template.
  await writeFile(
    join(arena, "game", "probe.gd"),
    'extends Node\nfunc _ready():\n print("INSTALLED_BLANK_PROJECT_PLAYED")\n get_tree().quit()\n',
  );
  await writeFile(
    join(arena, "game", "main.tscn"),
    '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://probe.gd" id="1"]\n[node name="Probe" type="Node"]\nscript = ExtResource("1")\n',
  );
  const played = await invoke(root, "play", arena, "--headless", "--demo");
  assert.match(played.stdout, /INSTALLED_BLANK_PROJECT_PLAYED/);
  report.blankProject = true;

  const archive = join(root, "arena.openfun");
  await invoke(root, "pack", arena, "--output", archive);
  await invoke(root, "import", archive, imported);
  assert.equal(
    await readFile(join(imported, "game", "probe.gd"), "utf8"),
    await readFile(join(arena, "game", "probe.gd"), "utf8"),
  );
  await assert.rejects(invoke(root, "check", imported), /trust-project/);
  await invoke(root, "check", imported, "--trust-project");
  report.sourceSharingAndImportCheck = true;
  report.modelRequests = 0;
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await mkdir(resolve(".output"), { recursive: true });
  await writeFile(
    resolve(".output/installed-smoke.json"),
    JSON.stringify(report, null, 2),
  );
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report, null, 2));
}
