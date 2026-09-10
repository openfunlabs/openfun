import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost } from "../../src/host.js";
import { WorldStore } from "../../src/world/world.js";
import type {
  ContentJob,
  GameState,
} from "../../src/generation/content-types.js";

const input = {
  namespace: "my_game",
  key: "scene:1",
  prompt: "Design the next scene.",
  schema: {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
    additionalProperties: false,
  },
};
async function fixture(options: Parameters<typeof startHost>[1] = {}) {
  const dir = mkdtempSync(join(tmpdir(), "openfun-content-host-"));
  WorldStore.create(dir, { name: "Editable game" }).close();
  const host = await startHost(dir, options);
  const headers = {
    Authorization: `Bearer ${host.token}`,
    "Content-Type": "application/json",
  };
  const fetchJson = async (path: string, body?: unknown) => {
    const response = await fetch(host.url + path, {
      headers,
      ...(body !== undefined
        ? { method: "POST", body: JSON.stringify(body) }
        : {}),
    });
    return { status: response.status, data: (await response.json()) as any };
  };
  return {
    dir,
    host,
    fetchJson,
    close: async () => {
      await host.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
async function ready(
  f: Awaited<ReturnType<typeof fixture>>,
  id: string,
): Promise<ContentJob> {
  for (let i = 0; i < 100; i++) {
    const current = await f.fetchJson(`/content/jobs?id=${id}`);
    if (["ready", "failed"].includes(current.data.job.status))
      return current.data.job;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Content job did not finish");
}

test("project APIs never start the fixed 3D queue and support authenticated jobs and CAS saves", async () => {
  let calls = 0,
    chunks = 0;
  const f = await fixture({
    generator: async () => {
      chunks++;
      throw new Error("3D generator must not run");
    },
    contentGenerator: async () => {
      calls++;
      return { name: "Generated arena" };
    },
  });
  try {
    assert.equal(
      (await fetch(f.host.url + "/game/state?namespace=my_game")).status,
      401,
    );
    assert.equal((await f.fetchJson("/health")).status, 200);
    assert.equal(
      (await f.fetchJson("/game/state?namespace=my_game")).data.revision,
      0,
    );
    assert.equal(calls, 0);
    assert.equal(chunks, 0);
    const submitted = await f.fetchJson("/content/jobs", input);
    assert.equal(submitted.status, 202);
    assert.equal(submitted.data.job.result, undefined);
    const job = await ready(f, submitted.data.job.id);
    assert.equal(job.status, "ready");
    assert.deepEqual(job.result, { name: "Generated arena" });
    assert.equal((await f.fetchJson("/content/jobs", input)).status, 200);
    assert.equal(
      (await f.fetchJson("/content/jobs", { ...input, prompt: "Changed" }))
        .status,
      409,
    );
    assert.equal(
      (await f.fetchJson("/content/jobs?namespace=my_game&key=scene%3A1")).data
        .job.id,
      job.id,
    );
    assert.equal(
      (await f.fetchJson("/content/jobs?namespace=my_game")).data.jobs.length,
      1,
    );
    assert.equal(
      (
        await f.fetchJson(
          "/content/jobs?id=00000000-0000-4000-8000-000000000000",
        )
      ).status,
      404,
    );
    const saved = await f.fetchJson("/game/state", {
      namespace: "my_game",
      expectedRevision: 0,
      state: { hp: 73, enemies: ["one"], stageJob: job.id },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.revision, 1);
    const conflict = await f.fetchJson("/game/state", {
      namespace: "my_game",
      expectedRevision: 0,
      state: { hp: 100 },
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.data.code, "revision_conflict");
    assert.equal(conflict.data.current.state.hp, 73);
    assert.equal(
      (
        await f.fetchJson("/game/state", {
          namespace: "my_game",
          expectedRevision: 1,
          state: "x".repeat(260 * 1024),
        })
      ).status,
      400,
    );
    assert.equal(calls, 1);
    assert.equal(chunks, 0);
    const world = new WorldStore(f.dir);
    assert.equal(world.inspect().chunks, 0);
    world.close();
  } finally {
    await f.close();
  }
});

test("retry API recovers failed content without silent fallback and state survives host restart", async () => {
  let calls = 0;
  const f = await fixture({
    contentGenerator: async () => {
      if (++calls === 1) throw new Error("Fixture generation failed");
      return { name: "Second attempt" };
    },
    generation: { maxNewChunks: 2 },
  });
  let host = f.host;
  try {
    const submitted = await f.fetchJson("/content/jobs", input);
    const failed = await ready(f, submitted.data.job.id);
    assert.equal(failed.status, "failed");
    assert.match(failed.error!, /Fixture/);
    assert.equal(failed.result, undefined);
    const retried = await f.fetchJson(`/content/jobs/${failed.id}/retry`, {});
    assert.equal(retried.status, 200);
    assert.equal((await ready(f, failed.id)).status, "ready");
    assert.equal(calls, 2);
    assert.equal(
      (await f.fetchJson("/content/jobs", { ...input, key: "scene:2" })).status,
      429,
    );
    const saved = await f.fetchJson("/game/state", {
      namespace: "my_game",
      expectedRevision: 0,
      state: { hp: 51, enemyStates: [{ id: "e", hp: 0 }], skills: ["moon"] },
    });
    await host.close();
    host = await startHost(f.dir, {
      generation: { maxNewChunks: 0 },
      contentGenerator: async () => {
        throw new Error("No model call");
      },
    });
    const headers = {
      Authorization: `Bearer ${host.token}`,
      "Content-Type": "application/json",
    };
    const replay = await fetch(host.url + "/content/jobs", {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    assert.equal(replay.status, 200);
    assert.equal(
      ((await replay.json()) as { job: ContentJob }).job.status,
      "ready",
    );
    const state = (await (
      await fetch(host.url + "/game/state?namespace=my_game", { headers })
    ).json()) as GameState;
    assert.deepEqual(state.state, saved.data.state);
  } finally {
    await host.close();
    await f.close();
  }
});

test("legacy and project generation share one attempt budget", async () => {
  let contentCalls = 0,
    chunkCalls = 0;
  const f = await fixture({
    contentGenerator: async () => {
      contentCalls++;
      return { name: "Content" };
    },
    generator: async () => {
      chunkCalls++;
      return { entities: [] };
    },
    generation: { maxNewChunks: 1 },
  });
  try {
    const submitted = await f.fetchJson("/content/jobs", input);
    await ready(f, submitted.data.job.id);
    const snapshot = await f.fetchJson("/snapshot");
    assert.equal(snapshot.data.generation.budgetRemaining, 0);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(contentCalls, 1);
    assert.equal(chunkCalls, 0);
    assert.equal(
      (await f.fetchJson("/content/jobs", { ...input, key: "second" })).status,
      429,
    );
  } finally {
    await f.close();
  }
});

test("explicit demo does not call models through generic APIs", async () => {
  let calls = 0;
  const f = await fixture({
    generationMode: "demo",
    contentGenerator: async () => {
      calls++;
      return {};
    },
  });
  try {
    assert.equal((await f.fetchJson("/health")).data.generationMode, "demo");
    const rejected = await f.fetchJson("/content/jobs", input);
    assert.equal(rejected.status, 429);
    assert.match(rejected.data.error, /disabled/);
    assert.equal(
      (
        await f.fetchJson("/game/state", {
          namespace: "my_game",
          expectedRevision: 0,
          state: { demo: true },
        })
      ).status,
      200,
    );
    assert.equal(calls, 0);
  } finally {
    await f.close();
  }
});
