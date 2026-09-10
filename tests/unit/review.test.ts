import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { reviewGameProject } from "../../src/godot/review.js";

test("review distinguishes missing art/integration from unverified source candidates", (t) => {
  const root = mkdtempSync(join(tmpdir(), "openfun-review-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "game"));
  const initial = reviewGameProject(root);
  assert.ok(initial.nextChecks.some((s) => s.includes("No authored media")));
  assert.ok(
    initial.nextChecks.some((s) => s.includes("No literal OpenFun generation")),
  );
  writeFileSync(
    join(root, "game", "main.gd"),
    "extends Node\n# /content/jobs /game/state",
  );
  writeFileSync(join(root, "game", "hero.glb"), "inventory fixture only");
  const next = reviewGameProject(root);
  assert.deepEqual(next.generationSourceCandidates, ["game/main.gd"]);
  assert.deepEqual(next.persistenceSourceCandidates, ["game/main.gd"]);
  assert.equal(next.assets.count, 1);
  assert.match(next.limitations, /comments or unused code/);
  assert.equal(next.kind, "source-inventory-not-quality-certification");
});

test("review skips symlinked directories and bounds source reads", (t) => {
  const root = mkdtempSync(join(tmpdir(), "openfun-review-bounds-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "outside"));
  writeFileSync(join(root, "outside", "secret.gd"), "/content/jobs");
  symlinkSync(join(root, "outside"), join(root, "game"), "dir");
  assert.equal(reviewGameProject(root).scripts, 0);
  rmSync(join(root, "game"));
  mkdirSync(join(root, "game"));
  symlinkSync(join(root, "outside"), join(root, "game", "linked"), "dir");
  writeFileSync(join(root, "game", "huge.gd"), "x".repeat(256 * 1024 + 1));
  const review = reviewGameProject(root);
  assert.equal(review.truncated, true);
  assert.deepEqual(review.generationSourceCandidates, []);
});

test("review surfaces missing references and lists candidates without certifying their use", (t) => {
  const root = mkdtempSync(join(tmpdir(), "openfun-reference-review-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.ok(
    reviewGameProject(root).nextChecks.some((s) =>
      s.includes("No local reference"),
    ),
  );
  mkdirSync(join(root, "game", "assets", "references"), { recursive: true });
  writeFileSync(
    join(root, "game", "assets", "references", "camera.png"),
    "fixture",
  );
  const result = reviewGameProject(root);
  assert.deepEqual(result.referenceImageCandidates, [
    "game/assets/references/camera.png",
  ]);
  assert.ok(!result.nextChecks.some((s) => s.includes("No local reference")));
  assert.match(result.limitations, /require visual inspection/);
});

test("review flags potential coded art without treating legitimate geometry as proven violations", (t) => {
  const root = mkdtempSync(join(tmpdir(), "openfun-coded-art-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "game"));
  writeFileSync(
    join(root, "game", "hero.gd"),
    "extends Node2D\nfunc _draw():\n draw_circle(Vector2.ZERO, 12, Color.RED)",
  );
  writeFileSync(
    join(root, "game", "layout.gd"),
    "extends Control\nvar label = Label.new()",
  );
  const review = reviewGameProject(root);
  assert.deepEqual(review.codedArtCandidates, ["game/hero.gd"]);
  assert.ok(
    review.nextChecks.some((s) =>
      s.includes("literal matches alone do not prove a violation"),
    ),
  );
});

test("review includes resource-defined UI decoration, generated UI provenance and music without certifying integration", (t) => {
  const root = mkdtempSync(join(tmpdir(), "openfun-ui-review-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "game", "assets", "ui");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(root, "game", "theme.tres"),
    '[sub_resource type="StyleBoxFlat" id="Panel"]',
  );
  writeFileSync(join(dir, "panel.png"), "fixture");
  writeFileSync(
    join(dir, "panel.png.source.json"),
    JSON.stringify({ tool: "world_generate_image", purpose: "ui" }),
  );
  writeFileSync(join(root, "game", "music.mp3"), "fixture");
  const report = reviewGameProject(root);
  assert.deepEqual(report.uiCodeCandidates, ["game/theme.tres"]);
  assert.equal(report.uiTextureCandidates.length, 1);
  assert.equal(report.generatedUiReceipts.length, 1);
  assert.deepEqual(report.audioCandidates, ["game/music.mp3"]);
  assert.ok(
    report.nextChecks.some((s) => s.includes("do not certify visible use")),
  );
  assert.ok(report.nextChecks.some((s) => s.includes("loop seams")));
});
