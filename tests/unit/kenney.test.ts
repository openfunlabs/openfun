import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { parseKenneyPage, parseKenneySearch } from "../../src/assets/kenney.js";
import { importAsset, searchAssets } from "../../src/assets/library.js";
const page =
  "<h1>Test Pack</h1><a href='https://kenney.nl/assets/category:Audio'>Audio</a><a href='https://creativecommons.org/publicdomain/zero/1.0/'>CC0</a><a href='https://kenney.nl/media/pages/assets/fixture/pack.zip'>Download</a>";
test("Kenney parses real page-shaped categories and requires explicit CC0 download", () => {
  const p = parseKenneyPage("fixture", page);
  assert.equal(p.asset.kind, "audio");
  assert.match(p.url, /pack.zip/);
  assert.throws(
    () =>
      parseKenneyPage(
        "fixture",
        page.replace("creativecommons.org", "example.com"),
      ),
    /verified CC0/,
  );
  const rows = parseKenneySearch(
    "<h2><a href='https://kenney.nl/assets/tiny'>Tiny &amp; Friends</a></h2><a href='https://kenney.nl/assets/category:2D'>2D</a>",
  );
  assert.equal(rows[0]?.name, "Tiny & Friends");
  assert.equal(rows[0]?.kind, "sprites");
});
test("Kenney imports PNG and audio without extracting unsupported source files and reuses large kits offline", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "openfun-kenney-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const archive = zipSync(
    Object.fromEntries([
      ...Array.from({ length: 130 }, (_, i) => [
        `Tiles/tile_${i}.png`,
        Buffer.from("png"),
      ]),
      ["Audio/click.ogg", Buffer.from("ogg")],
      ["Source/source.ai", Buffer.from("ignored")],
    ]),
  );
  t.mock.method(globalThis, "fetch", async (url: string) =>
    url.endsWith(".zip")
      ? new Response(Buffer.from(archive))
      : new Response(page),
  );
  const p = { provider: "kenney", id: "fixture", variant: "pack" };
  const result = (await importAsset(cwd, p)) as any;
  assert.equal(result.files.length, 131);
  assert.deepEqual(result.skippedFiles, ["Source/source.ai"]);
  const receipt = JSON.parse(
    await readFile(
      join(cwd, "game", result.directory.slice(6), "asset-source.json"),
      "utf8",
    ),
  );
  assert.equal(receipt.asset.license, "CC0-1.0");
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("offline");
  });
  assert.equal(((await importAsset(cwd, p)) as any).cached, true);
  assert.equal(
    (await searchAssets(cwd, { source: "local", kind: "audio" })).results
      .length,
    1,
  );
});

test("GLB library validation allows only declared package dependencies; standalone assets still reject URIs", async () => {
  const { validateGlb } = await import("../../src/sharing/package.js");
  const doc = JSON.stringify({
    asset: { version: "2.0" },
    images: [{ uri: "Textures/colormap.png" }],
  });
  const chunk = Buffer.from(doc.padEnd(Math.ceil(doc.length / 4) * 4));
  const data = Buffer.alloc(chunk.length + 20);
  data.write("glTF");
  data.writeUInt32LE(2, 4);
  data.writeUInt32LE(data.length, 8);
  data.writeUInt32LE(chunk.length, 12);
  data.write("JSON", 16);
  chunk.copy(data, 20);
  assert.throws(() => validateGlb(data), /self-contained/);
  assert.doesNotThrow(() =>
    validateGlb(data, (uri) => uri === "Textures/colormap.png"),
  );
  assert.throws(() => validateGlb(data, () => false), /self-contained/);
});
