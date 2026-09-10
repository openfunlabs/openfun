import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  symlink,
  rm,
  writeFile,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { generateImage, readImageStream } from "../../src/assets/images.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1sAAAAASUVORK5CYII=",
  "base64",
);
function event(value: unknown) {
  return `data: ${JSON.stringify(value)}\r\n\r\n`;
}
function completed(result = png.toString("base64")) {
  return {
    type: "response.completed",
    response: {
      status: "completed",
      output: [{ type: "image_generation_call", status: "completed", result }],
    },
  };
}
function stream(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 17)
          controller.enqueue(bytes.slice(i, i + 17));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
async function context(t: TestContext) {
  const cwd = await mkdtemp(join(tmpdir(), "openfun-images-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const claims = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account" },
    }),
  ).toString("base64url");
  const ctx = {
    cwd,
    model: {
      id: "user-selected-model",
      api: "openai-codex-responses",
      provider: "openai-codex",
      baseUrl: "https://chatgpt.com/backend-api",
    },
    modelRegistry: {
      getApiKeyAndHeaders: async () => ({
        ok: true,
        apiKey: `fixture.${claims}.signature`,
        headers: { "X-Test": "configured", removed: null },
      }),
    },
  } as unknown as ExtensionContext;
  return ctx;
}

test("image stream ignores partial previews and requires a completed final PNG across fragmented CRLF frames", async () => {
  const response = stream(
    event({
      type: "response.image_generation_call.partial_image",
      partial_image_b64: "invalid-preview",
    }) + event(completed()),
  );
  assert.deepEqual(await readImageStream(response), png);
  await assert.rejects(
    readImageStream(
      stream(
        event({
          type: "response.image_generation_call.partial_image",
          partial_image_b64: png.toString("base64"),
        }),
      ),
    ),
    /without a completed/,
  );
  await assert.rejects(
    readImageStream(stream(event({ type: "response.failed" }))),
    /failed or was incomplete/,
  );
  await assert.rejects(
    readImageStream(
      stream(event(completed(Buffer.from("not a png").toString("base64")))),
    ),
    /complete PNG/,
  );
});

test("image tool uses selected pi auth/model, supports references, saves final assets without overwrites", async (t) => {
  const ctx = await context(t);
  await writeFile(join(ctx.cwd, "reference.png"), png);
  let calls = 0;
  const fetchImage: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, "https://chatgpt.com/backend-api/codex/responses");
    const headers = new Headers(init!.headers);
    assert.equal(headers.get("chatgpt-account-id"), "fixture-account");
    assert.equal(headers.get("x-test"), "configured");
    const body = JSON.parse(init!.body as string);
    assert.equal(body.model, "user-selected-model");
    assert.equal(body.stream, true);
    assert.equal(body.store, false);
    assert.equal(body.tools[0].model, "gpt-image-2.5-sunburst");
    assert.equal(
      body.input[0].content[1].image_url,
      `data:image/png;base64,${png.toString("base64")}`,
    );
    return stream(event(completed()));
  };
  const params = { prompt: "Forest chest", references: ["reference.png"] };
  const first = await generateImage(ctx, params, undefined, fetchImage);
  const second = await generateImage(ctx, params, undefined, fetchImage);
  assert.equal(calls, 2);
  assert.notEqual(first.path, second.path);
  assert.ok(
    first.path.startsWith(
      join(await realpath(ctx.cwd), "game", "assets", "generated"),
    ),
  );
  assert.deepEqual(await readFile(first.path), png);
  assert.equal(first.references, 1);
  const receipt = JSON.parse(await readFile(first.sourceReceipt, "utf8"));
  assert.equal(receipt.imageModel, "gpt-image-2.5-sunburst");
  assert.equal(receipt.tool, "world_generate_image");
});

test("image errors do not retry, leak server bodies, change models, or publish outside the world", async (t) => {
  const ctx = await context(t);
  let calls = 0;
  const reject: typeof fetch = async () => {
    calls++;
    return new Response("secret diagnostic", { status: 429 });
  };
  await assert.rejects(
    generateImage(ctx, { prompt: "test" }, undefined, reject),
    (error) => {
      assert.match(String(error), /429/);
      assert.doesNotMatch(String(error), /secret diagnostic/);
      return true;
    },
  );
  assert.equal(calls, 1);
  const unsupported = {
    ...ctx,
    model: { ...ctx.model!, api: "anthropic-messages" },
  } as ExtensionContext;
  await assert.rejects(
    generateImage(unsupported, { prompt: "test" }, undefined, reject),
    /does not switch/,
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    generateImage(ctx, { prompt: "test" }, abort.signal, reject),
  );
  assert.equal(calls, 1);
  const external = await mkdtemp(join(tmpdir(), "openfun-image-external-"));
  t.after(() => rm(external, { recursive: true, force: true }));
  await writeFile(join(external, "reference.png"), png);
  await symlink(external, join(ctx.cwd, "external"));
  await assert.rejects(
    generateImage(
      ctx,
      { prompt: "test", references: ["external/reference.png"] },
      undefined,
      reject,
    ),
    /inside the current project/,
  );
  await rm(join(ctx.cwd, "game"), { recursive: true, force: true });
  await mkdir(join(ctx.cwd, "game"));
  await symlink(external, join(ctx.cwd, "game", "assets"));
  await assert.rejects(
    generateImage(ctx, { prompt: "test" }, undefined, reject),
    /inside the current project/,
  );
  assert.equal(calls, 1);
});

test("Codex output_item.done is retained when the terminal response has no output, but a terminal success is still required", async () => {
  const item = completed().response.output[0];
  const done = event({
    type: "response.output_item.done",
    item: { ...item, id: "img_fixture" },
  });
  const terminal = event({
    type: "response.completed",
    response: { status: "completed", output: [] },
  });
  assert.deepEqual(await readImageStream(stream(done + terminal)), png);
  await assert.rejects(readImageStream(stream(done)), /without a completed/);
  await assert.rejects(
    readImageStream(stream(done + event({ type: "response.failed" }))),
    /failed or was incomplete/,
  );
});

test("native image extension returns the actual saved PNG to the agent for visual reference", async (t) => {
  const { default: extension } = await import(
    "../../src/agent/image-extension.js"
  );
  const ctx = await context(t);
  t.mock.method(globalThis, "fetch", async () => stream(event(completed())));
  let tool:
    | import("@earendil-works/pi-coding-agent").ToolDefinition
    | undefined;
  extension({
    registerTool(value) {
      tool =
        value as unknown as import("@earendil-works/pi-coding-agent").ToolDefinition;
    },
  } as import("@earendil-works/pi-coding-agent").ExtensionAPI);
  assert.ok(tool);
  const result = await tool.execute(
    "reference-test",
    { prompt: "Gameplay reference" },
    undefined,
    undefined,
    ctx,
  );
  const image = result.content.find((block) => block.type === "image");
  assert.ok(image && image.type === "image");
  assert.equal(image.mimeType, "image/png");
  assert.deepEqual(Buffer.from(image.data, "base64"), png);
  const metadata = result.content.find((block) => block.type === "text");
  assert.ok(metadata && metadata.type === "text");
  assert.deepEqual(await readFile(JSON.parse(metadata.text).path), png);
});

test("terminal summaries do not erase final image bytes, and omitted output is supported", async () => {
  const done = event({
    type: "response.output_item.done",
    item: {
      id: "img_1",
      type: "image_generation_call",
      status: "completed",
      result: png.toString("base64"),
    },
  });
  for (const output of [
    undefined,
    [
      {
        id: "img_1",
        type: "image_generation_call",
        status: "completed",
        result: null,
      },
    ],
  ]) {
    assert.deepEqual(
      await readImageStream(
        stream(
          done +
            event({
              type: "response.completed",
              response: { status: "completed", output },
            }),
        ),
      ),
      png,
    );
  }
  await assert.rejects(
    readImageStream(
      stream(
        event({
          type: "response.completed",
          response: { status: "completed" },
        }),
      ),
    ),
    /exactly one final image/,
  );
});

test("structured HTTP and stream errors expose useful bounded diagnostics without credentials", async (t) => {
  const ctx = await context(t);
  const error = {
    code: "unsupported_parameter",
    param: "tools[0].size",
    message:
      "Unsupported parameter. Bearer secret-token sk-secret https://private.example/token",
  };
  const reject: typeof fetch = async () =>
    Response.json({ error }, { status: 400 });
  await assert.rejects(
    generateImage(ctx, { prompt: "test" }, undefined, reject),
    (e) => {
      assert.match(String(e), /unsupported_parameter/);
      assert.match(String(e), /tools\[0\].size/);
      assert.doesNotMatch(String(e), /secret-token|sk-secret|private.example/);
      return true;
    },
  );
  await assert.rejects(
    readImageStream(
      stream(event({ type: "response.failed", response: { error } })),
    ),
    /unsupported_parameter/,
  );
});

test("image model is explicit, UI provenance is recorded and unsupported choices fail before requests", async (t) => {
  const ctx = await context(t);
  let calls = 0;
  const fetchImage: typeof fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(init!.body as string);
    assert.equal(body.model, "user-selected-model");
    assert.equal(body.tools[0].model, "gpt-image-2.5-flare");
    return stream(event(completed()));
  };
  const result = await generateImage(
    ctx,
    {
      prompt: "Text-free panel",
      purpose: "ui",
      imageModel: "gpt-image-2.5-flare",
    },
    undefined,
    fetchImage,
  );
  const receipt = JSON.parse(await readFile(result.sourceReceipt, "utf8"));
  assert.equal(receipt.purpose, "ui");
  assert.equal(receipt.imageModel, "gpt-image-2.5-flare");
  await assert.rejects(
    generateImage(
      ctx,
      { prompt: "Panel", imageModel: "invented-model" },
      undefined,
      fetchImage,
    ),
  );
  assert.equal(calls, 1);
});
