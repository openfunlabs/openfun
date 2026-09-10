import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { recipeSchema, type Recipe } from "../world/schema.js";
import { projectRoot, resolveTool } from "../paths.js";

const run = promisify(execFile);
export async function buildAsset(
  worldDir: string,
  input: unknown,
  options: { blender?: string } = {},
) {
  const recipe = recipeSchema.parse(input);
  const blender = resolveTool("blender", options.blender);
  if (!blender)
    throw new Error(
      "Blender not found. Set OPENFUN_BLENDER to its executable; run openfun doctor.",
    );
  const jobDir = join(worldDir, ".openfun", "jobs", randomUUID());
  await mkdir(jobDir, { recursive: true });
  try {
    const recipePath = join(jobDir, "recipe.json"),
      output = join(jobDir, "asset.glb");
    await writeFile(recipePath, JSON.stringify(recipe));
    await run(
      blender,
      [
        "--background",
        "--factory-startup",
        "--disable-autoexec",
        "--threads",
        "2",
        "--python",
        join(projectRoot, "tools", "blender", "build.py"),
        "--",
        "--recipe",
        recipePath,
        "--output",
        output,
      ],
      { timeout: 120000, maxBuffer: 512 * 1024 },
    );
    const content = await readFile(output);
    if (
      content.length < 20 ||
      content.length > 32 * 1024 * 1024 ||
      content.toString("ascii", 0, 4) !== "glTF" ||
      content.readUInt32LE(4) !== 2 ||
      content.readUInt32LE(8) !== content.length
    )
      throw new Error("Blender did not produce a valid bounded GLB");
    const asset = `${createHash("sha256").update(content).digest("hex")}.glb`;
    await mkdir(join(worldDir, "assets"), { recursive: true });
    await rename(output, join(worldDir, "assets", asset));
    await mkdir(join(worldDir, ".openfun", "recipes"), { recursive: true });
    await writeFile(
      join(worldDir, ".openfun", "recipes", `${asset}.json`),
      JSON.stringify(recipe, null, 2),
    );
    return { asset, name: recipe.name, bytes: content.length };
  } finally {
    await rm(jobDir, { recursive: true, force: true });
  }
}

export const demoTreeRecipe: Recipe = {
  name: "林地松树",
  parts: [
    {
      shape: "cylinder",
      position: [0, 0.8, 0],
      scale: [0.3, 1.6, 0.3],
      color: "#805838",
    },
    {
      shape: "cone",
      position: [0, 2.2, 0],
      scale: [2.2, 2.8, 2.2],
      color: "#42765b",
    },
    {
      shape: "cone",
      position: [0, 3.2, 0],
      scale: [1.5, 2.2, 1.5],
      color: "#61977a",
    },
  ],
};
