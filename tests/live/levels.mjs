// Opt-in end-to-end acceptance with the user's configured pi authentication.
// Requires a fresh world path, explicit provider/model, and at most five attempts.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { WorldStore } from "../../src/world/world.ts";
import { ContentStore } from "../../src/generation/content-store.ts";
import { ensureGameProject } from "../../src/godot/project.ts";
import { startPlayer } from "../../src/godot/player.ts";
import { startHost } from "../../src/host.ts";
import { resolveTool } from "../../src/paths.ts";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((s) => s.startsWith("--"))
    .map((s) => {
      const [key, ...value] = s.slice(2).split("=");
      return [key, value.join("=") || true];
    }),
);
if (
  !args["run-live"] ||
  typeof args.provider !== "string" ||
  typeof args.model !== "string" ||
  typeof args.world !== "string"
) {
  throw new Error(
    "Explicit opt-in required: --run-live --world=<fresh path> --provider=<pi provider> --model=<model> [--max-attempts=5]",
  );
}
const replay = Boolean(args["replay-existing"]);
const budget = replay ? 0 : Number(args["max-attempts"] ?? 5);
assert.ok(
  replay || (Number.isInteger(budget) && budget >= 3 && budget <= 5),
  "Use a bounded budget of 3–5 attempts",
);
const world = resolve(args.world);
assert.ok(
  replay
    ? existsSync(join(world, "world.sqlite"))
    : !existsSync(join(world, "world.sqlite")),
  "Use a fresh world, or explicit --replay-existing for zero-budget replay",
);
const artifacts = resolve(".output");
const prefix = replay ? "roguelite-ai-replay" : "roguelite-ai";
await mkdir(artifacts, { recursive: true });
if (!replay)
  WorldStore.create(world, {
    name: "灯火之下",
    description:
      "废弃灯塔深入大地。持灯寻路人在苔藓石廊、余烬炉室与月光档案馆间寻找失散火种，对抗追猎影兽与施法守望者。神秘但温暖、危险可读的俯视角动作肉鸽。清除守卫后选取灯火赐福，继续深入。",
    palette: { ground: "#25332f", sky: "#10171c", accent: "#e1be78" },
  }).close();
const project = await ensureGameProject(
  world,
  new URL("../fixtures/games/roguelite-2d", import.meta.url).pathname,
);
let attemptsBefore = 0;
if (replay) {
  const store = new ContentStore(world);
  try {
    const saved = store.getState("roguelite2d");
    await writeFile(
      join(artifacts, `${prefix}-previous-state-${Date.now()}.json`),
      JSON.stringify(saved, null, 2),
    );
    // Explicit test-only replay: preserve the original state artifact, keep AI jobs immutable,
    // and reset only this acceptance world's gameplay namespace.
    store.saveState({
      namespace: "roguelite2d",
      expectedRevision: saved.revision,
      state: null,
    });
    attemptsBefore = store
      .listJobs("roguelite2d")
      .reduce((sum, job) => sum + job.attempt, 0);
  } finally {
    store.close();
  }
  for (const file of [
    "game.gd",
    "content.gd",
    "project.godot",
    "main.tscn",
    "DESIGN.md",
  ])
    await cp(
      resolve("tests/fixtures/games/roguelite-2d", file),
      join(project, file),
    );
}
await mkdir(join(world, ".openfun"), { recursive: true });
await writeFile(
  join(world, ".openfun/agent.json"),
  JSON.stringify(
    { provider: args.provider, model: args.model, thinkingLevel: "low" },
    null,
    2,
  ),
  { mode: 0o600 },
);
const started = Date.now();
const report = {
  ok: false,
  contentSource: replay
    ? "previously-published-real-pi-model"
    : "real-pi-model",
  provider: args.provider,
  model: args.model,
  maxAttempts: budget,
  world,
  project,
  timeline: [],
};
let game;
let resumeHost;
let poll;
try {
  game = await startPlayer(world, {
    headless: Boolean(args.headless),
    smokeTest: true,
    quiet: true,
    screenshot: join(artifacts, `${prefix}.png`),
    host: { generation: { maxNewChunks: budget } },
  });
  const observed = new Map();
  poll = setInterval(() => {
    const store = new ContentStore(world);
    try {
      for (const job of store.listJobs("roguelite2d")) {
        if (observed.get(job.id) === job.status) continue;
        observed.set(job.id, job.status);
        const entry = {
          key: job.key,
          status: job.status,
          elapsedMs: Date.now() - started,
        };
        report.timeline.push(entry);
        console.log(JSON.stringify(entry));
      }
    } finally {
      store.close();
    }
  }, 1000);
  const timer = setTimeout(() => void game.stop(), 280000);
  const code = await game.completion;
  clearTimeout(timer);
  clearInterval(poll);
  const output = await readFile(game.logPath, "utf8");
  await writeFile(join(artifacts, `${prefix}-godot.log`), output);
  const line = output
    .split("\n")
    .find((s) => s.startsWith("OPENFUN_ROGUELITE_SMOKE "));
  report.first = line
    ? JSON.parse(line.slice("OPENFUN_ROGUELITE_SMOKE ".length))
    : { ok: false, error: output.slice(-6000) };
  const store = new ContentStore(world);
  let saved;
  try {
    report.jobs = store.listJobs("roguelite2d");
    saved = store.getState("roguelite2d");
  } finally {
    store.close();
  }
  report.attemptsUsed = report.jobs.reduce((sum, job) => sum + job.attempt, 0);
  report.newAttempts = report.attemptsUsed - attemptsBefore;
  report.liveElapsedMs = Date.now() - started;
  assert.ok(report.newAttempts <= budget);
  assert.equal(code, 0, JSON.stringify(report.first));
  assert.equal(report.first.ok, true);
  for (const key of ["level:1:v1", "skills:1:v1", "level:2:v1"])
    assert.ok(
      report.jobs.some((job) => job.key === key && job.status === "ready"),
      `${key} must be a real published model result`,
    );
  assert.equal(saved.state.level, 2);
  // Restart without any remaining model budget and compare the saved combat state.
  resumeHost = await startHost(world, { generation: { maxNewChunks: 0 } });
  const godot = resolveTool("godot");
  assert.ok(godot);
  const child = spawn(
    godot,
    [
      "--headless",
      "--path",
      project,
      "--",
      `--host=${resumeHost.url}`,
      `--token=${resumeHost.token}`,
      "--smoke-resume",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let resumeOutput = "";
  child.stdout.on("data", (chunk) => {
    resumeOutput += chunk;
  });
  child.stderr.on("data", (chunk) => {
    resumeOutput += chunk;
  });
  const resumeTimer = setTimeout(() => child.kill("SIGTERM"), 20000);
  const resumeCode = await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("close", done);
  });
  clearTimeout(resumeTimer);
  await writeFile(join(artifacts, `${prefix}-resume.log`), resumeOutput);
  assert.equal(resumeCode, 0, resumeOutput.slice(-5000));
  const resumeLine = resumeOutput
    .split("\n")
    .find((s) => s.startsWith("OPENFUN_ROGUELITE_SMOKE "));
  report.second = JSON.parse(
    resumeLine.slice("OPENFUN_ROGUELITE_SMOKE ".length),
  );
  assert.equal(report.second.ok, true);
  assert.deepEqual(report.second.enemies, saved.state.enemies);
  assert.deepEqual(report.second.stats, saved.state.player.stats);
  assert.deepEqual(report.second.skills, saved.state.selectedSkills);
  assert.deepEqual(report.second.playerPosition, saved.state.player.position);
  assert.equal(report.second.hp, saved.state.player.hp);
  report.zeroBudgetRestore = true;
  report.ok = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  clearInterval(poll);
  if (game) await game.stop();
  if (resumeHost) await resumeHost.close();
  report.totalElapsedMs = Date.now() - started;
  await writeFile(
    join(artifacts, `${prefix}-report.json`),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        attemptsUsed: report.attemptsUsed,
        newAttempts: report.newAttempts,
        elapsedMs: report.totalElapsedMs,
        error: report.error,
        report: join(artifacts, `${prefix}-report.json`),
      },
      null,
      2,
    ),
  );
}
