import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { zipSync } from "fflate";
import {
  assetInfo,
  importAsset,
  searchAssets,
} from "../../src/assets/library.js";
import { projectPackagePath } from "../../src/sharing/project-files.js";
const response = (v: unknown) => new Response(JSON.stringify(v));
const model = Buffer.from(
  JSON.stringify({
    asset: { version: "2.0" },
    buffers: [{ uri: "crate.bin", byteLength: 4 }],
    images: [{ uri: "textures/color.png" }],
  }),
);
const fixture = { name: "Crate", type: 2, tags: ["wood"] };

test("library imports model dependencies once, preserves provenance, reuses offline and detects edits", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "openfun-library-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  let requests = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, options: RequestInit) => {
      requests++;
      assert.equal(options.redirect, "manual");
      assert.match(
        String((options.headers as Record<string, string>)["User-Agent"]),
        /OpenFun/,
      );
      if (url.endsWith("/assets")) return response({ fixture_crate: fixture });
      if (url.includes("/files/"))
        return response({
          gltf: {
            "1k": {
              gltf: {
                url: "https://dl.polyhaven.org/crate.gltf",
                size: model.length,
                include: {
                  "crate.bin": {
                    url: "https://dl.polyhaven.org/crate.bin",
                    size: 4,
                  },
                  "textures/color.png": {
                    url: "https://dl.polyhaven.org/color.png",
                    size: 3,
                  },
                },
              },
            },
          },
        });
      return new Response(
        url.endsWith(".gltf")
          ? model
          : url.endsWith(".bin")
            ? Buffer.alloc(4)
            : Buffer.from("png"),
      );
    },
  );
  const info = await assetInfo({ provider: "polyhaven", id: "fixture_crate" });
  assert.equal(info.variants[0]?.key, "gltf/1k/gltf");
  const params = {
    provider: "polyhaven",
    id: "fixture_crate",
    variant: "gltf/1k/gltf",
  };
  const result = (await importAsset(cwd, params)) as any;
  assert.equal(result.cached, false);
  assert.equal(result.files.length, 3);
  const directory = join(cwd, "game", result.directory.slice(6));
  const receipt = JSON.parse(
    await readFile(join(directory, "asset-source.json"), "utf8"),
  );
  assert.equal(receipt.asset.license, "CC0-1.0");
  assert.match(receipt.asset.sourceUrl, /polyhaven/);
  const count = requests;
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("offline");
  });
  assert.equal(((await importAsset(cwd, params)) as any).cached, true);
  assert.equal(requests, count);
  const local = await searchAssets(cwd, { source: "local", query: "wood" });
  assert.equal(local.results.length, 1);
  await writeFile(join(directory, "crate.bin"), "edit");
  await assert.rejects(importAsset(cwd, params), /edited or damaged/);
  assert.equal(await readFile(join(directory, "crate.bin"), "utf8"), "edit");
});

test("ambientCG imports texture ZIP atomically and records portable resource files", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "openfun-library-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const archive = zipSync({
    "Wood_Color.jpg": Buffer.from("jpg"),
    "Wood.blend": Buffer.from("not imported"),
    "Wood_NormalGL.png": Buffer.from("png"),
  });
  t.mock.method(globalThis, "fetch", async (url: string) =>
    url.includes("full_json")
      ? response({
          foundAssets: [
            {
              assetId: "FixtureWood",
              dataType: "Material",
              displayName: "Wood",
              downloadFolders: {
                default: {
                  downloadFiletypeCategories: {
                    zip: {
                      downloads: [
                        {
                          attribute: "1K-JPG",
                          downloadLink:
                            "https://ambientcg.com/get?file=fixture.zip",
                          size: archive.length,
                        },
                      ],
                    },
                  },
                },
              },
            },
          ],
        })
      : new Response(Buffer.from(archive)),
  );
  const result = (await importAsset(cwd, {
    provider: "ambientcg",
    id: "FixtureWood",
    variant: "default/1K-JPG",
  })) as any;
  assert.equal(result.files.length, 2);
  assert.deepEqual(result.skippedFiles, ["Wood.blend"]);
  assert.ok(
    result.files.every((p: string) => projectPackagePath(`game/${p.slice(6)}`)),
  );
  assert.ok(projectPackagePath("game/assets/sky.hdr"));
  assert.ok(projectPackagePath("game/assets/sky.exr"));
});

test("rejects ZIP traversal and cleans incomplete imports", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "openfun-library-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const archive = zipSync({ "../escape.png": Buffer.from("png") });
  t.mock.method(globalThis, "fetch", async (url: string) =>
    url.includes("full_json")
      ? response({
          foundAssets: [
            {
              assetId: "Traversal",
              downloadFolders: {
                default: {
                  downloadFiletypeCategories: {
                    zip: {
                      downloads: [
                        {
                          attribute: "1K",
                          downloadLink:
                            "https://ambientcg.com/get?file=bad.zip",
                          size: archive.length,
                        },
                      ],
                    },
                  },
                },
              },
            },
          ],
        })
      : new Response(Buffer.from(archive)),
  );
  await assert.rejects(
    importAsset(cwd, {
      provider: "ambientcg",
      id: "Traversal",
      variant: "default/1K",
    }),
    /Unsafe/,
  );
  assert.deepEqual(
    await readdir(join(cwd, "game/assets/library/ambientcg")),
    [],
  );
});

test("rejects redirects to private hosts before requesting them", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "openfun-library-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    calls++;
    if (url.includes("full_json"))
      return response({
        foundAssets: [
          {
            assetId: "Redirect",
            downloadFolders: {
              default: {
                downloadFiletypeCategories: {
                  zip: {
                    downloads: [
                      {
                        attribute: "1K",
                        downloadLink:
                          "https://ambientcg.com/get?file=redirect.zip",
                        size: 9,
                      },
                    ],
                  },
                },
              },
            },
          },
        ],
      });
    return new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
    });
  });
  await assert.rejects(
    importAsset(cwd, {
      provider: "ambientcg",
      id: "Redirect",
      variant: "default/1K",
    }),
    /outside supported/,
  );
  assert.equal(calls, 2);
});

test("refuses an asset directory symlink before network requests", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "openfun-library-")),
    outside = await mkdtemp(join(tmpdir(), "openfun-outside-"));
  t.after(() =>
    Promise.all([
      rm(cwd, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]),
  );
  await symlink(outside, join(cwd, "game"));
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network should not run");
  });
  await assert.rejects(
    importAsset(cwd, {
      provider: "polyhaven",
      id: "fixture_crate",
      variant: "gltf/1k/gltf",
    }),
    /symlinks/,
  );
  assert.deepEqual(await readdir(outside), []);
});
