import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  initTheme,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  agentDirectory,
  bundledPlugins,
  piRuntimePaths,
  creatorEnvironment,
  prepareCreatorSettings,
} from "../../src/agent/pi-environment.js";
import { buildAgentArgs } from "../../src/agent/session.js";
import { WorldStore } from "../../src/world/world.js";

function isolated(t: TestContext, shutdown?: () => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "openfun-bundled-"));
  const keys = [
    "HOME",
    "OPENFUN_HOME",
    "OPENFUN_AGENT_DIR",
    "PI_CODING_AGENT_DIR",
    "OPENFUN_WORLD_DIR",
  ];
  const previous = keys.map((key) => process.env[key]);
  process.env.HOME = root;
  process.env.OPENFUN_HOME = join(root, "openfun");
  delete process.env.OPENFUN_AGENT_DIR;
  delete process.env.PI_CODING_AGENT_DIR;
  t.after(async () => {
    await shutdown?.();
    keys.forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    });
    // Native plugin children can finish a final cache write during shutdown.
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  });
  return root;
}

test("new users have an OpenFun profile; standalone pi profiles and legacy environment overrides are ignored", (t) => {
  const root = isolated(t);
  const own = join(root, "openfun", "agent");
  assert.equal(agentDirectory(), own);
  assert.deepEqual(piRuntimePaths(), {
    authPath: join(own, "auth.json"),
    modelsPath: join(own, "models.json"),
  });
  const legacy = join(root, ".pi", "agent");
  mkdirSync(legacy, { recursive: true });
  const original = '{"theme":"existing-theme"}\n';
  writeFileSync(join(legacy, "settings.json"), original);
  assert.equal(agentDirectory(), own);
  mkdirSync(own, { recursive: true });
  assert.equal(agentDirectory(), own);
  process.env.PI_CODING_AGENT_DIR = join(root, "explicit-pi");
  assert.equal(agentDirectory(), own);
  process.env.OPENFUN_AGENT_DIR = join(root, "explicit-openfun");
  assert.equal(agentDirectory(), own);
  const env = creatorEnvironment(join(root, "world"));
  assert.equal(env.PI_CODING_AGENT_DIR, undefined);
  assert.equal(env.OPENFUN_AGENT_DIR, undefined);
  assert.equal(env.OPENFUN_CODING_AGENT_DIR, own);
  assert.equal(env.CONTEXT_MODE_DATA_DIR, join(root, "openfun", "cache"));
  assert.deepEqual(
    JSON.parse(readFileSync(join(env.PI_PACKAGE_DIR!, "package.json"), "utf8"))
      .piConfig,
    { name: "OpenFun", configDir: ".openfun" },
  );
  assert.equal(readFileSync(join(legacy, "settings.json"), "utf8"), original);
  for (const name of ["README.md", "README.zh-CN.md"]) {
    const readme = readFileSync(join(env.PI_PACKAGE_DIR!, name), "utf8");
    assert.ok(
      readme.includes(
        "](https://raw.githubusercontent.com/openfunlabs/openfun/main/docs/diagrams/architecture.svg)",
      ),
    );
    assert.ok(
      readme.includes(
        "](https://github.com/openfunlabs/openfun/blob/main/LICENSE)",
      ),
    );
    const other = name === "README.md" ? "README.zh-CN.md" : "README.md";
    assert.ok(readme.includes("](#roadmap)"));
    assert.ok(
      readme.includes(
        "](https://github.com/openfunlabs/openfun/blob/main/docs/diagrams/architecture.excalidraw)",
      ),
    );
    assert.ok(readme.includes(`](${other})`));
    assert.ok(existsSync(join(env.PI_PACKAGE_DIR!, other)));
  }
});

test("bundled plugins resolve local dependencies, support disabling, and defer to existing native installations", (t) => {
  const root = isolated(t);
  assert.deepEqual(
    bundledPlugins().map((p) => [p.name, p.enabled, p.overridden]),
    [
      ["mcp", true, false],
      ["context", true, false],
      ["questions", true, false],
      ["images", true, false],
      ["assets3d", true, false],
    ],
  );
  for (const plugin of bundledPlugins()) assert.ok(existsSync(plugin.path));
  const mcp = bundledPlugins().find((p) => p.name === "mcp")!;
  assert.ok(mcp.path.startsWith(join(root, "openfun", "runtime")));
  for (const name of [
    "mcp-auth.ts",
    "mcp-bearer-store.ts",
    "dist/mcp-bearer-store.js",
  ]) {
    const source = readFileSync(join(dirname(mcp.path), name), "utf8");
    assert.match(source, /openfun\.[a-f0-9]+\.mcp\.(oauth|bearer)/);
    assert.doesNotMatch(source, /pi-mcp-adapter\.(oauth|bearer)/);
  }

  const dir = agentDirectory();
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "settings.json"),
    JSON.stringify({
      packages: ["npm:pi-mcp-adapter@2.32.1"],
      extensions: ["/my/context-mode/build/adapters/pi/extension.js"],
    }),
  );
  assert.equal(
    bundledPlugins().find((p) => p.name === "mcp")?.overridden,
    true,
  );
  assert.equal(
    bundledPlugins().find((p) => p.name === "context")?.overridden,
    true,
  );
  assert.equal(
    bundledPlugins([
      "--extension",
      "npm:@juicesharp/rpiv-ask-user-question",
    ]).find((p) => p.name === "questions")?.overridden,
    true,
  );
  writeFileSync(
    join(root, "openfun", "plugins.json"),
    JSON.stringify({
      questions: false,
      images: false,
      assets3d: false,
      plan: true,
    }),
  );
  assert.equal(
    bundledPlugins().find((p) => p.name === "questions")?.enabled,
    false,
  );
  const args = buildAgentArgs(join(root, "world"));
  assert.equal(args.filter((arg) => arg === "--extension").length, 1);
  writeFileSync(join(root, "openfun", "plugins.json"), '{"mcp":"false"}');
  assert.throws(() => bundledPlugins(), /non-boolean/);
});

test("fresh native session loads shipped MCP/context/questions and executes and searches through the native context bridge", async (t) => {
  let shutdown: (() => Promise<void>) | undefined;
  const root = isolated(t, async () => shutdown?.());
  const cwd = join(root, "world");
  const dir = agentDirectory();
  mkdirSync(dir, { recursive: true });
  // The creator process passes this same profile to native pi and its plugins.
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.OPENFUN_WORLD_DIR = cwd;
  WorldStore.create(cwd, { name: "Bundled plugin world" }).close();
  writeFileSync(
    join(cwd, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        fixture: {
          command: process.execPath,
          args: [
            fileURLToPath(
              new URL("../fixtures/mcp-server.mjs", import.meta.url),
            ),
          ],
        },
      },
    }),
  );
  const args = buildAgentArgs(cwd);
  const paths = args.flatMap((arg, i) =>
    arg === "--extension" ? [args[i + 1]!] : [],
  );
  const settings = SettingsManager.inMemory(
    { packages: [], compaction: { enabled: false }, retry: { enabled: false } },
    { projectTrusted: true },
  );
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: dir,
    settingsManager: settings,
    additionalExtensionPaths: paths,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const runtime = await ModelRuntime.create({
    ...piRuntimePaths(),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const { session } = await createAgentSession({
    cwd,
    agentDir: dir,
    modelRuntime: runtime,
    model: runtime.getModels("openai-codex")[0],
    resourceLoader: loader,
    settingsManager: settings,
    sessionManager: SessionManager.inMemory(cwd),
  });
  shutdown = async () => {
    await session.extensionRunner.emit({
      type: "session_shutdown",
      reason: "quit",
    });
    session.dispose();
  };
  initTheme("dark", false);
  await session.bindExtensions({ mode: "print" });
  const runner = session.extensionRunner;
  const names = session.getActiveToolNames();
  for (const name of [
    "read",
    "write",
    "world_inspect",
    "world_check_game",
    "questionnaire",
    "mcp",
    "world_generate_image",
    "world_generate_model",
    "world_offer_polish",
    "world_process_model",
    "world_animation_library",
    "world_model_status",
  ])
    assert.ok(names.includes(name), `${name} is available`);
  assert.ok(runner.getCommand("mcp"));
  assert.ok(runner.getCommand("polish"));
  assert.equal(runner.getCommand("plan"), undefined);
  assert.ok(runner.getCommand("ctx-stats"));
  assert.ok(runner.getCommand("ctx-doctor"));
  assert.deepEqual(runner.getCommandDiagnostics(), []);
  const questionnaire = session.agent.state.tools.find(
    (tool) => tool.name === "questionnaire",
  )!;
  const headlessQuestion = await questionnaire.execute("no-ui", {
    questions: [
      {
        id: "style",
        prompt: "Choose a style",
        options: [{ value: "lowpoly", label: "Low poly" }],
      },
    ],
  });
  assert.match(JSON.stringify(headlessQuestion), /UI not available/);
  const mcp = session.agent.state.tools.find((tool) => tool.name === "mcp")!;
  const connected = await mcp.execute("connect-fixture", {
    connect: "fixture",
  });
  assert.doesNotMatch(JSON.stringify(connected), /init_failed|not_initialized/);
  const output = await mcp.execute("call-fixture", {
    tool: "fixture_echo",
    args: { message: "hello from a clean install" },
  });
  assert.match(
    JSON.stringify(output),
    /OpenFun MCP: hello from a clean install/,
  );
  await runner.emitBeforeAgentStart(
    "Check a local fixture",
    undefined,
    "OpenFun test",
    { cwd },
  );
  const contextTools = session.agent.state.tools;
  const execute = contextTools.find((tool) => tool.name === "ctx_execute");
  assert.ok(
    execute,
    "native context bridge bootstrapped without a model request",
  );
  const result = await execute.execute("context-execute", {
    language: "javascript",
    code: "console.log('OPENFUN_CONTEXT_OK')",
  });
  assert.match(JSON.stringify(result), /OPENFUN_CONTEXT_OK/);
  const index = contextTools.find((tool) => tool.name === "ctx_index");
  const search = contextTools.find((tool) => tool.name === "ctx_search");
  assert.ok(index && search);
  await index.execute("context-index", {
    content: "The lighthouse keeper's secret signal is copper-heron-784.",
    source: "OpenFun fixture",
  });
  const found = await search.execute("context-search", {
    queries: ["copper-heron-784"],
    limit: 1,
  });
  assert.match(JSON.stringify(found), /copper-heron-784/);
});

test("OpenFun quiet startup defaults preserve explicit settings and never load native project settings", async (t) => {
  const root = isolated(t);
  const own = agentDirectory();
  mkdirSync(own, { recursive: true });
  const settings = join(own, "settings.json");
  const native = join(process.env.OPENFUN_HOME!, ".pi");
  mkdirSync(native);
  writeFileSync(join(native, "settings.json"), "not json: must never read");
  writeFileSync(
    settings,
    JSON.stringify({ defaultModel: "chosen-model", custom: { keep: true } }),
  );
  await prepareCreatorSettings();
  assert.deepEqual(JSON.parse(readFileSync(settings, "utf8")), {
    defaultModel: "chosen-model",
    custom: { keep: true },
    quietStartup: true,
  });
  writeFileSync(
    settings,
    JSON.stringify({ quietStartup: false, theme: "light" }),
  );
  await prepareCreatorSettings();
  assert.deepEqual(JSON.parse(readFileSync(settings, "utf8")), {
    quietStartup: false,
    theme: "light",
  });
  writeFileSync(settings, "broken original");
  await assert.rejects(prepareCreatorSettings(), /could not be read/);
  assert.equal(readFileSync(settings, "utf8"), "broken original");
  assert.equal(existsSync(join(root, ".pi")), false);
});
