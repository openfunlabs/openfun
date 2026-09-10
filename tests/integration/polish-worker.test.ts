import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
  cp,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorldStore } from "../../src/world/world.js";
import {
  ensureGameProject,
  checkGameProject,
} from "../../src/godot/project.js";
import { PolishController } from "../../src/polish/controller.js";
import { resolveTool } from "../../src/paths.js";
import { runPolishRound } from "../../src/polish/runner.js";

test("dedicated bundled pi worker uses selected local provider, records outcome and never starts a nested loop", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "openfun-polish-native-")),
    world = join(root, "world"),
    home = join(root, "home");
  const previous = process.env.OPENFUN_HOME;
  const previousGodot = process.env.OPENFUN_GODOT;
  const installedGodot = resolveTool("godot");
  if (process.env.OPENFUN_TEST_POLISH_RENDER === "1") {
    assert.ok(installedGodot);
    process.env.OPENFUN_GODOT = installedGodot;
  }
  process.env.OPENFUN_HOME = home;
  const rendering = process.env.OPENFUN_TEST_POLISH_RENDER === "1";
  let calls = 0;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(req.headers.authorization, "Bearer local-fixture");
    assert.equal(payload.model, "polish-fixture");
    const names = payload.tools.map((tool: any) => tool.function.name);
    assert.ok(names.includes("world_polish_result"));
    assert.ok(!names.includes("world_offer_polish"));
    assert.match(JSON.stringify(payload.messages), /isolated candidate/);
    const alreadyReported = payload.messages.some(
      (message: any) =>
        message.role === "tool" &&
        String(message.content).includes("Round recorded"),
    );
    calls++;
    if (calls > 8) {
      res.writeHead(500);
      res.end("Fixture exceeded expected tool sequence");
      return;
    }
    const base = {
      id: "fixture",
      object: "chat.completion.chunk",
      created: 1,
      model: "polish-fixture",
    };
    const delta = alreadyReported
      ? {
          role: "assistant",
          content: "Player direction required in this fixture.",
        }
      : {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `report-${calls}`,
              type: "function",
              function: {
                name: "world_polish_result",
                arguments: JSON.stringify({
                  outcome: rendering ? "finished" : "needs_input",
                  summary: "Native worker fixture completed",
                  checks: rendering
                    ? [
                        "Real Godot rendered the candidate fixture after editing; this is an integration fixture, not an artistic quality claim.",
                      ]
                    : [],
                  remaining: [],
                }),
              },
            },
          ],
        };
    if (rendering && calls <= 2 && "tool_calls" in delta && delta.tool_calls) {
      delta.tool_calls[0]!.function =
        calls === 1
          ? {
              name: "write",
              arguments: JSON.stringify({
                path: "game/world.gd",
                content:
                  'extends Node3D\nfunc _ready() -> void:\n\tvar layer = CanvasLayer.new()\n\tadd_child(layer)\n\tvar label = Label.new()\n\tlabel.text = "Verified polish fixture"\n\tlabel.position = Vector2(40, 60)\n\tlabel.add_theme_font_size_override("font_size", 32)\n\tlayer.add_child(label)\n',
              }),
            }
          : {
              name: "world_preview_game",
              arguments: JSON.stringify({
                demo: true,
                seconds: 1,
                width: 640,
                height: 360,
              }),
            };
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
    );
    res.write(
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: alreadyReported ? "stop" : "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`,
    );
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  let loop: PolishController | undefined;
  t.after(async () => {
    await loop?.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousGodot === undefined) delete process.env.OPENFUN_GODOT;
    else process.env.OPENFUN_GODOT = previousGodot;
    if (previous === undefined) delete process.env.OPENFUN_HOME;
    else process.env.OPENFUN_HOME = previous;
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  WorldStore.create(world, { name: "Native loop fixture" }).close();
  await ensureGameProject(world);
  const agent = join(home, "agent");
  await mkdir(agent, { recursive: true });
  await writeFile(
    join(agent, "auth.json"),
    JSON.stringify({ fixture: { type: "api_key", key: "local-fixture" } }),
  );
  await writeFile(
    join(agent, "models.json"),
    JSON.stringify({
      providers: {
        fixture: {
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          api: "openai-completions",
          models: [
            {
              id: "polish-fixture",
              reasoning: false,
              input: ["text", "image"],
              contextWindow: 32768,
              maxTokens: 8192,
            },
          ],
        },
      },
    }),
  );
  await writeFile(
    join(home, "plugins.json"),
    JSON.stringify({
      mcp: false,
      context: false,
      questions: false,
      images: false,
      assets3d: false,
    }),
  );
  await mkdir(join(world, ".openfun"), { recursive: true });
  await writeFile(
    join(world, ".openfun/agent.json"),
    JSON.stringify({ provider: "fixture", model: "polish-fixture" }),
  );
  loop = new PolishController(world, {
    run: runPolishRound,
    check: async (candidate) => {
      if (rendering) return checkGameProject(candidate);
      assert.fail("Needs-input round must not promote");
    },
    playing: () => false,
    notify: () => {},
  });
  await loop.start();
  await loop.idle();
  const state = await loop.state();
  assert.equal(
    state?.status,
    rendering ? "applied" : "paused",
    JSON.stringify(state),
  );
  assert.equal(state.round, 1);
  assert.ok(calls >= 2);
  const result = JSON.parse(
    await readFile(join(loop.root, state.id, "round-1.json"), "utf8"),
  );
  assert.equal(result.outcome, rendering ? "finished" : "needs_input");
  if (rendering) {
    assert.match(
      await readFile(join(world, "game/world.gd"), "utf8"),
      /Verified polish fixture/,
    );
    const previews = join(loop.candidate(state), "artifacts/previews");
    const png = (await readdir(previews)).find((name) => name.endsWith(".png"));
    assert.ok(png);
    await cp(
      join(previews, png),
      join(process.cwd(), ".output/polish-native-preview.png"),
    );
  }
});
