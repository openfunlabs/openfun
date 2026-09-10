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
import { startPlayer } from "../../src/godot/player.js";
import { WorldStore } from "../../src/world/world.js";

test(
  "explicit background player works without a bundled sample game",
  { skip: process.platform === "win32" },
  async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "openfun-player-"));
    const previousHome = process.env.OPENFUN_HOME;
    process.env.OPENFUN_HOME = join(dir, "home");
    t.after(() => {
      if (previousHome === undefined) delete process.env.OPENFUN_HOME;
      else process.env.OPENFUN_HOME = previousHome;
      rmSync(dir, { recursive: true, force: true });
    });
    const world = join(dir, "world");
    WorldStore.create(world, { name: "Player test" }).close();
    const executable = join(dir, "test-player.mjs");
    writeFileSync(
      executable,
      `#!${process.execPath}
const args = process.argv.slice(2);
const value = key => args.find(arg => arg.startsWith(key + '='))?.slice(key.length + 1);
const response = await fetch(value('--host') + '/snapshot', { headers: { Authorization: 'Bearer ' + value('--token') } });
if (!response.ok) process.exit(2);
const data = await response.json();
if (data.chunks.length !== 9) process.exit(3);
console.log('ENGINE_STDOUT_CAPTURED');
console.error('ENGINE_STDERR_CAPTURED');
`,
    );
    chmodSync(executable, 0o755);
    await assert.rejects(
      startPlayer(world, { godot: process.execPath }),
      /No local Godot game/,
    );
    const player = await startPlayer(world, {
      player: executable,
      quiet: true,
      host: { generationMode: "demo" },
    });
    assert.equal(await player.completion, 0);
    assert.ok(player.logPath);
    const log = readFileSync(player.logPath, "utf8");
    assert.match(log, /ENGINE_STDOUT_CAPTURED/);
    assert.match(log, /ENGINE_STDERR_CAPTURED/);
    assert.equal(existsSync(join(world, ".openfun", "host.lock")), false);
    const store = new WorldStore(world);
    try {
      assert.equal(store.inspect().chunks, 9);
    } finally {
      store.close();
    }
  },
);
