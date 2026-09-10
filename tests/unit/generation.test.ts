import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  GenerationQueue,
  buildGenerationRequest,
  validateGeneratedPlan,
  type GenerationRequest,
} from "../../src/generation/chunks.js";
import { WorldStore } from "../../src/world/world.js";
import type { ChunkPlan } from "../../src/world/schema.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "openfun-generation-"));
  const store = WorldStore.create(dir, {
    name: "悬月港",
    seed: "moon",
    rules: ["居民研究月亮"],
    density: 4,
  });
  cleanups.push(async () => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}
function queue(
  store: WorldStore,
  generator: ConstructorParameters<typeof GenerationQueue>[1],
  options: ConstructorParameters<typeof GenerationQueue>[2] = {},
) {
  const value = new GenerationQueue(store, generator, {
    prefetchRadius: 0,
    ...options,
  });
  cleanups.push(() => value.close());
  return value;
}
function plan(x = 0, z = 0, name = "月亮研究员"): ChunkPlan {
  return {
    entities: [
      {
        kind: "npc",
        name,
        position: [x * 32 + 7, 0, z * 32 + 7],
        rotation: 0,
        scale: [1, 1, 1],
        color: "#aabbcc",
        state: { dialogue: "这里能看见两个月亮。" },
      },
    ],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test("snapshot is read-only and unknown regions require an explicit plan", () => {
  const store = fixture();
  assert.equal(store.getSnapshot().chunks.length, 0);
  store.getSnapshot(64, 64);
  assert.equal(store.inspect().chunks, 0);
  assert.equal(store.inspect().jobs, 0);
  assert.throws(
    () => store.generateChunk(0, 0),
    /requires an AI or authored plan/,
  );
  assert.equal(store.inspect().events, 0);
});

test("one model plan publishes transactionally, then revisits never regenerate modified entities", async () => {
  const store = fixture();
  const response = deferred<ChunkPlan>();
  let calls = 0;
  const worker = queue(store, async (request) => {
    calls++;
    assert.equal(request.spec.name, "悬月港");
    return response.promise;
  });
  worker.request(0, 8);
  worker.request(0, 8);
  assert.equal(store.getGenerationJob(0, 0)?.status, "running");
  assert.equal(store.getSnapshot().chunks.length, 0);
  response.resolve(plan());
  await worker.idle();
  assert.equal(calls, 1);
  assert.equal(store.getGenerationJob(0, 0)?.status, "ready");
  const entity = store.getChunk(0, 0)!.entities[0]!;
  store.updateEntity(entity.id, {
    state: { dialogue: "记住玩家上次的选择。" },
  });
  worker.request(0, 8);
  await worker.idle();
  assert.equal(calls, 1);
  assert.equal(
    store.getChunk(0, 0)!.entities[0]!.state.dialogue,
    "记住玩家上次的选择。",
  );
});

test("generation context uses current design, published neighbors and matching shared portals", () => {
  const store = fixture();
  store.generateChunk(0, 0, plan());
  store.queueGeneration(1, 0);
  const job = store.claimGeneration(1, 0)!;
  const request = buildGenerationRequest(store, job);
  assert.equal(request.neighbors[0]?.entities[0]?.name, "月亮研究员");
  assert.deepEqual(request.boundaries.portals[0], [16, 0, 0]);
  assert.equal(request.specRevision, store.inspect().specRevision);
  assert.deepEqual(request.spec.rules, ["居民研究月亮"]);
});

test("initial generation costs one call and prefetch is directional and bounded", async () => {
  const store = fixture();
  const requests: GenerationRequest[] = [];
  const worker = queue(
    store,
    async (request) => {
      requests.push(request);
      return plan(request.chunk.x, request.chunk.z);
    },
    { prefetchRadius: 1, maxNewChunks: 2, maxQueued: 1 },
  );
  worker.request(0, 8, 1, 0);
  await worker.idle();
  assert.equal(requests.length, 1);
  worker.request(0, 8, 1, 0);
  await worker.idle();
  assert.deepEqual(
    requests.map((item) => item.chunk.id),
    ["0,0", "1,0"],
  );
  worker.request(0, 8, -1, 0);
  await worker.idle();
  assert.equal(requests.length, 2);
  assert.equal(worker.view().budgetRemaining, 0);
  assert.match(worker.view().blockedReason!, /budget reached/);
  assert.throws(() => worker.retry(-1, 0), /budget/);
});

test("concurrent workers respect the configured bound and consume one attempt per chunk", async () => {
  const store = fixture();
  for (const [x, z] of [
    [0, 0],
    [1, 0],
    [0, 1],
  ])
    store.queueGeneration(x!, z!);
  const gates: {
    request: GenerationRequest;
    response: ReturnType<typeof deferred<ChunkPlan>>;
  }[] = [];
  const worker = queue(
    store,
    async (request) => {
      const response = deferred<ChunkPlan>();
      gates.push({ request, response });
      return response.promise;
    },
    { concurrency: 2 },
  );
  worker.request(0, 8);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(gates.length, 2);
  assert.equal(worker.view().active, 2);
  gates[0]!.response.resolve(
    plan(gates[0]!.request.chunk.x, gates[0]!.request.chunk.z),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(gates.length, 3);
  assert.equal(worker.view().active, 2);
  for (const gate of gates.slice(1))
    gate.response.resolve(plan(gate.request.chunk.x, gate.request.chunk.z));
  await worker.idle();
  assert.equal(store.inspect().chunks, 3);
});

test("cancellation and timeout cannot publish late model responses", async () => {
  const store = fixture();
  const response = deferred<ChunkPlan>();
  const worker = queue(store, async () => response.promise, { timeoutMs: 30 });
  worker.request(0, 8);
  await worker.idle();
  assert.equal(store.getGenerationJob(0, 0)?.status, "failed");
  assert.match(store.getGenerationJob(0, 0)?.error ?? "", /timed out/);
  response.resolve(plan());
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(store.inspect().chunks, 0);
  worker.retry(0, 0);
  worker.cancel(0, 0);
  await worker.idle();
  assert.equal(store.inspect().chunks, 0);
  assert.match(store.getGenerationJob(0, 0)?.error ?? "", /cancelled/);
});

test("in-flight jobs survive host stop and are resumed with a new attempt", async () => {
  const store = fixture();
  const worker = queue(
    store,
    async () => new Promise<ChunkPlan>(() => undefined),
  );
  worker.request(0, 8);
  await worker.close();
  assert.equal(store.getGenerationJob(0, 0)?.status, "pending");
  const resumed = queue(store, async () => plan());
  resumed.request(0, 8);
  await resumed.idle();
  assert.equal(store.getGenerationJob(0, 0)?.status, "ready");
  assert.equal(store.getGenerationJob(0, 0)?.attempt, 2);
});

test("a new queue recovers an interrupted persisted running job", async () => {
  const store = fixture();
  store.queueGeneration(0, 0);
  store.claimGeneration(0, 0);
  const worker = queue(store, async () => plan());
  assert.equal(store.getGenerationJob(0, 0)?.status, "pending");
  worker.request(0, 8);
  await worker.idle();
  assert.equal(store.getGenerationJob(0, 0)?.attempt, 2);
});

test("missing authentication is visible, pauses generation and requires an explicit retry", async () => {
  const store = fixture();
  let calls = 0;
  const worker = queue(store, async () => {
    calls++;
    if (calls === 1) throw new Error("No authenticated pi model. Use /login.");
    return plan();
  });
  worker.request(0, 8);
  await worker.idle();
  worker.request(0, 8);
  assert.equal(calls, 1);
  assert.equal(store.inspect().chunks, 0);
  assert.match(worker.view().blockedReason!, /login/);
  assert.equal(
    worker.view().regions.find((region) => region.id === "0,0")?.status,
    "failed",
  );
  worker.retry(0, 0);
  await worker.idle();
  assert.equal(store.getGenerationJob(0, 0)?.status, "ready");
});

test("invalid model output fails without a partial world or hidden procedural fallback", async () => {
  const store = fixture();
  const invalid = plan();
  invalid.entities[0]!.position = [0, 0, 0];
  const worker = queue(store, async () => invalid);
  worker.request(0, 8);
  await worker.idle();
  assert.equal(store.inspect().chunks, 0);
  assert.equal(store.inspect().entities, 0);
  assert.equal(store.inspect().events, 0);
  assert.match(store.getGenerationJob(0, 0)?.error ?? "", /corridor/);
});

test("world changes during inference discard the stale plan; explicit retry uses new spec", async () => {
  const store = fixture();
  const response = deferred<ChunkPlan>();
  const requests: GenerationRequest[] = [];
  const worker = queue(store, async (request) => {
    requests.push(request);
    return requests.length === 1 ? response.promise : plan();
  });
  worker.request(0, 8);
  await new Promise<void>((resolve) => setImmediate(resolve));
  store.updateSpec({ description: "月亮现在有三颗。" });
  response.resolve(plan());
  await worker.idle();
  assert.equal(store.inspect().chunks, 0);
  assert.match(
    store.getGenerationJob(0, 0)?.error ?? "",
    /changed during generation/,
  );
  worker.retry(0, 0);
  await worker.idle();
  assert.equal(requests[1]?.spec.description, "月亮现在有三颗。");
  assert.equal(store.getChunk(0, 0)?.specRevision, 2);
});

test("known imported regions remain playable with zero generation budget and no model", async () => {
  const store = fixture();
  store.generateChunk(0, 0, plan());
  const worker = queue(
    store,
    async () => {
      throw new Error("must not invoke model");
    },
    { maxNewChunks: 0, prefetchRadius: 1 },
  );
  worker.request(0, 8, 1, 0);
  await worker.idle();
  assert.equal(store.getSnapshot().chunks.length, 1);
  assert.equal(
    worker.view().regions.find((region) => region.id === "0,0")?.status,
    "ready",
  );
  assert.equal(store.listGenerationJobs().length, 0);
});

test("generated geometry cannot cross boundaries, overlap, or invent asset references", () => {
  const store = fixture();
  store.queueGeneration(0, 0);
  const request = buildGenerationRequest(store, store.claimGeneration(0, 0)!);
  const outside = plan();
  outside.entities[0]!.position = [15, 0, 7];
  assert.throws(() => validateGeneratedPlan(request, outside), /boundary/);
  const overlapping = plan();
  overlapping.entities.push({ ...overlapping.entities[0]! });
  assert.throws(() => validateGeneratedPlan(request, overlapping), /overlap/);
  const invented = plan();
  invented.entities[0]!.asset = `${"a".repeat(64)}.glb`;
  assert.throws(() => validateGeneratedPlan(request, invented), /catalog/);
});

test("3D region jobs receive persisted continuation rules while excluding private author files", async () => {
  const store = fixture();
  mkdirSync(join(store.dir, "design"));
  writeFileSync(
    join(store.dir, "design", "runtime.md"),
    "CONTINUATION_RULE: never resurrect the lighthouse keeper.",
  );
  writeFileSync(join(store.dir, "AGENTS.md"), "PRIVATE_AUTHOR_CONTEXT");
  let seen = "";
  const worker = queue(store, async (request) => {
    seen = JSON.stringify(request);
    return plan();
  });
  worker.request(0, 0);
  await worker.idle();
  assert.match(seen, /CONTINUATION_RULE/);
  assert.doesNotMatch(seen, /PRIVATE_AUTHOR_CONTEXT/);
  assert.ok(store.getChunk(0, 0));
});
