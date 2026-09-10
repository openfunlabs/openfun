import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";
import { WorldStore } from "../../src/world/world.js";

const run = promisify(execFile);
const project = resolve(import.meta.dirname, "../..");
const notes = "# 我的世界\n\n这份已有设计尚未导入数据库，必须原样保留。\n";

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "openfun-create-safety-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const piDir = join(root, "unused-pi");
  const invoke = (...args: string[]) =>
    run(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        join(project, "src", "cli.ts"),
        ...args,
      ],
      {
        cwd: root,
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          PI_CODING_AGENT_DIR: piDir,
          PI_OFFLINE: "1",
          PI_TELEMETRY: "0",
          OPENFUN_HOME: join(root, "unused-library"),
        },
      },
    );
  return { root, piDir, invoke };
}

test("WorldStore.create preserves orphan WORLD.md and does not partially initialize its directory", (t) => {
  const { root } = fixture(t);
  const world = join(root, "existing design");
  mkdirSync(world);
  writeFileSync(join(world, "WORLD.md"), notes);
  writeFileSync(join(world, "personal-notes.txt"), "Keep this too.");

  assert.throws(
    () => WorldStore.create(world, { name: "Replacement" }),
    /WORLD\.md/,
  );
  assert.equal(readFileSync(join(world, "WORLD.md"), "utf8"), notes);
  assert.equal(
    readFileSync(join(world, "personal-notes.txt"), "utf8"),
    "Keep this too.",
  );
  assert.deepEqual(readdirSync(world).sort(), [
    "WORLD.md",
    "personal-notes.txt",
  ]);
});

for (const command of ["create"] as const) {
  test(`CLI ${command} refuses orphan WORLD.md without overwriting notes or creating a database`, async (t) => {
    const { root, piDir, invoke } = fixture(t);
    const world = join(root, "world with notes");
    mkdirSync(world);
    writeFileSync(join(world, "WORLD.md"), notes);

    await assert.rejects(
      invoke(command, world, "--no-chat"),
      (error: unknown) => {
        assert.match((error as { stderr: string }).stderr, /WORLD\.md/);
        return true;
      },
    );
    assert.equal(readFileSync(join(world, "WORLD.md"), "utf8"), notes);
    assert.deepEqual(readdirSync(world), ["WORLD.md"]);
    assert.equal(existsSync(piDir), false);
  });
}

test("invalid CLI templates fail before creating a world or changing an existing destination", async (t) => {
  const { root, piDir, invoke } = fixture(t);
  const emptyTemplate = join(root, "template without project");
  mkdirSync(emptyTemplate);

  for (const command of ["create"] as const) {
    const newWorld = join(root, `new-${command}`);
    await assert.rejects(
      invoke(command, newWorld, "--template", "missing-template", "--no-chat"),
      (error: unknown) => {
        assert.match((error as { stderr: string }).stderr, /project\.godot/);
        return true;
      },
    );
    assert.equal(
      existsSync(newWorld),
      false,
      "Invalid template must not leave a world directory",
    );

    const existing = join(root, `existing-${command}`);
    mkdirSync(existing);
    writeFileSync(join(existing, "notes.txt"), "Original project notes");
    await assert.rejects(
      invoke(command, existing, "--template", emptyTemplate, "--no-chat"),
      (error: unknown) => {
        assert.match((error as { stderr: string }).stderr, /project\.godot/);
        return true;
      },
    );
    assert.deepEqual(readdirSync(existing), ["notes.txt"]);
    assert.equal(
      readFileSync(join(existing, "notes.txt"), "utf8"),
      "Original project notes",
    );
  }
  assert.equal(existsSync(piDir), false);
});

test("removed demo command never creates a sample world", async (t) => {
  const { root, invoke } = fixture(t);
  const world = join(root, "no-demo");
  await assert.rejects(invoke("demo", world), /Unknown command: demo/);
  assert.equal(existsSync(world), false);
});
