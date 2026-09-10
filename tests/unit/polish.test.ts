import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  rm,
  rename,
  lstat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContentStore } from "../../src/generation/content-store.js";
import { WorldStore } from "../../src/world/world.js";
import { ensureGameProject } from "../../src/godot/project.js";
import { PolishController, saveJson } from "../../src/polish/controller.js";
import type { RoundReport } from "../../src/polish/schema.js";

const report = (outcome: RoundReport["outcome"] = "improved"): RoundReport => ({
  outcome,
  summary: "Improved readable combat feedback",
  checks: ["Test fixture validation, not live model judgment"],
  remaining: [],
});
async function fixture(
  t: TestContext,
  run: ConstructorParameters<typeof PolishController>[1]["run"],
  options: Partial<ConstructorParameters<typeof PolishController>[1]> = {},
) {
  const world = await mkdtemp(join(tmpdir(), "openfun-polish-"));
  WorldStore.create(world, { name: "Polish test" }).close();
  await ensureGameProject(world);
  const messages: string[] = [];
  const loop = new PolishController(world, {
    run,
    check: async () => {},
    playing: () => false,
    notify: (message) => messages.push(message),
    ...options,
  });
  t.after(async () => {
    await loop.stop();
    await rm(world, { recursive: true, force: true });
  });
  return { world, loop, messages };
}
const edit = (candidate: string, value: string) =>
  writeFile(join(candidate, "game", "polish-note.txt"), value);

test("polish is opt-in, runs beyond three rounds without caps, applies accepted source and preserves the save", async (t) => {
  let rounds = 0;
  const { loop, world } = await fixture(t, async (candidate) => {
    await edit(candidate, String(++rounds));
    return report(rounds === 4 ? "finished" : "improved");
  });
  assert.equal(await loop.state(), undefined);
  const store = new ContentStore(world);
  const saved = store.saveState({
    namespace: "test",
    expectedRevision: 0,
    state: { hp: 37, level: 4 },
  });
  store.close();
  await loop.start();
  await loop.idle();
  const state = (await loop.state())!;
  assert.equal(state.status, "applied");
  assert.equal(state.round, 4);
  assert.equal(
    await readFile(join(world, "game/polish-note.txt"), "utf8"),
    "4",
  );
  const restored = new ContentStore(world);
  assert.deepEqual(restored.getState("test"), saved);
  restored.close();
  assert.ok(await lstat(join(loop.root, state.id, "original-game")));
});

test("rejected changes are discarded and a no-gain judgment ends the loop", async (t) => {
  const { loop, world } = await fixture(t, async (candidate) => {
    await edit(candidate, "rejected");
    return report("no_gain");
  });
  await loop.start();
  await loop.idle();
  assert.equal((await loop.state())?.status, "stopped");
  await assert.rejects(readFile(join(world, "game/polish-note.txt")), /ENOENT/);
});

test("verification failure retains original and resume starts from the last accepted checkpoint", async (t) => {
  let calls = 0;
  const { loop, world } = await fixture(
    t,
    async (candidate) => {
      if (calls++) {
        await assert.rejects(
          readFile(join(candidate, "game/polish-note.txt")),
          /ENOENT/,
        );
        return report("no_gain");
      }
      await edit(candidate, "invalid");
      return report();
    },
    {
      check: async () => {
        throw new Error("Godot parse failed");
      },
    },
  );
  await loop.start();
  await loop.idle();
  assert.equal((await loop.state())?.status, "paused");
  await assert.rejects(readFile(join(world, "game/polish-note.txt")), /ENOENT/);
  await loop.start({}, true);
  await loop.idle();
  assert.equal((await loop.state())?.status, "stopped");
});

test("playing and original edits prevent promotion; source conflicts cannot be overwritten", async (t) => {
  let playing = true;
  const { loop, world } = await fixture(
    t,
    async (candidate) => {
      await edit(candidate, "candidate");
      return report("finished");
    },
    { playing: () => playing },
  );
  await loop.start();
  await loop.idle();
  assert.equal((await loop.state())?.status, "ready");
  await assert.rejects(loop.apply(), /Stop the game/);
  playing = false;
  await writeFile(join(world, "game/player-notes.txt"), "User edit");
  await assert.rejects(loop.apply(), /Original project changed/);
  assert.equal(
    await readFile(join(world, "game/player-notes.txt"), "utf8"),
    "User edit",
  );
});

test("stop cancels active worker and explicit resume recovers its checkpoint", async (t) => {
  let entered!: () => void;
  const running = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let calls = 0;
  const { loop } = await fixture(t, async (candidate, _state, signal) => {
    if (calls++) {
      await assert.rejects(
        readFile(join(candidate, "game/polish-note.txt")),
        /ENOENT/,
      );
      return report("finished");
    }
    await edit(candidate, "unfinished");
    entered();
    return new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      }),
    );
  });
  await loop.start();
  await running;
  await assert.rejects(loop.start(), /already running/);
  await loop.stop();
  assert.equal((await loop.state())?.status, "paused");
  await loop.start({ focus: "Improve story" }, true);
  await loop.idle();
  assert.equal((await loop.state())?.options.focus, "Improve story");
});

test("interrupted promotion rolls back before an explicit apply and keeps the database", async (t) => {
  let playing = true;
  const { loop, world } = await fixture(
    t,
    async (candidate) => {
      await edit(candidate, "accepted");
      return report("finished");
    },
    { playing: () => playing },
  );
  await loop.start();
  await loop.idle();
  const state = (await loop.state())!,
    folder = join(loop.root, state.id);
  await rename(join(world, "game"), join(folder, "original-game"));
  await mkdir(join(world, "game"));
  await writeFile(join(world, "game/broken.txt"), "partial apply");
  await saveJson(join(folder, "promotion.json"), {
    status: "applying",
    originalPaths: ["game"],
  });
  playing = false;
  await loop.apply();
  assert.equal((await loop.state())?.status, "applied");
  assert.equal(
    await readFile(join(world, "game/polish-note.txt"), "utf8"),
    "accepted",
  );
  assert.ok(await lstat(join(world, "world.sqlite")));
});

test("Godot-generated sidecars are sealed after validation rather than rejecting the checked candidate", async (t) => {
  const { loop, world } = await fixture(
    t,
    async (candidate) => {
      await edit(candidate, "accepted");
      return report("finished");
    },
    {
      check: async (candidate) => {
        await writeFile(join(candidate, "game/imported.uid"), "uid://fixture");
      },
    },
  );
  await loop.start();
  await loop.idle();
  assert.equal((await loop.state())?.status, "applied");
  assert.equal(
    await readFile(join(world, "game/imported.uid"), "utf8"),
    "uid://fixture",
  );
});

test("changed world canon blocks applying a candidate based on obsolete rules", async (t) => {
  let playing = true;
  const { loop, world } = await fixture(
    t,
    async (candidate) => {
      await edit(candidate, "accepted");
      return report("finished");
    },
    { playing: () => playing },
  );
  await loop.start();
  await loop.idle();
  playing = false;
  await writeFile(
    join(world, "WORLD.md"),
    "User changed the game's world canon.",
  );
  await assert.rejects(loop.apply(), /Original project changed/);
});

test("interrupted asset task identities survive checkpoint restore without a second submission", async (t) => {
  let calls = 0;
  const { loop } = await fixture(t, async (candidate) => {
    const ledger = join(candidate, ".openfun/meshy");
    if (calls++) {
      assert.equal(
        JSON.parse(await readFile(join(ledger, "paid-v1.json"), "utf8")).taskId,
        "existing-paid-task",
      );
      return report("no_gain");
    }
    await mkdir(ledger, { recursive: true });
    await writeFile(
      join(ledger, "paid-v1.json"),
      JSON.stringify({ requestHash: "fixture", taskId: "existing-paid-task" }),
    );
    throw new Error("Interrupted after submitting asset");
  });
  await loop.start();
  await loop.idle();
  assert.equal((await loop.state())?.status, "paused");
  await loop.start({}, true);
  await loop.idle();
  assert.equal(calls, 2);
});
