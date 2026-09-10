// Actual Godot simulation/render fixture; no model calls or generated-art quality claim.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureGameProject,
  checkGameProject,
} from "../../src/godot/project.ts";
import { resolveTool } from "../../src/paths.ts";
import { output } from "../helpers/paths.mjs";
const godot = resolveTool("godot");
assert.ok(godot, "Godot required");
const world = await mkdtemp(join(tmpdir(), "openfun-death-"));
const artifacts = output("death-animation");
await mkdir(artifacts, { recursive: true });
try {
  const project = await ensureGameProject(
    world,
    new URL("../fixtures/games/roguelite-2d", import.meta.url).pathname,
  );
  await writeFile(
    join(project, "death_fixture.gd"),
    `extends "res://game.gd"
var failures: Array[String] = []
var visual := false
func check(ok: bool, message: String) -> void:
	if not ok: failures.append(message)
func _ready() -> void:
	visual = "--visual" in OS.get_cmdline_user_args()
	font = SystemFont.new()
	call_deferred("run_test")
func _process(_delta: float) -> void: pass
func _physics_process(_delta: float) -> void: pass
func shot() -> void:
	bullets.append({"position":_cell(7,3),"velocity":Vector2(100,0),"enemy":false,"damage":1000.0,"life":1.0})
func frame(name: String) -> void:
	if not visual: return
	queue_redraw()
	await RenderingServer.frame_post_draw
	var path := ${JSON.stringify(artifacts)} + "/" + name + ".png"
	check(get_viewport().get_texture().get_image().save_png(path) == OK, "capture " + name)
func run_test() -> void:
	var lifecycle = DEATH_LIFECYCLE.new()
	var events := [0,0]
	lifecycle.defeated.connect(func(): events[0] += 1)
	lifecycle.presentation_finished.connect(func(): events[1] += 1)
	check(lifecycle.begin(), "first lethal transition")
	check(not lifecycle.begin(), "duplicate lethal transition rejected")
	lifecycle.advance(0.0)
	check(lifecycle.death_progress() == 0.0, "paused game clock")
	lifecycle.advance(0.6)
	check(lifecycle.phase == DEATH_LIFECYCLE.Phase.HOLDING, "final pose held")
	lifecycle.advance(0.5)
	check(lifecycle.opacity() < 1 and lifecycle.opacity() > 0, "fade follows hold")
	lifecycle.advance(10)
	lifecycle.advance(10)
	check(events == [1,1], "events emitted exactly once")
	level_data = CONTENT.demo_level(1)
	levels["1"] = level_data
	player_pos = _cell(1,4)
	rewards["1"] = CONTENT.demo_skills()
	var enemy: Dictionary = level_data.enemies[0].duplicate(true)
	enemy.merge({"position":_cell(7,3),"hp":1.0,"max_hp":30.0,"flash":0.0,"attack_timer":10.0},true)
	enemies = [enemy]
	await frame("01-alive")
	shot()
	shot()
	_simulate(0.01, Vector2.ZERO, false)
	check(enemies.is_empty(), "dead actor excluded from combat immediately")
	check(death_presentations.size() == 1, "one retained visual for simultaneous lethal hits")
	check(int(metrics.kills) == 1, "one kill credit")
	check(not _choosing_skill(), "reward modal cannot hide decisive motion")
	await frame("02-impact")
	_simulate(0.28,Vector2.ZERO,false)
	await frame("03-fall")
	check(death_presentations.size() == 1, "mid-fall remains visible")
	_simulate(0.3,Vector2.ZERO,false)
	check(_choosing_skill(), "reward UI available after fall")
	# Hide the overlay in this render fixture to inspect the held pose underneath.
	skill_chosen = true
	await frame("04-rest")
	_simulate(0.52,Vector2.ZERO,false)
	await frame("05-fade")
	_simulate(1,Vector2.ZERO,false)
	await frame("06-cleanup")
	check(death_presentations.is_empty(), "visual cleanup progresses independently of living AI")
	check(int(metrics.kills) == 1, "cleanup never duplicates rewards")
	print("OPENFUN_DEATH_TEST " + JSON.stringify({"ok":failures.is_empty(),"failures":failures}))
	get_tree().quit(0 if failures.is_empty() else 1)
`,
  );
  await writeFile(
    join(project, "death_fixture.tscn"),
    '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://death_fixture.gd" id="1"]\n[node name="DeathFixture" type="Node2D"]\nscript = ExtResource("1")\n',
  );
  await checkGameProject(world);
  const visual = process.argv.includes("--visual");
  const child = spawn(godot, [
    ...(visual ? [] : ["--headless"]),
    "--path",
    project,
    "res://death_fixture.tscn",
    "--",
    ...(visual ? ["--visual"] : []),
  ]);
  let log = "";
  child.stdout.on("data", (b) => {
    log += b;
  });
  child.stderr.on("data", (b) => {
    log += b;
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  }).finally(() => clearTimeout(timer));
  await writeFile(join(artifacts, "result.log"), log);
  assert.equal(code, 0, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Parse Error|^ERROR:/m);
  assert.match(log, /OPENFUN_DEATH_TEST.*"ok":true/);
  console.log(log);
} finally {
  await rm(world, { recursive: true, force: true });
}
