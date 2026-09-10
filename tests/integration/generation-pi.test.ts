import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildGenerationRequest } from "../../src/generation/chunks.js";
import { createPiChunkGenerator } from "../../src/generation/chunks-pi.js";
import { WorldStore } from "../../src/world/world.js";

test("native pi SDK uses saved provider/model and global auth, advertises only submit_chunk and excludes creator context", async () => {
  const root = mkdtempSync(join(tmpdir(), "openfun-native-generator-"));
  const worldDir = join(root, "world"),
    agentDir = join(root, "openfun", "agent");
  const previous = process.env.OPENFUN_HOME;
  process.env.OPENFUN_HOME = join(root, "openfun");
  const store = WorldStore.create(worldDir, { name: "SDK model fixture" });
  let requests = 0;
  let payload: Record<string, unknown> | undefined;
  let authorization: string | undefined;
  const server = createServer(async (request, response) => {
    requests++;
    authorization = request.headers.authorization;
    const parts: Buffer[] = [];
    for await (const part of request) parts.push(Buffer.from(part));
    payload = JSON.parse(Buffer.concat(parts).toString()) as Record<
      string,
      unknown
    >;
    const plan = {
      entities: [
        {
          kind: "npc",
          name: "Native SDK fixture",
          position: [7, 0, 7],
          rotation: 0,
          scale: [1, 1, 1],
          color: "#aabbcc",
          state: {},
        },
      ],
    };
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const base = {
      id: "fixture-completion",
      object: "chat.completion.chunk",
      created: 1,
      model: "fixture-model",
    };
    response.write(
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "submit-1", type: "function", function: { name: "submit_chunk", arguments: JSON.stringify(plan) } }] }, finish_reason: null }] })}\n\n`,
    );
    response.write(
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`,
    );
    response.end("data: [DONE]\n\n");
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(join(worldDir, ".pi"), { recursive: true });
    mkdirSync(join(worldDir, ".openfun"), { recursive: true });
    const trap = join(worldDir, "extension-loaded");
    const extension = join(worldDir, "forbidden-extension.mjs");
    writeFileSync(
      extension,
      `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(trap)},'unexpected');export default function(){};`,
    );
    writeFileSync(
      join(worldDir, "AGENTS.md"),
      "PRIVATE_CREATOR_CONTEXT_NEVER_SEND",
    );
    writeFileSync(
      join(agentDir, "settings.json"),
      JSON.stringify({
        extensions: [extension],
        defaultProvider: "wrong-default",
        defaultModel: "wrong-default",
      }),
    );
    const auth = JSON.stringify({
      fixture: { type: "api_key", key: "fake-local-fixture-key" },
    });
    writeFileSync(join(agentDir, "auth.json"), auth);
    writeFileSync(
      join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          fixture: {
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
            api: "openai-completions",
            models: [
              {
                id: "fixture-model",
                reasoning: false,
                contextWindow: 32768,
                maxTokens: 8192,
              },
            ],
          },
        },
      }),
    );
    writeFileSync(
      join(worldDir, ".openfun", "agent.json"),
      JSON.stringify({
        provider: "fixture",
        model: "fixture-model",
        thinkingLevel: "off",
      }),
    );
    store.queueGeneration(0, 0);
    const request = buildGenerationRequest(store, store.claimGeneration(0, 0)!);
    const plan = await createPiChunkGenerator(worldDir)(
      request,
      AbortSignal.timeout(20000),
    );
    assert.equal(plan.entities[0]?.name, "Native SDK fixture");
    assert.equal(requests, 1);
    assert.equal(authorization, "Bearer fake-local-fixture-key");
    assert.equal(payload?.model, "fixture-model");
    const tools = payload?.tools as { function: { name: string } }[];
    assert.deepEqual(
      tools.map((tool) => tool.function.name),
      ["submit_chunk"],
    );
    assert.doesNotMatch(
      JSON.stringify(payload),
      /PRIVATE_CREATOR_CONTEXT_NEVER_SEND|fake-local-fixture-key/,
    );
    assert.equal(existsSync(trap), false);
    assert.equal(existsSync(join(worldDir, ".openfun", "sessions")), false);
    assert.equal(existsSync(join(worldDir, ".pi", "auth.json")), false);
    assert.equal(readFileSync(join(agentDir, "auth.json"), "utf8"), auth);
  } finally {
    if (previous === undefined) delete process.env.OPENFUN_HOME;
    else process.env.OPENFUN_HOME = previous;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
