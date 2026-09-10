import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseMusicPage,
  parseMusicSearch,
} from "../../src/assets/opengameart.js";
import {
  assetInfo,
  importAsset,
  searchAssets,
} from "../../src/assets/library.js";
const field = (name: string, body: string) =>
  `<div class="field field-name-${name} other">${body}</div>`;
const page =
  field("title", "<h2>Night &amp; Sea</h2>") +
  field("author-submitter", '<a href="/users/composer">Composer</a>') +
  field("field-art-type", "<a>Music</a>") +
  field(
    "field-art-licenses",
    "<a href='https://creativecommons.org/publicdomain/zero/1.0/'>CC0</a>",
  ) +
  field(
    "field-art-files",
    '<a href="https://opengameart.org/sites/default/files/night.ogg" type="audio/ogg; length=7" data-fid="123">Night</a>',
  ) +
  field("comments", '<a href="https://evil.example/trap.mp3">trap</a>');
test("music parser restricts licensing and file extraction to the actual entry fields", () => {
  const p = parseMusicPage("night-sea", page);
  assert.equal(p.asset.name, "Night & Sea");
  assert.equal(p.files.length, 1);
  assert.equal(p.files[0]?.key, "file-123");
  assert.throws(
    () =>
      parseMusicPage(
        "night-sea",
        page.replace("publicdomain/zero/1.0/", "licenses/by/4.0/"),
      ),
    /CC0/,
  );
  assert.throws(
    () =>
      parseMusicPage(
        "night-sea",
        page.replace(
          "https://opengameart.org/sites/default/files/night.ogg",
          "https://evil.example/night.ogg",
        ),
      ),
    /official host/,
  );
  assert.throws(
    () =>
      parseMusicPage("night-sea", page.replace("length=7", "length=999999999")),
    /No supported/,
  );
  assert.throws(
    () =>
      parseMusicPage(
        "night-sea",
        page.replace(">Music</a>", ">Sound Effect</a>"),
      ),
    /not music/,
  );
  const result = parseMusicSearch(
    '<a href="/content/faq">FAQ</a><span class="art-preview-title"><a href="/content/night-sea">Night &amp; Sea</a></span><li class="pager-next">',
  );
  assert.equal(result.results.length, 1);
  assert.equal(result.hasNext, true);
  assert.equal(result.results[0]?.id, "night-sea");
  assert.throws(
    () => parseMusicSearch("<html>Service unavailable</html>"),
    /not recognized/,
  );
});
test("music import retains provenance, supports local audio search and reuses downloaded bytes offline", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "openfun-music-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  let downloads = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (String(url).includes("/content/")) return new Response(page);
    downloads++;
    return new Response(Buffer.from("OggS123"));
  });
  const info = await assetInfo({
    provider: "opengameart",
    id: "night-sea-test",
  });
  assert.equal(info.variants[0]?.files[0], "music-123.ogg");
  const args = {
    provider: "opengameart",
    id: "night-sea-test",
    variant: "file-123",
  };
  const first = (await importAsset(cwd, args)) as any;
  assert.equal(first.cached, false);
  const receipt = JSON.parse(
    await readFile(
      join(cwd, "game", first.directory.slice(6), "asset-source.json"),
      "utf8",
    ),
  );
  assert.equal(receipt.asset.credit, "Composer");
  assert.equal(receipt.asset.license, "CC0-1.0");
  assert.equal(
    (await searchAssets(cwd, { source: "local", kind: "music" })).results
      .length,
    1,
  );
  assert.equal(
    (await searchAssets(cwd, { source: "local", kind: "audio" })).results
      .length,
    1,
  );
  assert.equal(((await importAsset(cwd, args)) as any).cached, true);
  assert.equal(downloads, 1);
});
