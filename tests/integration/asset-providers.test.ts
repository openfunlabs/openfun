import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { assetProvider } from "../../src/agent/asset-providers.js";

test("native pi login stores asset keys outside worlds, resolves them after restart, and exposes no chat models", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "openfun-asset-auth-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = {
    authPath: join(root, "openfun/agent/auth.json"),
    modelsPath: join(root, "openfun/agent/models.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  };
  const runtime = await ModelRuntime.create(options);
  for (const id of ["meshy", "tripo"] as const) {
    runtime.registerNativeProvider(assetProvider(id));
    await runtime.login(id, "api_key", {
      prompt: async (prompt) => {
        assert.equal(prompt.type, "secret");
        assert.equal(
          prompt.message,
          `${id === "meshy" ? "Meshy" : "Tripo"} API key`,
        );
        return `fixture-${id}-key`;
      },
      notify: (event) => assert.doesNotMatch(JSON.stringify(event), /fixture-/),
    });
    assert.deepEqual(runtime.getModels(id), []);
    assert.equal((await runtime.getAuth(id))?.auth.apiKey, `fixture-${id}-key`);
  }
  const stored = JSON.parse(await readFile(options.authPath, "utf8"));
  assert.equal(stored.meshy.type, "api_key");
  if (process.platform !== "win32")
    assert.equal((await stat(options.authPath)).mode & 0o077, 0);
  const restarted = await ModelRuntime.create(options);
  restarted.registerNativeProvider(assetProvider("meshy"));
  assert.equal(
    (await restarted.getAuth("meshy"))?.auth.apiKey,
    "fixture-meshy-key",
  );
  await restarted.logout("meshy");
  assert.equal(
    JSON.parse(await readFile(options.authPath, "utf8")).meshy,
    undefined,
  );
  assert.ok(JSON.parse(await readFile(options.authPath, "utf8")).tripo);
});

test("asset provider auth uses stored key before environment and cancels without returning a credential", async () => {
  const method = assetProvider("meshy").auth.apiKey!;
  const signal = new AbortController().signal;
  const ctx = {
    env: async (name: string) => {
      assert.equal(name, "MESHY_API_KEY");
      return "env-fixture";
    },
    fileExists: async () => false,
  };
  assert.equal(
    (await method.resolve({ ctx, signal }))?.auth.apiKey,
    "env-fixture",
  );
  assert.equal(
    (
      await method.resolve({
        ctx,
        signal,
        credential: { type: "api_key", key: "stored-fixture" },
      })
    )?.auth.apiKey,
    "stored-fixture",
  );
  await assert.rejects(
    method.login!({
      signal,
      prompt: async () => {
        throw new Error("Login cancelled");
      },
      notify: () => {},
    }),
    /cancelled/,
  );
  await assert.rejects(
    method.login!({
      signal,
      prompt: async () => "invalid key",
      notify: () => {},
    }),
    /without whitespace/,
  );
});
