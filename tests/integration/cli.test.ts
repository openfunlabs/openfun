import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "openfun-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const piDir = join(dir, "unused-pi-config");
  const invokeAt = (cwd: string, ...args: string[]) =>
    run(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        join(root, "src", "cli.ts"),
        ...args,
      ],
      {
        cwd,
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          PI_CODING_AGENT_DIR: piDir,
          PI_OFFLINE: "1",
          PI_TELEMETRY: "0",
          OPENFUN_HOME: join(dir, "library"),
          // Doctor only probes --version. A known local executable keeps this CLI test
          // independent of Blender/Godot availability; engine checks are separate tests.
          OPENFUN_BLENDER: process.execPath,
          OPENFUN_GODOT: process.execPath,
        },
      },
    );
  const invoke = (...args: string[]) => invokeAt(dir, ...args);
  return { dir, piDir, invoke, invokeAt };
}

test("CLI creates and inspects a world without starting pi or generating a map", async (t) => {
  const { dir, piDir, invoke } = setup(t);
  const world = join(dir, "world with spaces");
  const created = await invoke(
    "create",
    world,
    "--name",
    "星空港",
    "--seed",
    "custom-seed",
    "--no-chat",
  );
  assert.match(created.stdout, /World created/);
  assert.doesNotMatch(created.stderr, /SQLite is an experimental feature/);
  assert.ok(existsSync(join(world, "world.sqlite")));
  assert.ok(existsSync(join(world, "WORLD.md")));
  assert.equal(
    existsSync(piDir),
    false,
    "No-chat must not initialize auth/settings",
  );
  assert.equal(existsSync(join(world, ".openfun", "sessions")), false);
  const inspected = JSON.parse((await invoke("inspect", world)).stdout);
  assert.equal(inspected.spec.name, "星空港");
  assert.equal(inspected.spec.seed, "custom-seed");
  assert.equal(inspected.chunks, 0);
  assert.equal(inspected.revision, 0);
  await assert.rejects(
    invoke("create", world, "--name", "Overwritten", "--no-chat"),
    (error: unknown) => {
      assert.match((error as { stderr: string }).stderr, /already exists/);
      return true;
    },
  );
  assert.equal(
    JSON.parse((await invoke("inspect", world)).stdout).spec.name,
    "星空港",
  );
});

test("CLI opens the exact working directory and preserves each world across restarts", async (t) => {
  const { dir, invoke, invokeAt } = setup(t);
  const firstWorld = join(dir, "first world");
  const secondWorld = join(firstWorld, "nested world");
  mkdirSync(secondWorld, { recursive: true });
  // Native --help makes the subprocess exit without credentials/model requests;
  // interactive rendering and /play are also exercised by the PTY smoke check.
  const piFlags = ["--", "--offline", "--help"];
  const first = await invokeAt(firstWorld, ...piFlags);
  assert.match(first.stdout, /OpenFun - AI coding assistant/);
  const inspect = async (world: string) =>
    JSON.parse((await invoke("inspect", world)).stdout);
  const initial = await inspect(firstWorld);
  assert.equal(initial.spec.name, "first world");
  assert.equal(initial.chunks, 0);
  assert.ok(existsSync(join(firstWorld, ".openfun", "sessions")));

  // A remembered world and an ancestor world must both be ignored.
  await invokeAt(secondWorld, ...piFlags);
  const second = await inspect(secondWorld);
  assert.equal(second.spec.name, "nested world");
  assert.notEqual(second.worldId, initial.worldId);
  assert.ok(existsSync(join(secondWorld, ".openfun", "sessions")));
  await invokeAt(firstWorld, ...piFlags);
  assert.deepEqual(await inspect(firstWorld), initial);
  assert.deepEqual(await inspect(secondWorld), second);
  assert.equal(existsSync(join(dir, "library", "worlds")), false);
  assert.equal(existsSync(join(dir, "world.sqlite")), false);
});

test("CLI does not replace a damaged local world or fall back to the recent world", async (t) => {
  const { dir, piDir, invoke, invokeAt } = setup(t);
  const broken = join(dir, "broken");
  mkdirSync(broken);
  const database = join(broken, "world.sqlite");
  writeFileSync(database, "damaged database");
  const remembered = join(dir, "remembered");
  await invoke("create", remembered, "--no-chat");
  const library = join(dir, "library");
  mkdirSync(library);
  writeFileSync(
    join(library, "recent.json"),
    JSON.stringify({ directory: remembered }),
  );
  await assert.rejects(invokeAt(broken, "--", "--offline", "--help"));
  assert.equal(readFileSync(database, "utf8"), "damaged database");
  assert.equal(existsSync(join(broken, ".openfun")), false);
  assert.equal(existsSync(join(remembered, ".openfun")), false);
  assert.equal(existsSync(piDir), false);
});

test("CLI preserves an existing WORLD.md when the directory has no database", async (t) => {
  const { dir, invoke } = setup(t);
  const bible = join(dir, "WORLD.md");
  writeFileSync(bible, "My existing design notes");
  await assert.rejects(
    invoke("--", "--offline", "--help"),
    (error: unknown) => {
      assert.match(
        (error as { stderr: string }).stderr,
        /WORLD.md already exists/,
      );
      return true;
    },
  );
  assert.equal(readFileSync(bible, "utf8"), "My existing design notes");
  assert.equal(existsSync(join(dir, "world.sqlite")), false);
});

test("CLI doctor works without a world and leaves provider selection to pi", async (t) => {
  const { piDir, invoke } = setup(t);
  const status = JSON.parse((await invoke("doctor")).stdout);
  assert.equal(status.node, process.version);
  assert.ok(existsSync(status.pi));
  assert.equal(status.blender, process.execPath);
  assert.equal(status.godot, process.execPath);
  assert.match(status.model, /\/model/);
  assert.match(status.model, /\/login/);
  assert.equal(existsSync(piDir), false);
  assert.equal(
    (await invoke("--version")).stdout.trim(),
    JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ).version,
  );
});

test("CLI inspecting a missing world fails without creating it", async (t) => {
  const { dir, invoke } = setup(t);
  const world = join(dir, "missing");
  await assert.rejects(invoke("inspect", world), (error: unknown) => {
    assert.match((error as { stderr: string }).stderr, /World not found/);
    return true;
  });
  assert.equal(existsSync(world), false);
});

test("CLI setup persists detected executables in user storage", async (t) => {
  const { dir, invoke } = setup(t);
  const configured = JSON.parse((await invoke("setup")).stdout);
  const { readFileSync } = await import("node:fs");
  assert.equal(configured.configuration, join(dir, "library", "tools.json"));
  const saved = JSON.parse(readFileSync(configured.configuration, "utf8"));
  assert.equal(saved.godot, process.execPath);
  assert.equal(saved.blender, process.execPath);
});

test("CLI help uses English product copy and starts without the SQLite warning", async (t) => {
  const { invoke } = setup(t);
  const output = await invoke("--help");
  assert.match(output.stdout, /Create, explore, and share/);
  assert.doesNotMatch(output.stdout, /[\p{Script=Han}]/u);
  assert.doesNotMatch(output.stderr, /SQLite is an experimental feature/);
});
