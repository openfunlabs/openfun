import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ensureGameProject } from "../../src/godot/project.js";
import { startPlayer } from "../../src/godot/player.js";
import { WorldStore } from "../../src/world/world.js";

test("editable projects are isolated and reopening preserves user scripts", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "openfun-projects-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = join(root, "first");
  const second = join(root, "second");
  WorldStore.create(first, { name: "First" }).close();
  WorldStore.create(second, { name: "Second" }).close();
  const project = await ensureGameProject(first);
  assert.equal(existsSync(join(project, "world.gd")), false);
  writeFileSync(
    join(project, "world.gd"),
    "extends Node\n# A new game mechanic\n",
  );
  assert.equal(await ensureGameProject(first), project);
  assert.match(
    readFileSync(join(project, "world.gd"), "utf8"),
    /new game mechanic/,
  );
  const other = await ensureGameProject(second);
  assert.equal(existsSync(join(other, "world.gd")), false);
  assert.ok(existsSync(join(project, "OPENFUN_PROTOCOL.md")));
});

test(
  "play launches the local project instead of the globally configured fixed player",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), "openfun-custom-player-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const world = join(root, "custom world");
    WorldStore.create(world, { name: "Custom" }).close();
    const project = await ensureGameProject(world);
    const executable = join(root, "test-godot.mjs");
    writeFileSync(
      executable,
      `#!${process.execPath}
import assert from 'node:assert/strict';
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('Godot test executable'); process.exit(0); }
assert.equal(args[args.indexOf('--path') + 1], ${JSON.stringify(project)});
if (args.includes('--import')) { console.log('PROJECT_IMPORTED'); process.exit(0); }
assert.ok(args.some(arg => arg.startsWith('--host=')));
assert.ok(args.some(arg => arg.startsWith('--token=')));
console.log('LOCAL_GAME_PROJECT_STARTED');
`,
    );
    chmodSync(executable, 0o755);
    const previous = process.env.OPENFUN_PLAYER;
    const previousGodot = process.env.OPENFUN_GODOT;
    process.env.OPENFUN_GODOT = executable;
    process.env.OPENFUN_PLAYER = join(root, "must-not-run");
    writeFileSync(process.env.OPENFUN_PLAYER, "not an executable");
    t.after(() => {
      if (previous === undefined) delete process.env.OPENFUN_PLAYER;
      else process.env.OPENFUN_PLAYER = previous;
      if (previousGodot === undefined) delete process.env.OPENFUN_GODOT;
      else process.env.OPENFUN_GODOT = previousGodot;
    });
    const player = await startPlayer(world, {
      quiet: true,
      host: { generationMode: "demo" },
    });
    assert.equal(await player.completion, 0);
    assert.match(
      readFileSync(player.logPath!, "utf8"),
      /LOCAL_GAME_PROJECT_STARTED/,
    );
    assert.equal(existsSync(join(world, ".openfun", "host.lock")), false);
  },
);
