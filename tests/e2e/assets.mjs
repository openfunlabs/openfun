import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAsset, demoTreeRecipe } from "../../src/assets/blender.ts";
import { importAsset } from "../../src/assets/import.ts";
import { WorldStore } from "../../src/world/world.ts";
import {
  ensureGameProject,
  checkGameProject,
} from "../../src/godot/project.ts";
import {
  packWorld,
  importWorld,
  validateGlb,
} from "../../src/sharing/package.ts";
import { output } from "../helpers/paths.mjs";
const root = await mkdtemp(join(tmpdir(), "openfun-blender-"));
try {
  const world = join(root, "world"),
    other = join(root, "imported");
  WorldStore.create(world, { name: "Blender regression" }).close();
  const asset = await buildAsset(world, demoTreeRecipe);
  const file = join(world, "assets", asset.asset),
    bytes = await readFile(file);
  validateGlb(bytes);
  await importAsset(world, file);
  const game = await ensureGameProject(
    world,
    new URL("../fixtures/games/exploration-3d", import.meta.url).pathname,
  );
  await mkdir(join(game, "assets"));
  await writeFile(join(game, "assets/tree.glb"), bytes);
  await checkGameProject(world);
  const archive = join(root, "tree.openfun");
  await packWorld(world, archive);
  await importWorld(archive, other);
  assert.deepEqual(await readFile(join(other, "game/assets/tree.glb")), bytes);
  await checkGameProject(other, undefined, true);
  await mkdir(output(), { recursive: true });
  await writeFile(
    output("assets.json"),
    JSON.stringify(
      {
        passed: true,
        modelRequests: 0,
        blender: asset,
        godotImport: true,
        sharedBytesMatch: true,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
