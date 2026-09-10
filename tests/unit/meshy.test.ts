import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  generateModel,
  modelStatus,
  processModel,
  animationLibrary,
} from "../../src/assets/meshy.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1sAAAAASUVORK5CYII=",
  "base64",
);
const id = "018a210d-8ba4-705c-b111-1f1776f7f578";
const params = { key: "lantern-v1", reference: "reference.png" };
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
function glb(extra = {}) {
  const text = JSON.stringify({
    ...extra,
    asset: { version: "2.0" },
    materials: [
      { pbrMetallicRoughness: { baseColorFactor: [0.2, 0.5, 0.7, 1] } },
    ],
  });
  const body = Buffer.from(text.padEnd(Math.ceil(text.length / 4) * 4));
  const bytes = Buffer.alloc(20 + body.length);
  bytes.write("glTF");
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(body.length, 12);
  bytes.write("JSON", 16);
  body.copy(bytes, 20);
  return bytes;
}
async function fixture(t: TestContext) {
  const cwd = await mkdtemp(join(tmpdir(), "openfun-meshy-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, "reference.png"), png);
  return {
    cwd,
    modelRegistry: {
      getApiKeyForProvider: async (provider: string) => {
        assert.equal(provider, "meshy");
        return "fixture-secret";
      },
    },
  } as unknown as ExtensionContext;
}

test("Meshy uploads the reference once, resumes a task, downloads a validated colored GLB and reuses it offline", async (t) => {
  const ctx = await fixture(t);
  const calls: string[] = [];
  let complete = false;
  const fetchApi: typeof fetch = async (url, init) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (String(url).startsWith("https://assets.meshy.ai/")) {
      assert.equal(init?.headers, undefined, "Never send the key to the CDN");
      assert.equal(init?.redirect, "error");
      return new Response(glb());
    }
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer fixture-secret",
    );
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      assert.equal(
        body.image_url,
        `data:image/png;base64,${png.toString("base64")}`,
      );
      assert.equal(body.should_texture, true);
      assert.equal(body.enable_pbr, true);
      assert.equal(body.target_polycount, 10000);
      assert.deepEqual(body.target_formats, ["glb"]);
      return json({ result: id });
    }
    return json({
      id,
      status: complete ? "SUCCEEDED" : "IN_PROGRESS",
      progress: complete ? 100 : 35,
      model_urls: {
        glb: "https://assets.meshy.ai/model.glb?signature=fixture",
      },
    });
  };
  const first = await generateModel(ctx, params, undefined, fetchApi);
  assert.equal(first.taskId, id);
  assert.equal(
    (await generateModel(ctx, params, undefined, fetchApi)).taskId,
    id,
  );
  assert.equal(calls.length, 1);
  assert.equal(
    (await modelStatus(ctx, { key: params.key }, undefined, fetchApi)).progress,
    35,
  );
  complete = true;
  const result = await modelStatus(
    ctx,
    { key: params.key },
    undefined,
    fetchApi,
  );
  assert.ok(result.path);
  assert.deepEqual(await readFile(join(ctx.cwd, result.path)), glb());
  assert.ok(result.resource?.startsWith("res://assets/generated/"));
  const offline: typeof fetch = async () =>
    assert.fail("Saved assets need no API access");
  assert.equal(
    (await modelStatus(ctx, { key: params.key }, undefined, offline)).asset,
    result.asset,
  );
  const record = await readFile(
    join(ctx.cwd, ".openfun/meshy/lantern-v1.json"),
    "utf8",
  );
  const provenance = await readFile(
    join(ctx.cwd, "game/assets/generated/meshy-lantern-v1.json"),
    "utf8",
  );
  assert.doesNotMatch(
    record + provenance + JSON.stringify(result),
    /fixture-secret|signature=/,
  );
  await assert.rejects(
    generateModel(
      ctx,
      { ...params, targetPolycount: 5000 },
      undefined,
      fetchApi,
    ),
    /different request/,
  );
  assert.equal(calls.filter((c) => c.startsWith("POST")).length, 1);
});

test("uncertain or canceled submissions never resubmit and can recover an existing task ID", async (t) => {
  const ctx = await fixture(t);
  let calls = 0;
  const failing: typeof fetch = async () => {
    calls++;
    throw new Error("transport fixture-secret");
  };
  await assert.rejects(
    generateModel(ctx, params, undefined, failing),
    (error) => {
      assert.doesNotMatch(String(error), /fixture-secret/);
      return /No automatic retry/.test(String(error));
    },
  );
  assert.equal(
    (await generateModel(ctx, params, undefined, failing)).status,
    "UNKNOWN",
  );
  assert.equal(calls, 1);
  const recovered = await modelStatus(
    ctx,
    { key: params.key, taskId: id },
    undefined,
    async (_url, init) => {
      assert.equal(init?.method, "GET");
      return json({ id, status: "PENDING", progress: 0 });
    },
  );
  assert.equal(recovered.taskId, id);
  await assert.rejects(
    modelStatus(
      ctx,
      { key: params.key, taskId: "different" },
      undefined,
      failing,
    ),
    /another Meshy task/,
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    generateModel(ctx, { ...params, key: "canceled" }, abort.signal, failing),
    /abort/i,
  );
  assert.equal(calls, 1);
});

test("Meshy errors do not leak keys and downloads can be retried without another paid submission", async (t) => {
  const ctx = await fixture(t);
  await assert.rejects(
    generateModel(ctx, params, undefined, async () =>
      json({ error: "fixture-secret" }, 402),
    ),
    /HTTP 402.*credits/,
  );
  assert.equal(
    (
      await generateModel(ctx, params, undefined, async () =>
        assert.fail("No retry"),
      )
    ).status,
    "UNKNOWN",
  );
  const result = await modelStatus(
    ctx,
    { key: params.key, taskId: id },
    undefined,
    async () =>
      json({
        id,
        status: "FAILED",
        progress: 0,
        task_error: { message: "fixture-secret" },
      }),
  );
  assert.equal(result.status, "FAILED");
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret/);
  await generateModel(ctx, { ...params, key: "second" }, undefined, async () =>
    json({ result: id }),
  );
  let downloads = 0;
  const download: typeof fetch = async (url, init) => {
    assert.notEqual(init?.method, "POST");
    if (String(url).startsWith("https://assets.meshy.ai/")) {
      downloads++;
      return downloads === 1
        ? new Response("expired", { status: 403 })
        : new Response(glb());
    }
    return json({
      id,
      status: "SUCCEEDED",
      progress: 100,
      model_urls: { glb: "https://assets.meshy.ai/model.glb" },
    });
  };
  await assert.rejects(
    modelStatus(ctx, { key: "second" }, undefined, download),
    /download failed/,
  );
  assert.ok(
    (await modelStatus(ctx, { key: "second" }, undefined, download)).asset,
  );
});

test("Meshy rejects missing auth, project escapes, invalid GLB and untrusted download URLs", async (t) => {
  const ctx = await fixture(t);
  const noFetch: typeof fetch = async () =>
    assert.fail("No network should be attempted");
  const noAuth = {
    ...ctx,
    modelRegistry: { getApiKeyForProvider: async () => undefined },
  } as unknown as ExtensionContext;
  await assert.rejects(
    generateModel(noAuth, params, undefined, noFetch),
    /login meshy/,
  );
  const outside = await fixture(t);
  await symlink(
    join(outside.cwd, "reference.png"),
    join(ctx.cwd, "outside.png"),
  );
  await assert.rejects(
    generateModel(
      ctx,
      { ...params, reference: "outside.png" },
      undefined,
      noFetch,
    ),
    /inside the current project/,
  );
  await assert.rejects(
    generateModel(ctx, { ...params, key: "../escape" }, undefined, noFetch),
  );
  await generateModel(ctx, params, undefined, async () => json({ result: id }));
  await assert.rejects(
    modelStatus(ctx, { key: params.key }, undefined, async () =>
      json({
        id,
        status: "SUCCEEDED",
        progress: 100,
        model_urls: { glb: "https://untrusted.example/model.glb" },
      }),
    ),
    /unsupported asset URL/,
  );
  await assert.rejects(
    modelStatus(ctx, { key: params.key }, undefined, async (url) =>
      String(url).startsWith("https://assets.meshy.ai/")
        ? new Response("invalid")
        : json({
            id,
            status: "SUCCEEDED",
            progress: 100,
            model_urls: { glb: "https://assets.meshy.ai/model.glb" },
          }),
    ),
    /Invalid GLB/,
  );
  assert.deepEqual(await readdir(join(ctx.cwd, "game/assets/generated")), []);
  const escape = await fixture(t);
  await mkdir(join(escape.cwd, "game"));
  await symlink(outside.cwd, join(escape.cwd, "game/assets"));
  await generateModel(escape, params, undefined, async () =>
    json({ result: id }),
  );
  await assert.rejects(
    modelStatus(escape, { key: params.key }, undefined, noFetch),
    /inside the current project/,
  );
});

test("text preview and refine are separate resumable paid stages", async (t) => {
  const ctx = await fixture(t);
  const posts: Record<string, unknown>[] = [];
  const mock: typeof fetch = async (url, init) => {
    if (String(url).startsWith("https://assets.meshy.ai/"))
      return new Response(glb());
    assert.match(String(url), /openapi\/v2\/text-to-3d/);
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      return json({ result: posts.length === 1 ? "preview-id" : "refine-id" });
    }
    return json({
      id: String(url).split("/").pop(),
      status: "SUCCEEDED",
      progress: 100,
      model_urls: { glb: "https://assets.meshy.ai/model.glb" },
    });
  };
  await generateModel(
    ctx,
    { key: "preview", prompt: "Stylized guard in A pose", pose: "a-pose" },
    undefined,
    mock,
  );
  await assert.rejects(
    processModel(
      ctx,
      { operation: "refine", key: "paint", sourceKey: "preview" },
      undefined,
      mock,
    ),
    /succeeded/,
  );
  await modelStatus(ctx, { key: "preview" }, undefined, mock);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.mode, "preview");
  assert.equal(posts[0]!.pose_mode, "a-pose");
  const refine = {
    operation: "refine",
    key: "paint",
    sourceKey: "preview",
    texturePrompt: "Teal coat",
  };
  await processModel(ctx, refine, undefined, mock);
  await processModel(ctx, refine, undefined, async () =>
    assert.fail("Duplicate submission"),
  );
  assert.equal(posts.length, 2);
  assert.equal(posts[1]!.preview_task_id, "preview-id");
  assert.equal(posts[1]!.mode, "refine");
  assert.equal(posts[1]!.enable_pbr, true);
  const source = JSON.parse(
    await readFile(join(ctx.cwd, ".openfun/meshy/preview.json"), "utf8"),
  );
  assert.equal(source.taskId, "preview-id");
  await assert.rejects(
    processModel(
      ctx,
      { ...refine, texturePrompt: "Red coat" },
      undefined,
      mock,
    ),
    /different request/,
  );
});

test("local Blender exports can be retextured; invalid sources are rejected before billing", async (t) => {
  const ctx = await fixture(t);
  await writeFile(join(ctx.cwd, "model.glb"), glb());
  const noFetch: typeof fetch = async () =>
    assert.fail("No API request expected");
  await assert.rejects(
    generateModel(ctx, { ...params, prompt: "Both" }, undefined, noFetch),
    /exactly one/,
  );
  await assert.rejects(
    processModel(
      ctx,
      { operation: "retexture", key: "paint", model: "model.glb" },
      undefined,
      noFetch,
    ),
    /exactly one/,
  );
  await assert.rejects(
    processModel(
      ctx,
      { operation: "rig", key: "rig", model: "model.glb" },
      undefined,
      noFetch,
    ),
    /textur/i,
  );
  await processModel(
    ctx,
    {
      operation: "retexture",
      key: "paint",
      model: "model.glb",
      reference: "reference.png",
    },
    undefined,
    async (url, init) => {
      assert.match(String(url), /openapi\/v1\/retexture$/);
      const body = JSON.parse(String(init?.body));
      assert.match(body.model_url, /^data:application\/octet-stream;base64,/);
      assert.match(body.image_style_url, /^data:image\/png;base64,/);
      assert.equal(body.enable_original_uv, false);
      assert.equal(body.enable_pbr, true);
      return json({ result: id });
    },
  );
});

test("rig outputs and preset animations use their own endpoints, validate motion and cache each output", async (t) => {
  const ctx = await fixture(t);
  const textured = glb();
  // Use an already completed image task as the rig source.
  await generateModel(ctx, params, undefined, async () => json({ result: id }));
  await modelStatus(ctx, { key: params.key }, undefined, async (url) =>
    String(url).startsWith("https://assets.meshy.ai/")
      ? new Response(textured)
      : json({
          id,
          status: "SUCCEEDED",
          progress: 100,
          model_urls: { glb: "https://assets.meshy.ai/source.glb" },
        }),
  );
  let posts = 0;
  let staticOutput = false;
  const rigged = glb({ skins: [{ joints: [0] }], nodes: [{}] });
  const moving = glb({
    skins: [{ joints: [0] }],
    nodes: [{}],
    animations: [
      { channels: [{ sampler: 0, target: { node: 0, path: "rotation" } }] },
    ],
  });
  const mock: typeof fetch = async (url, init) => {
    const path = String(url);
    if (path.includes("animations/library"))
      return json([
        {
          action_id: 4,
          name: "Attack",
          key: "Attack",
          category: "Fighting",
          sub_category: "Attack",
        },
      ]);
    if (path.startsWith("https://assets.meshy.ai/")) {
      assert.equal(init?.headers, undefined);
      return new Response(
        staticOutput ? glb() : path.endsWith("rig.glb") ? rigged : moving,
      );
    }
    if (init?.method === "POST") {
      posts++;
      const body = JSON.parse(String(init.body));
      if (path.endsWith("rigging")) {
        assert.equal(body.input_task_id, id);
        return json({ result: "rig-id" });
      }
      assert.ok(path.endsWith("/animations"));
      assert.deepEqual(body, { rig_task_id: "rig-id", action_id: 4 });
      return json({ result: "motion-id" });
    }
    return path.endsWith("rig-id")
      ? json({
          id: "rig-id",
          status: "SUCCEEDED",
          progress: 100,
          consumed_credits: 5,
          result: {
            rigged_character_glb_url: "https://assets.meshy.ai/rig.glb",
            basic_animations: {
              walking_glb_url: "https://assets.meshy.ai/walk.glb",
            },
          },
        })
      : json({
          id: "motion-id",
          status: "SUCCEEDED",
          progress: 100,
          result: { animation_glb_url: "https://assets.meshy.ai/attack.glb" },
        });
  };
  await processModel(
    ctx,
    { operation: "rig", key: "rig", sourceKey: params.key },
    undefined,
    mock,
  );
  const rig = await modelStatus(ctx, { key: "rig" }, undefined, mock);
  assert.equal(rig.consumedCredits, 5);
  const walk = await modelStatus(
    ctx,
    { key: "rig", output: "walking" },
    undefined,
    mock,
  );
  assert.notEqual(walk.asset, rig.asset);
  assert.equal(
    (
      await modelStatus(ctx, { key: "rig" }, undefined, async () =>
        assert.fail("Cached"),
      )
    ).asset,
    rig.asset,
  );
  await assert.rejects(
    modelStatus(ctx, { key: "rig", output: "running" }, undefined, mock),
    /without the requested/,
  );
  await assert.rejects(
    processModel(
      ctx,
      { operation: "animate", key: "bad", sourceKey: "rig", actionId: 999 },
      undefined,
      mock,
    ),
    /not available/,
  );
  const request = {
    operation: "animate",
    key: "attack",
    sourceKey: "rig",
    actionId: 4,
  };
  await processModel(ctx, request, undefined, mock);
  await processModel(ctx, request, undefined, async () =>
    assert.fail("Offline resume"),
  );
  staticOutput = true;
  await assert.rejects(
    modelStatus(ctx, { key: "attack" }, undefined, mock),
    /no skin/,
  );
  staticOutput = false;
  assert.ok((await modelStatus(ctx, { key: "attack" }, undefined, mock)).asset);
  assert.equal(posts, 2);
});

test("animation library is a bounded read-only live lookup", async (t) => {
  const ctx = await fixture(t);
  const result = await animationLibrary(
    ctx,
    { search: "Sword Attack", category: "Fighting", limit: 1 },
    undefined,
    async (url, init) => {
      assert.equal(init?.method, "GET");
      assert.equal(
        new URL(String(url)).searchParams.get("search"),
        "Sword Attack",
      );
      return json(
        [4, 5].map((action_id) => ({
          action_id,
          name: "Attack",
          key: "attack",
          category: "Fighting",
          sub_category: "Sword",
          preview_url: "https://example.com/private",
        })),
      );
    },
  );
  assert.equal(result.totalMatches, 2);
  assert.equal(result.returned, 1);
  assert.doesNotMatch(JSON.stringify(result), /preview_url/);
});
