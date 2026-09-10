import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WorldStore } from "../../src/world/world.js";
import { startHost } from "../../src/host.js";
import type { ChunkPlan } from "../../src/world/schema.js";
import type { HostSnapshot } from "../../src/generation/chunks.js";

test("host authenticates, validates commands, publishes chunks and releases its exclusive lock", async () => {
  const dir = mkdtempSync(join(tmpdir(), "openfun-host-"));
  const store = WorldStore.create(dir, { name: "Host Test" });
  store.close();
  const host = await startHost(dir, { generationMode: "demo" });
  try {
    assert.equal((await fetch(host.url + "/snapshot")).status, 401);
    await assert.rejects(() => startHost(dir), /already has a running host/);
    const headers = {
      Authorization: `Bearer ${host.token}`,
      "Content-Type": "application/json",
    };
    const response = await fetch(host.url + "/snapshot", { headers });
    assert.equal(response.status, 200);
    const snapshot = (await response.json()) as {
      chunks: { entities: { id: string; kind: string }[] }[];
    };
    assert.equal(snapshot.chunks.length, 9);
    const result = await fetch(host.url + "/command", {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: randomUUID(),
        type: "interact",
        entityId: "0,0:0",
      }),
    });
    assert.equal(result.status, 200);
    assert.equal(((await result.json()) as { ok: boolean }).ok, true);
    assert.equal(
      (await fetch(host.url + "/snapshot?x=NaN", { headers })).status,
      400,
    );
    assert.equal(
      (await fetch(host.url + "/assets/evil.glb", { headers })).status,
      400,
    );
    assert.equal(
      (
        await fetch(host.url + "/command", {
          method: "POST",
          headers,
          body: JSON.stringify({ id: "bad", type: "execute", code: "evil" }),
        })
      ).status,
      400,
    );
  } finally {
    await host.close();
  }
  const restarted = await startHost(dir);
  await restarted.close();
  rmSync(dir, { recursive: true, force: true });
});

test("default AI host serves pending state, publishes a stub result and exposes its budget without procedural fallback", async () => {
  const dir = mkdtempSync(join(tmpdir(), "openfun-ai-host-"));
  WorldStore.create(dir, { name: "AI host" }).close();
  let submit!: (plan: ChunkPlan) => void;
  const result = new Promise<ChunkPlan>((resolve) => {
    submit = resolve;
  });
  let calls = 0;
  const host = await startHost(dir, {
    generator: async () => {
      calls++;
      return result;
    },
    generation: { maxNewChunks: 1, prefetchRadius: 0 },
  });
  const headers = {
    Authorization: `Bearer ${host.token}`,
    "Content-Type": "application/json",
  };
  try {
    const pending = (await (
      await fetch(`${host.url}/snapshot`, { headers })
    ).json()) as HostSnapshot;
    assert.equal(pending.chunks.length, 0);
    assert.equal(pending.generation.mode, "ai");
    assert.equal(
      pending.generation.regions.find((region) => region.id === "0,0")?.status,
      "running",
    );
    submit({
      entities: [
        {
          kind: "npc",
          name: "模型角色",
          position: [7, 0, 7],
          rotation: 0,
          scale: [1, 1, 1],
          color: "#aabbcc",
          state: {},
        },
      ],
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const ready = (await (
      await fetch(`${host.url}/snapshot`, { headers })
    ).json()) as HostSnapshot;
    assert.equal(ready.chunks.length, 1);
    assert.equal(ready.chunks[0]?.entities[0]?.name, "模型角色");
    assert.equal(calls, 1);
    assert.equal(ready.generation.budgetRemaining, 0);
    assert.match(ready.generation.blockedReason!, /budget/);
    const unknownMove = await fetch(`${host.url}/command`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: randomUUID(),
        type: "move",
        position: [32, 1.7, 0],
      }),
    });
    assert.equal(unknownMove.status, 400);
    assert.equal(
      (await fetch(`${host.url}/snapshot?x=320&z=0`, { headers })).status,
      400,
    );
    const retry = await fetch(`${host.url}/generation/retry`, {
      method: "POST",
      headers,
      body: JSON.stringify({ x: 1, z: 0 }),
    });
    assert.equal(retry.status, 400);
  } finally {
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("failed model generation is visible and a successful explicit retry changes the region to ready", async () => {
  const dir = mkdtempSync(join(tmpdir(), "openfun-ai-retry-"));
  WorldStore.create(dir, { name: "retry" }).close();
  let calls = 0;
  const host = await startHost(dir, {
    generator: async () => {
      if (++calls === 1) throw new Error("No authenticated model. Use /login.");
      return {
        entities: [
          {
            kind: "npc",
            name: "模型角色",
            position: [7, 0, 7],
            rotation: 0,
            scale: [1, 1, 1],
            color: "#aabbcc",
            state: {},
          },
        ],
      };
    },
    generation: { maxNewChunks: 2, prefetchRadius: 0 },
  });
  const headers = {
    Authorization: `Bearer ${host.token}`,
    "Content-Type": "application/json",
  };
  try {
    await fetch(`${host.url}/snapshot`, { headers });
    const failure = (await (
      await fetch(`${host.url}/snapshot`, { headers })
    ).json()) as HostSnapshot;
    assert.equal(failure.chunks.length, 0);
    assert.match(failure.generation.blockedReason!, /login/);
    assert.equal(calls, 1);
    const retry = await fetch(`${host.url}/generation/retry`, {
      method: "POST",
      headers,
      body: JSON.stringify({ x: 0, z: 0 }),
    });
    assert.equal(retry.status, 200);
    const ready = (await (
      await fetch(`${host.url}/snapshot`, { headers })
    ).json()) as HostSnapshot;
    assert.equal(ready.chunks.length, 1);
    assert.equal(calls, 2);
  } finally {
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
