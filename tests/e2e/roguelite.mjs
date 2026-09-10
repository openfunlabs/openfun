// Run with node --import tsx tests/e2e/roguelite.mjs [--visual] [--demo].
// Real Godot + Openfun HTTP queue + SQLite, with an explicitly injected test generator.
// No provider credentials or model calls are used by this deterministic regression test.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startHost } from "../../src/host.ts";
import { WorldStore } from "../../src/world/world.ts";

import { resolveTool } from "../../src/paths.ts";
import { ensureGameProject } from "../../src/godot/project.ts";
import { output } from "../helpers/paths.mjs";
const godot = resolveTool("godot");
assert.ok(godot, "Godot required");
const visual = process.argv.includes("--visual");
const demo = process.argv.includes("--demo");
const artifacts = output("roguelite");
await mkdir(artifacts, { recursive: true });
const world = await mkdtemp(join(tmpdir(), "openfun-roguelite-test-"));
WorldStore.create(world, {
  name: "Explicit deterministic roguelite test fixture",
}).close();
const project = await ensureGameProject(
  world,
  new URL("../fixtures/games/roguelite-2d", import.meta.url).pathname,
);
const calls = [];
const generated = [];
const level = (index) => ({
  title: `试炼回廊 ${index}`,
  story: "这是自动验收注入的测试内容，不是模型输出。",
  theme: ["moss", "ember", "moon"][(index - 1) % 3],
  walls: [
    { x: 5, y: 1 },
    { x: 6, y: 1 },
    { x: 10, y: 6 },
    { x: 11, y: 6 },
  ],
  enemies: [
    {
      id: "pursuer",
      kind: "chaser",
      x: 7,
      y: 3,
      hp: 34,
      speed: 64,
      damage: 8,
      cooldown: 1.1,
    },
    {
      id: "sentinel",
      kind: "shooter",
      x: 9,
      y: 4,
      hp: 30,
      speed: 58,
      damage: 7,
      cooldown: 1.4,
    },
    {
      id: "prowler",
      kind: "chaser",
      x: 11,
      y: 5,
      hp: 42,
      speed: 60,
      damage: 8,
      cooldown: 1.4,
    },
  ],
});
const skills = () => ({
  choices: [
    {
      id: "ember",
      name: "余烬之牙",
      description: "攻击伤害提高 8。",
      effect: "damage",
      amount: 2,
    },
    {
      id: "bloom",
      name: "苔石之心",
      description: "生命上限提高 24，并恢复同等生命。",
      effect: "vitality",
      amount: 2,
    },
    {
      id: "wind",
      name: "夜行者",
      description: "移动速度提高 28。",
      effect: "haste",
      amount: 2,
    },
  ],
});
const options = {
  generationMode: demo ? "demo" : "ai",
  projectDir: project,
  content: { maxAttempts: 6, timeoutMs: 5000 },
  contentGenerator: async ({ request }) => {
    calls.push(request.key);
    assert.equal(request.namespace, "roguelite2d");
    assert.equal(request.schema.type, "object");
    // Expose pending/running states to Godot before returning the fixture.
    await new Promise((r) => setTimeout(r, 300));
    const [kind, index] = request.key.split(":");
    const result = kind === "level" ? level(Number(index)) : skills();
    generated.push(request.key);
    return result;
  },
};
let host = await startHost(world, options);
async function state() {
  const response = await fetch(`${host.url}/game/state?namespace=roguelite2d`, {
    headers: { Authorization: `Bearer ${host.token}` },
  });
  assert.equal(response.status, 200);
  return response.json();
}
async function run(resume = false) {
  const args = [
    ...(visual ? [] : ["--headless"]),
    "--path",
    project,
    "--log-file",
    join(artifacts, resume ? "resume.log" : "smoke.log"),
    "--",
    `--host=${host.url}`,
    `--token=${host.token}`,
    resume ? "--smoke-resume" : "--smoke-test",
  ];
  if (visual && !resume)
    args.push(`--screenshot=${join(artifacts, "room.png")}`);
  const child = spawn(godot, args, { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (s) => {
    output += s;
  });
  child.stderr.on("data", (s) => {
    output += s;
  });
  const timer = setTimeout(() => child.kill("SIGTERM"), 60000);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  clearTimeout(timer);
  await writeFile(
    join(artifacts, resume ? "resume-output.txt" : "smoke-output.txt"),
    output,
  );
  assert.equal(code, 0, output.slice(-10000));
  assert.ok(
    !/SCRIPT ERROR|Parse Error|Invalid (?:call|access)/.test(output),
    output.slice(-10000),
  );
  const line = output
    .split("\n")
    .find((s) => s.startsWith("OPENFUN_ROGUELITE_SMOKE "));
  assert.ok(line, output);
  return JSON.parse(line.slice("OPENFUN_ROGUELITE_SMOKE ".length));
}
try {
  const first = await run();
  assert.equal(first.ok, true);
  assert.ok(
    first.metrics.contact_hits > 0,
    "chaser combat must hit a real player",
  );
  assert.ok(
    first.metrics.projectile_hits > 0,
    "shooter projectiles must hit a real player",
  );
  assert.ok(first.metrics.dashes > 0, "dash must be exercised");
  assert.equal(first.real_kills, 3);
  assert.equal(first.stats.damage, 26);
  const saved = await state();
  assert.equal(saved.state.level, 2);
  assert.equal(saved.state.selectedSkills.length, 1);
  assert.equal(saved.state.enemies.length, 3);
  assert.equal(saved.state.history["1"].enemies.length, 0);
  if (!demo)
    assert.ok(
      calls.includes("level:2:v1"),
      "floor 2 must be prefetched during floor 1",
    );
  // Restart BOTH Host and Godot, so results and CAS state must survive SQLite reopen.
  await host.close();
  const count = calls.length;
  host = await startHost(world, { ...options, content: { maxAttempts: 0 } });
  const second = await run(true);
  assert.equal(second.restored, true);
  assert.equal(second.level, saved.state.level);
  assert.equal(second.hp, saved.state.player.hp);
  assert.deepEqual(second.playerPosition, saved.state.player.position);
  assert.deepEqual(second.stats, saved.state.player.stats);
  assert.deepEqual(second.skills, saved.state.selectedSkills);
  assert.equal(second.enemyCount, saved.state.enemies.length);
  assert.deepEqual(second.enemies, saved.state.enemies);
  assert.ok(
    saved.state.enemies.some((enemy) => enemy.hp < enemy.max_hp),
    "partially damaged enemy must survive save/restore",
  );
  assert.equal(
    calls.length,
    count,
    "resume must not need a new provider request",
  );
  const report = {
    ok: true,
    testContent: demo ? "explicit-demo" : "injected-fixture-not-ai",
    realHost: true,
    realGodot: true,
    hostAndClientRestarted: true,
    first,
    second,
    calls,
    generated,
  };
  await writeFile(
    join(artifacts, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await writeFile(
    join(
      artifacts,
      `report-${demo ? "demo" : "fixture"}-${visual ? "visual" : "headless"}.json`,
    ),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await host.close();
  await rm(world, { recursive: true, force: true });
}
