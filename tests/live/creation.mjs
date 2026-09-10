// Explicit live creator acceptance; bounded and isolated, never part of unit tests.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { buildAgentArgs } from "../../src/agent/session.ts";
import { WorldStore } from "../../src/world/world.ts";
import {
  ensureGameProject,
  checkGameProject,
} from "../../src/godot/project.ts";

const [provider, model] = process.argv.slice(2);
if (!provider || !model)
  throw new Error(
    "Explicit provider and model required; this test makes live model requests.",
  );
const world = await mkdtemp(join(tmpdir(), "openfun-creation-live-"));
WorldStore.create(world, { name: "短需求创作验收" }).close();
await ensureGameProject(world);
await mkdir(join(world, ".openfun"), { recursive: true });
await writeFile(
  join(world, ".openfun/settings.json"),
  JSON.stringify({
    transport: "sse",
    httpIdleTimeoutMs: 90000,
    retry: { enabled: false, provider: { maxRetries: 0 } },
  }),
);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function sources() {
  const result = {};
  for (const name of await readdir(join(world, "game")))
    if (/\.(?:gd|tscn|tres|godot)$/.test(name))
      result[name] = digest(await readFile(join(world, "game", name)));
  return result;
}
async function documents() {
  const found = {};
  async function visit(directory, prefix) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const name = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await visit(join(directory, entry.name), name);
      else if (entry.isFile() && entry.name.endsWith(".md"))
        found[name] = digest(await readFile(join(directory, entry.name)));
    }
  }
  found["WORLD.md"] = digest(await readFile(join(world, "WORLD.md")));
  await visit(join(world, "design"), "design");
  return found;
}
const before = await sources();
const beforeDocuments = await documents();
const prompt =
  "把这个海岛邮局做成《夜航邮差》：温暖的夜海，有一个令人好奇的失踪守塔人故事，灯光和信件界面精致一点。直接做出连贯的第一版，其他你决定，保留游玩中的 AI 岛屿生成。\n本轮验收范围：只编辑此世界，不安装依赖、不读取认证、不新生成图片（可复用现有素材），不发送额外游戏内容模型请求；如要预览使用显式 demo。";
const args = buildAgentArgs(world, {
  piArgs: [
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--provider",
    provider,
    "--model",
    model,
    "--thinking",
    "low",
    "-p",
    "--mode",
    "json",
  ],
  prompt,
});
const events = [],
  tools = [],
  summaries = [];
let turns = 0,
  reason,
  bytes = 0,
  pending = "",
  stderr = "";
const start = Date.now();
const outcome = await new Promise((done, reject) => {
  const child = spawn(process.execPath, args, {
    cwd: world,
    env: {
      ...process.env,
      OPENFUN_WORLD_DIR: world,
      OPENFUN_HOME: join(world, ".openfun/test-home"),
      PATH: `${dirname(process.execPath)}:${process.env.PATH || ""}`,
    },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let force;
  const stop = (why) => {
    if (reason) return;
    reason = why;
    const kill = (signal) => {
      try {
        if (process.platform !== "win32") process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {}
    };
    kill("SIGTERM");
    force = setTimeout(() => kill("SIGKILL"), 2000);
  };
  const timer = setTimeout(() => stop("8 minute limit"), 480000);
  child.stdout.on("data", (data) => {
    bytes += data.length;
    if (bytes > 24 * 1024 * 1024) {
      stop("24 MiB output limit");
      return;
    }
    pending += data;
    let end;
    while ((end = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === "turn_end" && ++turns > 24) stop("24 turn limit");
      if (event.type === "tool_execution_start") {
        tools.push(event.toolName);
        console.log(
          JSON.stringify({
            tool: event.toolName,
            elapsedSeconds: Math.round((Date.now() - start) / 1000),
          }),
        );
      }
      if (event.type === "tool_execution_end")
        events.push({
          name: event.toolName,
          isError: event.isError,
          resultTypes: event.result?.content?.map((item) => item.type),
        });
      if (event.type === "message_end" && event.message?.role === "assistant")
        for (const content of event.message.content || [])
          if (content.type === "text") summaries.push(content.text);
    }
  });
  child.stderr.on("data", (data) => {
    stderr = (stderr + data.toString()).slice(-8192);
  });
  child.once("error", reject);
  child.once("close", (code, signal) => {
    clearTimeout(timer);
    clearTimeout(force);
    done({ code, signal, reason });
  });
});
const after = await sources();
const afterDocuments = await documents();
const changedDocuments = Object.keys(afterDocuments).filter(
  (name) => afterDocuments[name] !== beforeDocuments[name],
);
let checked;
try {
  checked = await checkGameProject(world);
} catch (error) {
  checked = { error: error.message };
}
const changed = Object.keys(after).filter(
  (name) => after[name] !== before[name],
);
const report = {
  world,
  provider,
  model,
  elapsedSeconds: Math.round((Date.now() - start) / 1000),
  outcome,
  turns,
  tools,
  events,
  changed,
  changedDocuments,
  check: checked,
  final: summaries.at(-1),
  stderr,
  passed: false,
};
report.passed =
  outcome.code === 0 &&
  !reason &&
  changed.length > 0 &&
  changedDocuments.length > 0 &&
  !checked.error &&
  events.some((event) => event.name === "world_check_game" && !event.isError) &&
  events.some(
    (event) =>
      event.name === "world_preview_game" &&
      !event.isError &&
      event.resultTypes?.includes("image"),
  );
await mkdir(resolve(".output"), { recursive: true });
await writeFile(
  resolve(".output/creation-live-report.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    { ...report, events: undefined, final: undefined, stderr: undefined },
    null,
    2,
  ),
);
assert.ok(
  report.passed,
  "Creator must change playable source and ordinary design notes, validate, and inspect a real preview. No special brief schema or evidence registry is required; this smoke is not a universal artistic-quality score.",
);
