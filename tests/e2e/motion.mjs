// Real Godot rendering/input plus a deliberately slow frame. No model calls.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { WorldStore } from "../../src/world/world.ts";
import { captureGamePreview } from "../../src/godot/preview.ts";
const root = await mkdtemp(join(tmpdir(), "openfun-motion-"));
try {
  WorldStore.create(root, { name: "Motion instrumentation fixture" }).close();
  const game = join(root, "game");
  await mkdir(game);
  await cp(
    new URL("../fixtures/godot-motion/game.gd", import.meta.url),
    join(game, "game.gd"),
  );
  await writeFile(
    join(game, "project.godot"),
    '[application]\nconfig/name="Motion fixture"\nrun/main_scene="res://main.tscn"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n',
  );
  await writeFile(
    join(game, "main.tscn"),
    '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://game.gd" id="1"]\n[node name="Game" type="Node2D"]\nscript = ExtResource("1")\n',
  );
  const result = await captureGamePreview(root, {
    mode: process.argv.includes("--windowed") ? "windowed" : "headless",
    width: 640,
    height: 480,
    seconds: process.argv.includes("--performance") ? 8 : 2.4,
    captureTimes: process.argv.includes("--performance")
      ? []
      : [0.4, 1.08, 1.32, 1.5, 2.3],
    inputs: [
      { kind: "key", name: "D", pressed: true, at: 0.6 },
      { kind: "key", name: "D", pressed: false, at: 0.7 },
      { kind: "action", name: "attack", pressed: true, at: 1 },
      { kind: "action", name: "attack", pressed: false, at: 1.02 },
      {
        kind: "mouse_button",
        button: 1,
        position: [300, 220],
        pressed: true,
        at: 1.8,
      },
      {
        kind: "mouse_button",
        button: 1,
        position: [300, 220],
        pressed: false,
        at: 1.9,
      },
    ],
  });
  assert.deepEqual(result.consoleErrors, []);
  assert.equal(
    result.frames.length,
    result.mode === "headless" || process.argv.includes("--performance")
      ? 0
      : 5,
  );
  assert.equal(
    result.observation.displayDriver === "headless",
    result.mode === "headless",
  );
  if (result.mode === "windowed") {
    assert.equal(result.observation.windowUnfocusable, true);
    assert.equal(result.observation.mouseMode, 0);
  }
  assert.equal(result.observation.inputs.length, 6);
  for (const name of [
    "ATTACK_STARTED",
    "KEY_MOVED",
    "KEY_RELEASED",
    "MOUSE_RECEIVED",
    "HITCH",
  ])
    assert.match(result.output, new RegExp(`FIXTURE_${name}`));
  assert.equal(result.output.match(/FIXTURE_CONTACT 1/g)?.length, 1);
  assert.doesNotMatch(result.output, /FIXTURE_CONTACT 2/);
  assert.ok(result.frameTiming.samples > 10);
  assert.ok(result.frameTiming.maxMs >= 80);
  assert.ok(result.frameTiming.over50Ms >= 1);
  const bytes = await Promise.all(
    result.frames.map((frame) => readFile(frame.path)),
  );
  if (result.frames.length)
    assert.notDeepEqual(
      bytes[1],
      bytes[2],
      "windup and active poses must differ",
    );
  const destination = resolve(".output/motion");
  await mkdir(destination, { recursive: true });
  for (let i = 0; i < result.frames.length; i++) {
    await cp(result.frames[i].path, join(destination, `${i}.png`));
    result.frames[i].path = join(destination, `${i}.png`);
  }
  await writeFile(
    join(destination, "report.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: true,
      frameTiming: result.frameTiming,
      inputs: 6,
      poses: result.frames.length,
      visualVerification: result.visualVerification,
      contact: 1,
      modelRequests: 0,
    }),
  );
  await assert.rejects(
    captureGamePreview(root, {
      seconds: 1,
      inputs: [
        { kind: "action", name: "missing_action", pressed: true, at: 0 },
      ],
    }),
    /Unknown input action/,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
