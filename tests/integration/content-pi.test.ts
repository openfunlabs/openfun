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
import { readContentDocuments } from "../../src/generation/content-documents.js";
import { parseContentRequest } from "../../src/generation/content-types.js";
import { createPiContentGenerator } from "../../src/generation/content-pi.js";
import { WorldStore } from "../../src/world/world.js";

test("project content uses native pi model/auth and only schema-bound submit_content, with actual world documents", async () => {
  const root = mkdtempSync(join(tmpdir(), "openfun-native-generator-"));
  const worldDir = join(root, "world"),
    agentDir = join(root, "openfun", "agent");
  const previous = process.env.PI_CODING_AGENT_DIR;
  const previousOpenfun = process.env.OPENFUN_HOME;
  process.env.PI_CODING_AGENT_DIR = join(root, "unselected-pi");
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
    const plan = { title: "Native content fixture", cards: ["moon"] };
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const base = {
      id: "fixture-completion",
      object: "chat.completion.chunk",
      created: 1,
      model: "fixture-model",
    };
    response.write(
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "submit-1", type: "function", function: { name: "submit_content", arguments: JSON.stringify(plan) } }] }, finish_reason: null }] })}\n\n`,
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
    const request = {
      request: parseContentRequest({
        namespace: "custom_game",
        key: "deck:1",
        prompt: "Design a deck",
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            cards: { type: "array", items: { type: "string" } },
          },
          required: ["title", "cards"],
          additionalProperties: false,
        },
      }),
      ...readContentDocuments(worldDir),
    };
    const plan = await createPiContentGenerator(worldDir)(
      request,
      AbortSignal.timeout(20000),
    );
    assert.equal((plan as { title: string }).title, "Native content fixture");
    assert.match(JSON.stringify(payload), /SDK model fixture/);
    assert.equal(requests, 1);
    assert.equal(authorization, "Bearer fake-local-fixture-key");
    assert.equal(payload?.model, "fixture-model");
    const tools = payload?.tools as { function: { name: string } }[];
    assert.deepEqual(
      tools.map((tool) => tool.function.name),
      ["submit_content"],
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
    if (previousOpenfun === undefined) delete process.env.OPENFUN_HOME;
    else process.env.OPENFUN_HOME = previousOpenfun;
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
