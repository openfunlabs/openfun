/** Product calibration through the installed CLI. Never imports a sample game. */
import { spawn, execFileSync } from "node:child_process";
import {
  mkdir,
  writeFile,
  readFile,
  cp,
  realpath,
  readdir,
  mkdtemp,
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join, dirname } from "node:path";
import { cpus, totalmem, release, tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { finished } from "node:stream/promises";

const { values } = parseArgs({
  options: {
    cli: { type: "string" },
    case: { type: "string" },
    purpose: { type: "string", default: "calibration" },
    brief: { type: "string" },
    model: { type: "string" },
    provider: { type: "string", default: "openai-codex" },
    thinking: { type: "string", default: "high" },
  },
});
if (!values.cli || !values.case || !values.model)
  throw new Error(
    "Supply --cli <installed cli.js> --case A|B|C|D|E --model <id>; uses real model/service quota.",
  );
if (
  !["calibration", "baseline", "candidate", "holdout", "polish"].includes(
    values.purpose,
  )
)
  throw new Error("Invalid evaluation purpose.");
if (!/^[A-Za-z0-9_-]{1,40}$/.test(values.case))
  throw new Error("Invalid case ID.");
const prompts = {
  A: "做一个 2D 俯视角动作探索游戏：我提着灯探索逐渐苏醒的森林遗迹，希望战斗有手感，越往深处走越有意思。直接做出完整第一版，细节你决定。",
  B: "做一个 3D 海岛探索游戏，我是夜间送信的邮差，逐渐发现一位失踪守塔人的故事。海岛要有吸引力，航行到远处还能发现新的地方。直接做好第一版，细节你决定。",
  C: "做一个 2D 光线解谜游戏，规则容易理解，但后面的谜题能让我重新思考前面学会的东西。直接做出第一版，不要战斗。",
  D: "做一个小镇调查游戏，我通过对话、线索和选择，发现居民之间隐瞒的往事，希望之后还能发生新的事件。直接做出第一版。",
  E: "做一个温暖的海边小店经营游戏，收集材料、制作商品、认识客人，希望经营越久越有新的取舍，而不是只等数字变大。直接做出第一版。",
};
const prompt = values.brief
  ? (await readFile(resolve(values.brief), "utf8")).trim()
  : prompts[values.case];
if (!prompt || prompt.length > 16000)
  throw new Error(
    "Provide a known case or a non-empty --brief file (max 16000 characters). The brief must be an ordinary user request, not a rubric.",
  );
const cli = await realpath(resolve(values.cli));
const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${values.case}`;
const output = resolve(".output/evaluations", runId),
  world = await mkdtemp(join(tmpdir(), `openfun-evaluation-${values.case}-`));
await mkdir(output, { recursive: true });
const packageRoot = dirname(dirname(cli));
const packageHash = createHash("sha256");
async function hashTree(path, label) {
  for (const entry of (await readdir(path, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    if (entry.isDirectory())
      await hashTree(join(path, entry.name), `${label}/${entry.name}`);
    else if (entry.isFile())
      packageHash
        .update(`${label}/${entry.name}\0`)
        .update(await readFile(join(path, entry.name)));
  }
}
packageHash.update(await readFile(join(packageRoot, "package.json")));
for (const part of ["dist", "tools", "docs"])
  await hashTree(join(packageRoot, part), part);
const registration = {
  runId,
  world,
  specification: "evaluation-v1.2",
  purpose: values.purpose,
  case: values.case,
  prompt,
  cli,
  productFilesDigest: packageHash.digest("hex"),
  hardware: {
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    memoryBytes: totalmem(),
    osRelease: release(),
  },
  cliDigest: createHash("sha256")
    .update(await readFile(cli))
    .digest("hex"),
  productVersion: execFileSync(process.execPath, [cli, "--version"], {
    encoding: "utf8",
  }).trim(),
  provider: values.provider,
  model: values.model,
  thinking: values.thinking,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  evaluationTarget: {
    resolution: "1280x800",
    fps: 60,
    note: "Independent play target; not injected into the author prompt. Capture overhead is recorded separately.",
  },
  projectCache: "empty project",
  globalCache: "existing OpenFun caches preserved",
  transport:
    "normal CLI startup forwarding native print/JSON options; terminal rendering separately tested",
  authorInterventions: [],
  scores: "NV until independent play/review",
  start: new Date().toISOString(),
};
await writeFile(
  join(output, "registration.json"),
  JSON.stringify(registration, null, 2),
);
const log = createWriteStream(join(output, "events.jsonl"), { mode: 0o600 });
const errorLog = createWriteStream(join(output, "stderr.log"), { mode: 0o600 });
function sanitize(value, key = "") {
  if (/^(?:thinkingSignature|encrypted_content)$/i.test(key))
    return "[provider opaque data omitted]";
  if (
    /^(?:authorization|apiKey|token|access_token|refresh_token|headers)$/i.test(
      key,
    )
  )
    return "[redacted]";
  if (key === "data" && typeof value === "string" && value.length > 4096)
    return `[binary omitted: ${value.length} chars]`;
  if (typeof value === "string")
    return value
      .replace(
        /Bearer\s+[^\s"\\]+|sk-[\w-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+/gi,
        "[redacted]",
      )
      .replace(/([?&]|--)(token=)[^\s"\\&]+/gi, "$1$2[redacted]");
  if (Array.isArray(value)) return value.map((v) => sanitize(v));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, sanitize(v, k)]),
    );
  return value;
}
const child = spawn(
  process.execPath,
  [
    cli,
    "--",
    "--provider",
    values.provider,
    "--model",
    values.model,
    "--thinking",
    values.thinking,
    "-p",
    "--mode",
    "json",
    prompt,
  ],
  {
    cwd: world,
    env: {
      ...process.env,
      PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  },
);
let pending = "",
  events = 0,
  toolCalls = 0,
  lastAssistant = "",
  interrupted = false;
const stop = () => {
  interrupted = true;
  try {
    process.kill(
      process.platform === "win32" ? child.pid : -child.pid,
      "SIGTERM",
    );
  } catch {}
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
child.stdout.on("data", (chunk) => {
  pending += chunk.toString();
  let end;
  while ((end = pending.indexOf("\n")) >= 0) {
    const line = pending.slice(0, end);
    pending = pending.slice(end + 1);
    try {
      const e = JSON.parse(line);
      log.write(
        JSON.stringify({
          observedAt: new Date().toISOString(),
          ...sanitize(e),
        }) + "\n",
      );
      events++;
      if (e.type === "tool_execution_start") {
        toolCalls++;
        console.log(JSON.stringify({ runId, tool: e.toolName, toolCalls }));
      }
      if (e.type === "message_end" && e.message?.role === "assistant")
        lastAssistant = (e.message.content ?? [])
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n");
    } catch {
      log.write(
        JSON.stringify({ type: "non-json-output", text: sanitize(line) }) +
          "\n",
      );
    }
  }
});
child.stderr.on("data", (chunk) => errorLog.write(sanitize(chunk.toString())));
const outcome = await new Promise((done, reject) => {
  child.once("error", reject);
  child.once("close", (code, signal) => done({ code, signal }));
});
log.end();
errorLog.end();
await Promise.all([finished(log), finished(errorLog)]);
await writeFile(join(output, "author-final.md"), sanitize(lastAssistant));
// The author's credential/configuration directories are deliberately excluded.
for (const name of ["game", "design", "WORLD.md", "world.sqlite"]) {
  try {
    await cp(
      join(world, name),
      join(
        output,
        interrupted || outcome.code !== 0
          ? "interrupted-checkpoint"
          : "first-delivery",
        name,
      ),
      {
        recursive: true,
        filter: (p) =>
          !p
            .split(/[\\/]/)
            .some((part) => [".godot", ".openfun", "auth.json"].includes(part)),
      },
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
const { exportRuntimeData } = await import(
  pathToFileURL(join(packageRoot, "dist/generation/content-store.js")).href
);
await writeFile(
  join(output, "runtime-evidence.json"),
  JSON.stringify(sanitize(exportRuntimeData(world)), null, 2),
);
await writeFile(
  join(output, "outcome.json"),
  JSON.stringify(
    {
      ...outcome,
      interrupted,
      finishedAt: new Date().toISOString(),
      events,
      toolCalls,
      authorEndedNormally: outcome.code === 0 && !interrupted,
      qualityAccepted: false,
      review: "Independent gameplay and scoring still required",
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    ...outcome,
    events,
    toolCalls,
    qualityAccepted: false,
  }),
);
if (outcome.code !== 0) process.exitCode = 1;
