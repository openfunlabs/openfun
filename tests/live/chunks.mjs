// Explicit opt-in: exercises two real provider calls through the gameplay Host.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WorldStore } from "../../src/world/world.ts";
import { startHost } from "../../src/host.ts";

const [provider, model, target] = process.argv.slice(2);
if (!provider || !model || !target)
  throw new Error(
    "Usage: node tests/live/chunks.mjs PROVIDER MODEL NEW_WORLD_DIR",
  );
const dir = resolve(target);
WorldStore.create(dir, {
  name: "海崖观星遗迹",
  seed: "live-streaming",
  description:
    "海边悬崖上的古老观星遗迹，风格化青铜天文装置与青色晶石。相邻区域属于同一遗址，每个区域有独特地标与一位短句讲述当地故事的守望者。",
  rules: [
    "所有人物友善",
    "每区保留清楚可走的通路",
    "沿地图东侧逐渐接近观星祭坛",
  ],
  palette: { ground: "#527c75", sky: "#83a9bf", accent: "#daa34b" },
  density: 4,
}).close();
mkdirSync(join(dir, ".openfun"), { recursive: true });
writeFileSync(
  join(dir, ".openfun", "agent.json"),
  JSON.stringify({ provider, model, thinkingLevel: "low" }),
  { mode: 0o600 },
);
const host = await startHost(dir, {
  generation: {
    maxNewChunks: 2,
    concurrency: 1,
    maxQueued: 2,
    timeoutMs: 120000,
  },
});
const headers = {
  Authorization: `Bearer ${host.token}`,
  "Content-Type": "application/json",
};
const started = Date.now();
async function snapshot(x, heading = 0) {
  const response = await fetch(
    `${host.url}/snapshot?x=${x}&z=0&headingX=${heading}&headingZ=0`,
    { headers },
  );
  assert.equal(response.status, 200);
  return response.json();
}
async function waitFor(id, x, heading = 0) {
  const deadline = Date.now() + 130000;
  while (Date.now() < deadline) {
    const value = await snapshot(x, heading);
    const chunk = value.chunks.find((entry) => entry.id === id);
    if (chunk) return { chunk, snapshot: value };
    const failed = value.generation.regions.find(
      (entry) => entry.id === id && entry.status === "failed",
    );
    if (failed) throw new Error(failed.error);
    await delay(1000);
  }
  throw new Error(`Timed out waiting for real AI region ${id}`);
}
let summary;
try {
  const initial = await snapshot(0);
  assert.equal(
    initial.chunks.length,
    0,
    "Unknown map must not be procedurally filled",
  );
  const first = await waitFor("0,0", 0);
  const firstJson = JSON.stringify(first.chunk);
  console.log(
    "Initial AI region published",
    first.chunk.entities.map((entry) => entry.name),
  );
  const firstMs = Date.now() - started;
  const second = await waitFor("1,0", 10, 1);
  assert.equal(
    JSON.stringify(second.snapshot.chunks.find((entry) => entry.id === "0,0")),
    firstJson,
  );
  const response = await fetch(`${host.url}/command`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: "live-cross-region",
      type: "move",
      position: [17, 1.7, 0],
    }),
  });
  assert.equal(response.status, 200);
  summary = {
    passed: true,
    provider,
    model,
    callsBudget: 2,
    firstRegionMs: firstMs,
    totalMs: Date.now() - started,
    initialPending: initial.chunks.length === 0,
    regions: [first.chunk, second.chunk].map((chunk) => ({
      id: chunk.id,
      entities: chunk.entities.map((entry) => ({
        name: entry.name,
        kind: entry.kind,
      })),
    })),
    firstRegionUnchanged: true,
  };
} finally {
  await host.close();
}
const reopened = new WorldStore(dir);
try {
  assert.ok(reopened.getChunk(0, 0));
  assert.ok(reopened.getChunk(1, 0));
  assert.deepEqual(reopened.inspect().player.position, [17, 1.7, 0]);
  summary.restartPreserved = true;
} finally {
  reopened.close();
}
writeFileSync(
  join(dir, ".openfun", "generation-live-summary.json"),
  JSON.stringify(summary, null, 2),
  { mode: 0o600 },
);
console.log(JSON.stringify(summary, null, 2));
