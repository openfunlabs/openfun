import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ContentStore,
  exportRuntimeData,
  importRuntimeData,
} from "../../src/generation/content-store.js";
import { ContentGenerationQueue } from "../../src/generation/content.js";
import {
  CONTENT_LIMITS,
  ContentError,
  parseContentRequest,
  validateContentResult,
  type ContentRequest,
} from "../../src/generation/content-types.js";
import { readContentDocuments } from "../../src/generation/content-documents.js";

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "openfun-content-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const store = new ContentStore(dir);
  cleanup.push(() => store.close());
  return { dir, store };
}
function request(key = "arena:1"): ContentRequest {
  return {
    namespace: "custom_game",
    key,
    prompt: "Design an arena in the invented world.",
    schema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1 },
        count: { type: "integer", minimum: 1, maximum: 8 },
      },
      required: ["name", "count"],
      additionalProperties: false,
    },
    context: { level: 1 },
  };
}
const result = { name: "Moonlit archive", count: 3 };
function queue(
  store: ContentStore,
  generator: ConstructorParameters<typeof ContentGenerationQueue>[1],
  options: ConstructorParameters<typeof ContentGenerationQueue>[2] = {},
) {
  const value = new ContentGenerationQueue(store, generator, options);
  cleanup.push(() => value.close());
  return value;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("generic schemas validate nested object/array/union content without a gameplay vocabulary", () => {
  const schema = parseContentRequest({
    ...request(),
    schema: {
      type: "object",
      properties: {
        cards: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          items: {
            type: "object",
            properties: {
              suit: { enum: ["sun", "moon"] },
              rank: { type: "integer", minimum: 1, maximum: 9 },
            },
            required: ["suit", "rank"],
            additionalProperties: false,
          },
        },
        bonus: { anyOf: [{ type: "null" }, { type: "number", minimum: 0 }] },
      },
      required: ["cards"],
      additionalProperties: false,
    },
  }).schema;
  assert.deepEqual(
    validateContentResult(schema, {
      cards: [{ suit: "sun", rank: 4 }],
      bonus: null,
    }),
    { cards: [{ suit: "sun", rank: 4 }], bonus: null },
  );
  assert.throws(
    () => validateContentResult(schema, { cards: [{ suit: "star", rank: 4 }] }),
    /does not match/,
  );
  assert.throws(
    () => validateContentResult(schema, { cards: [], code: "run" }),
    /does not match/,
  );
  assert.throws(
    () =>
      parseContentRequest({
        ...request(),
        schema: { type: "object", $ref: "https://example.invalid/schema" },
      }),
    /Unsupported/,
  );
  assert.throws(
    () =>
      parseContentRequest({
        ...request(),
        schema: {
          type: "object",
          properties: { x: { type: "string", pattern: ".*" } },
        },
      }),
    /Unsupported/,
  );
  assert.throws(
    () => parseContentRequest({ ...request(), context: { x: Infinity } }),
    /finite JSON/,
  );
  assert.throws(
    () =>
      parseContentRequest({
        ...request(),
        context: "x".repeat(CONTENT_LIMITS.contextBytes),
      }),
    /byte limit/,
  );
  let nested: unknown = { type: "string" };
  for (let i = 0; i < 18; i++)
    nested = { type: "object", properties: { child: nested } };
  assert.throws(
    () => parseContentRequest({ ...request(), schema: nested }),
    /depth|complexity/,
  );
});

test("jobs persist and deduplicate by canonical request, ready content is never regenerated", async () => {
  const { dir, store } = fixture();
  let calls = 0;
  const worker = queue(store, async () => {
    calls++;
    return result;
  });
  const first = worker.submit(request());
  assert.equal(first.created, true);
  assert.equal(first.job.result, undefined);
  await worker.idle();
  const reordered = {
    context: { level: 1 },
    schema: request().schema,
    prompt: request().prompt,
    key: request().key,
    namespace: request().namespace,
  };
  assert.equal(worker.submit(reordered).job.id, first.job.id);
  assert.equal(calls, 1);
  assert.deepEqual(store.getJob(first.job.id)?.result, result);
  assert.throws(
    () => worker.submit({ ...request(), prompt: "Changed" }),
    (error: unknown) => error instanceof ContentError && error.status === 409,
  );
  await worker.close();
  const reopened = new ContentStore(dir);
  try {
    const disabled = queue(
      reopened,
      async () => {
        throw new Error("Must not call");
      },
      { maxAttempts: 0 },
    );
    assert.deepEqual(disabled.submit(request()).job.result, result);
    await disabled.close();
  } finally {
    reopened.close();
  }
});

test("actual world and project documents enter generation, private creator files do not", async () => {
  const { dir, store } = fixture();
  mkdirSync(join(dir, "design"));
  mkdirSync(join(dir, "game"));
  writeFileSync(join(dir, "WORLD.md"), "The world has two moons.");
  writeFileSync(
    join(dir, "design", "characters.md"),
    "The guardian is called Sen.",
  );
  writeFileSync(
    join(dir, "game", "DESIGN.md"),
    "The project is a turn-based card game.",
  );
  writeFileSync(join(dir, "AGENTS.md"), "PRIVATE_AUTHOR_CONTEXT");
  writeFileSync(join(dir, ".openfun", "auth.json"), "PRIVATE_CREDENTIALS");
  let seen = "";
  const worker = queue(store, async (input) => {
    seen = JSON.stringify(input);
    return result;
  });
  worker.submit(request());
  await worker.idle();
  assert.match(seen, /two moons/);
  assert.match(seen, /called Sen/);
  assert.match(seen, /turn-based card/);
  assert.doesNotMatch(seen, /PRIVATE_AUTHOR|PRIVATE_CREDENTIALS/);
  symlinkSync(
    join(dir, ".openfun", "auth.json"),
    join(dir, "design", "linked.md"),
  );
  assert.throws(() => readContentDocuments(dir), /symbolic links/);
  rmSync(join(dir, "design", "linked.md"));
  writeFileSync(join(dir, "design", "too-big.md"), "x".repeat(65 * 1024));
  assert.throws(() => readContentDocuments(dir), /byte limit/);
});

test("invalid output fails visibly, explicit retry consumes budget and preserves identity", async () => {
  const { store } = fixture();
  let calls = 0;
  const worker = queue(
    store,
    async () => (++calls === 1 ? { name: "bad", count: 100 } : result),
    { maxAttempts: 2 },
  );
  const job = worker.submit(request()).job;
  await worker.idle();
  assert.equal(store.getJob(job.id)?.status, "failed");
  assert.equal(store.getJob(job.id)?.result, undefined);
  worker.submit(request());
  await worker.idle();
  assert.equal(calls, 1);
  worker.retry(job.id);
  await worker.idle();
  assert.equal(store.getJob(job.id)?.status, "ready");
  assert.equal(store.getJob(job.id)?.attempt, 2);
  assert.equal(worker.view().budgetRemaining, 0);
  assert.throws(() => worker.submit(request("arena:2")), /budget reached/);
});

test("authentication failure pauses the queue until explicit retry after login", async () => {
  const { store } = fixture();
  let authenticated = false,
    calls = 0;
  const worker = queue(store, async () => {
    calls++;
    if (!authenticated)
      throw new Error("No authenticated pi model. Use /login.");
    return result;
  });
  const first = worker.submit(request()).job;
  const second = worker.submit(request("arena:2")).job;
  await worker.idle();
  assert.equal(calls, 1);
  assert.equal(store.getJob(second.id)?.status, "failed");
  assert.match(worker.view().blockedReason!, /login/);
  assert.throws(() => worker.submit(request("arena:3")), /login/);
  authenticated = true;
  worker.retry(first.id);
  await worker.idle();
  assert.equal(store.getJob(first.id)?.status, "ready");
  assert.equal(calls, 2);
});

test("cancellation and timeout prevent late responses from publishing", async () => {
  const { store } = fixture();
  const late = deferred<unknown>();
  const worker = queue(store, async () => late.promise, { timeoutMs: 15 });
  const job = worker.submit(request()).job;
  await worker.idle();
  assert.equal(store.getJob(job.id)?.status, "failed");
  assert.match(store.getJob(job.id)?.error ?? "", /timed out/);
  late.resolve(result);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(store.getJob(job.id)?.result, undefined);
  const waiting = deferred<unknown>();
  const other = queue(store, async () => waiting.promise);
  const cancelled = other.submit(request("cancelled")).job;
  other.cancel(cancelled.id);
  await other.idle();
  waiting.resolve(result);
  assert.equal(store.getJob(cancelled.id)?.status, "failed");
  assert.equal(store.getJob(cancelled.id)?.result, undefined);
});

test("stopping an in-flight job is resumable and preserves attempt identity", async () => {
  const { store } = fixture();
  const worker = queue(store, async () => new Promise(() => {}));
  const job = worker.submit(request()).job;
  await new Promise<void>((resolve) => setImmediate(resolve));
  await worker.close();
  assert.equal(store.getJob(job.id)?.status, "pending");
  const restarted = queue(store, async () => result);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await restarted.idle();
  assert.equal(store.getJob(job.id)?.status, "ready");
  assert.equal(store.getJob(job.id)?.attempt, 2);
});

test("concurrency, queue admission and explicit demo disable stay bounded", async () => {
  const { store } = fixture();
  let active = 0,
    maxActive = 0;
  const tasks = [deferred<unknown>(), deferred<unknown>(), deferred<unknown>()];
  let call = 0;
  const worker = queue(
    store,
    async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        return await tasks[call++]!.promise;
      } finally {
        active--;
      }
    },
    { concurrency: 2, maxQueued: 1, maxAttempts: 3 },
  );
  worker.submit(request("one"));
  worker.submit(request("two"));
  worker.submit(request("three"));
  assert.throws(() => worker.submit(request("four")), /budget|queue/);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(maxActive, 2);
  tasks[0]!.resolve(result);
  tasks[1]!.resolve(result);
  tasks[2]!.resolve(result);
  await worker.idle();
  assert.equal(call, 3);
  assert.equal(worker.view().budgetRemaining, 0);
  const demo = queue(
    store,
    async () => {
      throw new Error("No call allowed");
    },
    { enabled: false },
  );
  assert.throws(() => demo.submit(request("demo")), /disabled/);
});

test("generic gameplay state persists with compare-and-swap revisions and JSON bounds", () => {
  const { dir, store } = fixture();
  assert.deepEqual(store.getState("cards"), {
    namespace: "cards",
    revision: 0,
    state: null,
    updatedAt: null,
  });
  const state = {
    player: { hp: 81, position: [20, 40] },
    enemies: [{ id: "e1", hp: 12 }],
    skills: ["dash"],
    deck: ["sun"],
  };
  const saved = store.saveState({
    namespace: "cards",
    expectedRevision: 0,
    state,
  });
  assert.equal(saved.revision, 1);
  const second = new ContentStore(dir);
  try {
    assert.deepEqual(second.getState("cards").state, state);
    assert.throws(
      () =>
        second.saveState({
          namespace: "cards",
          expectedRevision: 0,
          state: { hp: 100 },
        }),
      (error: unknown) =>
        error instanceof ContentError &&
        error.status === 409 &&
        error.code === "revision_conflict" &&
        error.current?.revision === 1,
    );
    assert.equal(
      second.saveState({
        namespace: "cards",
        expectedRevision: 1,
        state: [1, true, null],
      }).revision,
      2,
    );
    assert.throws(
      () =>
        second.saveState({
          namespace: "cards",
          expectedRevision: 2,
          state: { bad: NaN },
        }),
      /finite JSON/,
    );
    assert.throws(
      () =>
        second.saveState({
          namespace: "cards",
          expectedRevision: 2,
          state: "x".repeat(CONTENT_LIMITS.stateBytes),
        }),
      /byte limit/,
    );
    assert.equal(second.getState("cards").revision, 2);
  } finally {
    second.close();
  }
});

test("runtime data exports only ready results and saves; imported jobs reuse content without login", async () => {
  const { dir, store } = fixture();
  const worker = queue(store, async () => result);
  const job = worker.submit(request()).job;
  await worker.idle();
  await worker.close();
  store.insert(request("not-published"));
  store.saveState({
    namespace: "custom_game",
    expectedRevision: 0,
    state: { hp: 72, contentJobId: job.id, skills: ["dash"] },
  });
  writeFileSync(join(dir, ".openfun", "auth.json"), "DO_NOT_EXPORT");
  const data = exportRuntimeData(dir);
  assert.equal(data.jobs.length, 1);
  assert.equal(data.states.length, 1);
  assert.doesNotMatch(JSON.stringify(data), /DO_NOT_EXPORT|not-published/);
  const target = join(dir, "imported");
  importRuntimeData(target, data);
  const imported = new ContentStore(target);
  try {
    const offline = queue(
      imported,
      async () => {
        throw new Error("No model call");
      },
      { maxAttempts: 0 },
    );
    assert.deepEqual(offline.submit(request()).job.result, result);
    assert.equal(offline.submit(request()).job.id, job.id);
    assert.throws(
      () => offline.submit({ ...request(), context: { level: 2 } }),
      /different request/,
    );
    assert.deepEqual(
      imported.getState("custom_game").state,
      data.states[0]!.state,
    );
    await offline.close();
    assert.throws(() => importRuntimeData(target, data), /already has data/);
    const corrupt = structuredClone(data);
    corrupt.jobs[0]!.job.result = { name: "invalid", count: 999 };
    assert.throws(
      () => importRuntimeData(join(dir, "invalid"), corrupt),
      /does not match/,
    );
    assert.equal(exportRuntimeData(join(dir, "invalid")).jobs.length, 0);
  } finally {
    imported.close();
  }
});

test("runtime continuity survives restart, separates published from played and isolates namespaces", async () => {
  const { dir, store } = fixture();
  const first = queue(store, async () => result);
  const a = first.submit(request("first")).job;
  await first.idle();
  const other = store.insert({ ...request("other"), namespace: "other_game" });
  store.publish(store.claim(other.id)!, {
    name: "Private other campaign",
    count: 1,
  });
  store.insert(request("not-ready"));
  store.saveState({
    namespace: "custom_game",
    expectedRevision: 0,
    state: {
      played: [a.id],
      resolved: ["rescued-cartographer"],
      nextGoal: "reach-observatory",
    },
  });
  const beforeRestart = store.continuityFor("custom_game", "unused");
  assert.deepEqual(
    beforeRestart.recentPublished.map((item) => item.id),
    [a.id],
  );
  await first.close();
  const reopened = new ContentStore(dir);
  cleanup.push(() => reopened.close());
  const seen: import("../../src/generation/content-types.js").ContentGenerationRequest[] =
    [];
  const second = queue(reopened, async (input) => {
    seen.push(input);
    return { name: "Observatory", count: 2 };
  });
  const next = second.submit(request("next"));
  await second.idle();
  const input = seen.find((item) => item.request.key === "next")!;
  assert.ok(input);
  assert.ok(
    input.continuity!.recentPublished.some(
      (item) => item.id === a.id && item.value !== null,
    ),
  );
  assert.ok(
    !input.continuity!.recentPublished.some(
      (item) => item.key === "other" || item.id === next.job.id,
    ),
  );
  assert.deepEqual(input.continuity!.savedState.value, {
    played: [a.id],
    resolved: ["rescued-cartographer"],
    nextGoal: "reach-observatory",
  });
  const calls = seen.length;
  assert.equal(second.submit(request("next")).created, false);
  await second.idle();
  assert.equal(seen.length, calls);
  assert.deepEqual(reopened.getJob(a.id)!.result, result);
});

test("continuity excerpts are bounded structured data and disclose omitted details", async () => {
  const { continuityExcerpt } = await import(
    "../../src/generation/continuity.js"
  );
  const full = { resolved: ["saved-npc"], branch: "diplomacy" };
  assert.deepEqual(continuityExcerpt(full), { value: full, truncated: false });
  const huge = {
    choices: Array.from({ length: 200 }, () => ({
      text: '星\\"'.repeat(3000),
    })),
    late: "not necessarily included",
  };
  for (const size of [6144, 16384]) {
    const excerpt = continuityExcerpt(huge, size);
    assert.equal(excerpt.truncated, true);
    assert.ok(Buffer.byteLength(JSON.stringify(excerpt.value)) <= size);
    assert.equal(typeof excerpt.value, "object");
  }
});
