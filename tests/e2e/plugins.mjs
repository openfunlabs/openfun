// Exercise the selected OpenFun CLI with an empty home, no global pi on PATH,
// native RPC initialization and extension commands. No model requests.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

assert.ok(process.argv[2], "Pass the OpenFun dist/cli.js to test");
const cli = resolve(process.argv[2]);
const root = await mkdtemp(join(tmpdir(), "openfun-clean-install-"));
const cwd = join(root, "world");
await mkdir(cwd);
const probe = join(root, "probe.ts");
await writeFile(
  probe,
  `export default function(pi) {
  pi.registerCommand("bundled-probe", {
    description: "No-model installation probe",
    handler: async (_args, ctx) => pi.sendMessage({customType:"bundled-probe", content:JSON.stringify({tools:pi.getAllTools().map(t=>t.name),active:pi.getActiveTools(),assetProviders:["meshy","tripo"].map(id=>({id,login:!!ctx.modelRegistry.getProvider(id)?.auth.apiKey?.login,models:ctx.modelRegistry.getProvider(id)?.getModels().length}))}), display:false}, {triggerTurn:false})
  });
}`,
);
// Poison standalone pi's global and project configuration. None may be loaded.
const piHome = join(root, ".pi", "agent");
const piProject = join(cwd, ".pi");
await mkdir(piHome, { recursive: true });
await mkdir(piProject, { recursive: true });
const trap = join(root, "standalone-pi-loaded");
const trapExtension = join(root, "standalone-pi.ts");
await writeFile(
  trapExtension,
  `import {writeFileSync} from "node:fs"; writeFileSync(${JSON.stringify(trap)}, "unexpected"); export default function() {}`,
);
const poisoned = JSON.stringify({
  extensions: [trapExtension],
  defaultProvider: "standalone-pi",
  defaultModel: "never-load",
});
await writeFile(join(piHome, "settings.json"), poisoned);
await writeFile(
  join(piHome, "auth.json"),
  JSON.stringify({
    "openai-codex": {
      type: "api_key",
      key: "standalone-pi-credential-must-not-load",
    },
  }),
);
await writeFile(join(piProject, "settings.json"), poisoned);
await mkdir(join(cwd, ".openfun"), { recursive: true });
await writeFile(
  join(cwd, ".openfun", "settings.json"),
  JSON.stringify({ extensions: [probe] }),
);
const report = {
  passed: false,
  cli,
  modelRequests: 0,
  emptyHome: true,
  globalPiOnPath: false,
};
const child = spawn(
  process.execPath,
  [cli, "--", "--offline", "--mode", "rpc", "--approve"],
  {
    cwd,
    env: {
      HOME: root,
      PATH:
        process.platform === "win32"
          ? (process.env.SystemRoot ?? "C:\\Windows") + "\\System32"
          : "/usr/bin:/bin",
      OPENFUN_HOME: join(root, "openfun"),
      PI_OFFLINE: "1",
      PI_CODING_AGENT_DIR: piHome,
      PI_PACKAGE_DIR: join(root, "nonexistent-external-pi"),
      PI_CODING_AGENT_SESSION_DIR: join(piHome, "sessions"),
      OPENFUN_AGENT_DIR: piHome,
      CONTEXT_MODE_DATA_DIR: join(root, ".pi"),
      PI_TELEMETRY: "0",
      TERM: "xterm-256color",
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    },
    stdio: ["pipe", "pipe", "pipe"],
  },
);
let buffer = "",
  stderr = "",
  counter = 0;
const pending = new Map();
const closed = new Promise((done) =>
  child.once("close", (code, signal) => done({ code, signal })),
);
child.stderr.on("data", (part) => {
  stderr = (stderr + part).slice(-12000);
});
child.stdout.on("data", (part) => {
  buffer += part;
  for (;;) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) break;
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    try {
      const event = JSON.parse(line);
      if (event.type === "response" && pending.has(event.id)) {
        pending.get(event.id)(event);
        pending.delete(event.id);
      }
    } catch {
      /* The launcher can print its world path before RPC starts. */
    }
  }
});
function rpc(type, extra = {}) {
  return new Promise((resolveResult, reject) => {
    const id = String(++counter);
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`RPC ${type} timed out: ${stderr}`));
    }, 30000);
    pending.set(id, (event) => {
      clearTimeout(timeout);
      if (event.success) resolveResult(event.data);
      else reject(new Error(JSON.stringify(event)));
    });
    child.stdin.write(JSON.stringify({ id, type, ...extra }) + "\n");
  });
}
try {
  const commands = (await rpc("get_commands")).commands.map(
    (command) => command.name,
  );
  for (const name of [
    "world",
    "play",
    "mcp",
    "ctx-stats",
    "ctx-doctor",
    "bundled-probe",
  ])
    assert.ok(commands.includes(name), `Missing /${name}`);
  for (const removed of ["worlds", "new-world"])
    assert.ok(
      !commands.includes(removed),
      `Removed /${removed} is still registered`,
    );
  report.commands = commands.filter((name) =>
    ["world", "play", "polish", "mcp", "ctx-stats", "ctx-doctor"].includes(
      name,
    ),
  );
  await rpc("prompt", { message: "/bundled-probe" });
  const messages = (await rpc("get_messages")).messages;
  const record = messages.find(
    (message) => message.customType === "bundled-probe",
  );
  assert.ok(record, "Native extension probe returned tool inventory");
  const names = JSON.parse(record.content).tools;
  for (const name of [
    "read",
    "write",
    "world_inspect",
    "mcp",
    "questionnaire",
    "world_generate_image",
    "world_generate_model",
    "world_offer_polish",
    "world_process_model",
    "world_animation_library",
    "world_model_status",
    "world_search_design_references",
    "world_read_design_reference",
    "world_search_assets",
    "world_asset_info",
    "world_download_asset",
    "world_design_guide",
  ])
    assert.ok(names.includes(name), `Missing ${name}`);
  report.tools = names;
  report.assetProviders = JSON.parse(record.content).assetProviders;
  assert.deepEqual(report.assetProviders, [
    { id: "meshy", login: true, models: 0 },
    { id: "tripo", login: true, models: 0 },
  ]);
  assert.ok(!commands.includes("plan"));
  assert.ok(
    commands.includes("polish"),
    "Optional polish command is registered",
  );
  await rpc("prompt", { message: "/polish status" });
  const polishMessages = (await rpc("get_messages")).messages;
  assert.ok(
    polishMessages.some(
      (message) =>
        message.customType === "openfun-polish-status" &&
        String(message.content).includes("No polish run"),
    ),
    "Opening/status must not start a polish worker",
  );
  await rpc("prompt", { message: "/ctx-stats" });
  const finished = (await rpc("get_messages")).messages;
  const state = await rpc("get_state");
  assert.equal(state.isStreaming, false);
  assert.ok(
    !finished.some((message) => message.role === "assistant"),
    "No model-generated messages",
  );
  assert.equal(
    await access(trap).then(
      () => true,
      () => false,
    ),
    false,
    "Standalone pi extensions never execute",
  );
  assert.equal(await readFile(join(piHome, "settings.json"), "utf8"), poisoned);
  assert.equal(
    await access(join(root, ".pi", "context-mode")).then(
      () => true,
      () => false,
    ),
    false,
    "Context Mode does not write to standalone pi",
  );
  const ownSettings = JSON.parse(
    await readFile(
      join(root, "openfun", "agent", "settings.json"),
      "utf8",
    ).catch(() => "{}"),
  );
  assert.notEqual(ownSettings.defaultProvider, "standalone-pi");
  report.standalonePiIgnored = true;
  report.openfunProjectExtensionLoaded = true;
  report.contextCommands = true;
  report.profile = "OpenFun-owned empty profile";
  assert.doesNotMatch(stderr, /SQLite is an experimental feature/);
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.stderr = stderr;
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
  let killTimer;
  const exit = await Promise.race([
    closed,
    new Promise((done) => {
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
        done({ forced: true });
      }, 5000);
    }),
  ]);
  clearTimeout(killTimer);
  report.exit = exit;
  await mkdir(resolve(".output"), { recursive: true });
  await writeFile(
    resolve(".output/bundled-plugins-smoke.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report, null, 2));
}
