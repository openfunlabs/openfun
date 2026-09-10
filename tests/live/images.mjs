// Explicit real subscription test. Uses the same native pi extension as OpenFun.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  agentDirectory,
  piRuntimePaths,
} from "../../src/agent/pi-environment.ts";
import { pngDimensions } from "../../src/assets/images.ts";

const modelId = process.argv[2];
assert.ok(
  modelId,
  "Pass a Codex model ID explicitly; this test uses subscription image quota.",
);
const reference = process.argv[3];
const cwd = resolve(".output/image-live");
await mkdir(cwd, { recursive: true });
const settings = SettingsManager.inMemory({
  packages: [],
  extensions: [],
  compaction: { enabled: false },
  retry: { enabled: false },
});
const runtime = await ModelRuntime.create({
  ...piRuntimePaths(),
  allowModelNetwork: false,
});
const model = runtime.getModel("openai-codex", modelId);
assert.ok(model, "Requested Codex model is unavailable");
const loader = new DefaultResourceLoader({
  cwd,
  agentDir: agentDirectory(),
  settingsManager: settings,
  additionalExtensionPaths: [
    fileURLToPath(
      new URL("../../src/agent/image-extension.ts", import.meta.url),
    ),
  ],
  noSkills: true,
  noContextFiles: true,
  noPromptTemplates: true,
  noThemes: true,
});
await loader.reload();
assert.deepEqual(loader.getExtensions().errors, []);
const { session } = await createAgentSession({
  cwd,
  agentDir: agentDirectory(),
  modelRuntime: runtime,
  model,
  settingsManager: settings,
  resourceLoader: loader,
  sessionManager: SessionManager.inMemory(cwd),
});
try {
  await session.bindExtensions({ mode: "print" });
  const tool = session.agent.state.tools.find(
    (t) => t.name === "world_generate_image",
  );
  assert.ok(tool, "Native pi image tool loaded");
  const result = await tool.execute("live-image", {
    prompt: reference
      ? "Use this UI panel reference to create a matching single text-free wide button skin, preserving the teal enamel, restrained brass corners and carved leaf style. Front-facing, straight continuous edges, quiet dark center for native text, transparent outside. No words, numbers, checkerboard or scene."
      : "Create a polished stylized game prop concept: a single reusable text-free game dialogue panel skin, dark teal enamel, aged brass corners and restrained carved leaf motif. Front-facing orthographic UI asset, straight repeatable edges for nine-slice scaling, generous dark quiet text-safe center. Corner detail confined to the border. Transparent outside, no checkerboard, no lettering, no numbers, no mockup, no scene.",
    size: "1024x1024",
    purpose: "ui",
    ...(process.argv[4] ? { imageModel: process.argv[4] } : {}),
    ...(reference ? { references: [reference] } : {}),
  });
  const details = result.details;
  const bytes = await readFile(details.path);
  const dimensions = pngDimensions(bytes);
  assert.equal(dimensions.width, details.width);
  assert.equal(dimensions.height, details.height);
  const report = {
    passed: true,
    nativePiTool: true,
    subscriptionRequests: 1,
    ...details,
  };
  await writeFile(
    resolve(
      reference ? ".output/image-edit-live.json" : ".output/image-live.json",
    ),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  session.dispose();
}
