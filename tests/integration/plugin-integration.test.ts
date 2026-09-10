import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { WorldStore } from "../../src/world/world.js";

test("native pi package tools coexist with OpenFun without an OpenFun image adapter", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "openfun-native-plugin-"));
  const cwd = join(root, "world");
  const agentDir = join(root, "agent");
  const pluginDir = join(root, "test-package");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(pluginDir, { recursive: true });
  WorldStore.create(cwd, { name: "Native plugin integration" }).close();
  const previousWorld = process.env.OPENFUN_WORLD_DIR;
  const previousLibrary = process.env.OPENFUN_HOME;
  process.env.OPENFUN_WORLD_DIR = cwd;
  process.env.OPENFUN_HOME = join(root, "library");
  t.after(() => {
    if (previousWorld === undefined) delete process.env.OPENFUN_WORLD_DIR;
    else process.env.OPENFUN_WORLD_DIR = previousWorld;
    if (previousLibrary === undefined) delete process.env.OPENFUN_HOME;
    else process.env.OPENFUN_HOME = previousLibrary;
    rmSync(root, { recursive: true, force: true });
  });
  writeFileSync(
    join(pluginDir, "package.json"),
    JSON.stringify({
      name: "openfun-test-image-extension",
      version: "1.0.0",
      pi: { extensions: ["./image.ts"] },
    }),
  );
  // This fixture tests pi's package loading and tool context only. It neither
  // implements an image provider nor claims a generated image was returned.
  writeFileSync(
    join(pluginDir, "image.ts"),
    `export default function(pi) {
      pi.registerTool({
        name: "fixture_native_image", label: "Fixture native image",
        description: "No-network integration fixture",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        async execute(_id, _params, _signal, _update, ctx) {
          return { content: [{ type: "text", text: "fixture only" }],
            details: { cwd: ctx.cwd, provider: ctx.model.provider,
              nativeAuthAvailable: typeof ctx.modelRegistry.getApiKeyAndHeaders === "function" } };
        }
      });
    }`,
  );
  const settings = SettingsManager.inMemory(
    {
      packages: [pluginDir],
      compaction: { enabled: false },
      retry: { enabled: false },
    },
    { projectTrusted: true },
  );
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager: settings,
    additionalExtensionPaths: [
      fileURLToPath(new URL("../../src/agent/extension.ts", import.meta.url)),
    ],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const runtime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const model = runtime.getModels("openai-codex")[0];
  assert.ok(model, "pi ships its native Codex model catalog");
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime: runtime,
    model,
    resourceLoader: loader,
    settingsManager: settings,
    sessionManager: SessionManager.inMemory(cwd),
  });
  t.after(() => session.dispose());
  await session.bindExtensions({ mode: "print" });
  const names = session.getActiveToolNames();
  for (const name of [
    "read",
    "write",
    "edit",
    "bash",
    "world_inspect",
    "world_check_game",
    "fixture_native_image",
  ])
    assert.ok(names.includes(name), `${name} remains available`);
  assert.ok(!names.includes("world_generate_image"));
  const inspectTool = session.agent.state.tools.find(
    (entry) => entry.name === "world_inspect",
  );
  assert.ok(inspectTool);
  const inspected = await inspectTool.execute("inspect-isolated-world", {});
  const inspectedText = inspected.content.find(
    (entry) => entry.type === "text",
  );
  assert.ok(inspectedText && inspectedText.type === "text");
  assert.equal(
    JSON.parse(inspectedText.text).spec.name,
    "Native plugin integration",
  );
  const tool = session.agent.state.tools.find(
    (entry) => entry.name === "fixture_native_image",
  );
  assert.ok(tool);
  const result = await tool.execute(
    "fixture-call",
    {},
    new AbortController().signal,
  );
  assert.deepEqual(result.details, {
    cwd,
    provider: "openai-codex",
    nativeAuthAvailable: true,
  });
});
