import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, unlinkSync } from "node:fs";
import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { assetCreationGuidance } from "../agent/creation-guidance.js";
import { projectRoot, resolveTool } from "../paths.js";
import type { GameProject } from "./project-types.js";

export function inspectProjectDirectory(
  project: string,
): GameProject | undefined {
  if (existsSync(project) && !lstatSync(project).isDirectory())
    throw new Error(
      "Game project must be a local directory, not a symbolic link",
    );
  const requireEntry = (entry: string) => {
    let path = project;
    const parts = entry.split("/");
    for (let index = 0; index < parts.length; index++) {
      path = join(path, parts[index]!);
      if (!existsSync(path))
        throw new Error(`Game entry does not exist: ${entry}`);
      const stat = lstatSync(path);
      if (
        stat.isSymbolicLink() ||
        (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())
      )
        throw new Error(
          `Game entry must be a regular local file without symbolic links: ${entry}`,
        );
    }
  };
  if (existsSync(join(project, "openfun.runtime.json")))
    throw new Error(
      "Runtime descriptors are unsupported; use a Godot project.",
    );
  if (existsSync(join(project, "project.godot"))) {
    requireEntry("project.godot");
    return { engine: "godot", project, entry: "project.godot" };
  }
  return undefined;
}

export function inspectGameProject(worldDir: string): GameProject | undefined {
  return inspectProjectDirectory(join(resolve(worldDir), "game"));
}

/** A world's editable game is independent of OpenFun's installed player. */
export function gameProject(worldDir: string): string | undefined {
  return inspectGameProject(worldDir)?.project;
}

/** Only an explicitly supplied user project can be used as a starting point. */
export function gameTemplateSource(template: string): string {
  const source = resolve(template);
  if (!inspectProjectDirectory(source))
    throw new Error(`Game template must contain project.godot: ${source}`);
  return source;
}

export async function ensureGameProject(
  worldDir: string,
  template?: string,
): Promise<string> {
  const directory = join(resolve(worldDir), "game");
  const existing = inspectGameProject(worldDir);
  if (existing) return directory;
  if (existsSync(directory))
    throw new Error(
      `${directory} exists without project.godot. Complete the project or choose another game directory; existing files have been preserved.`,
    );
  await mkdir(worldDir, { recursive: true });
  const staging = join(resolve(worldDir), `.openfun-game-${randomUUID()}`);
  const source = template ? gameTemplateSource(template) : undefined;
  try {
    if (source) {
      await cp(source, staging, {
        recursive: true,
        filter: (file) =>
          !relative(source, file)
            .split(/[\\/]/)
            .some((part) => part.startsWith(".")),
      });
    } else {
      await mkdir(staging);
      await writeFile(
        join(staging, "project.godot"),
        'config_version=5\n\n[application]\nconfig/name="Untitled Game"\nrun/main_scene="res://main.tscn"\n\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n',
      );
      await writeFile(
        join(staging, "main.tscn"),
        '[gd_scene format=3]\n\n[node name="Game" type="Node"]\n',
      );
    }
    await writeFile(
      join(staging, "OPENFUN.md"),
      `# Editable OpenFun game\n\nThis world's runtime is godot. Develop a complete, cohesive first version from the user's request: story and characters where appropriate, intentional art direction, satisfying controls and feedback, an evolving gameplay loop, and persistent progress. Small prompts do not mean the user asked for a throwaway demo. The default project is intentionally blank: no predefined game, camera, genre, artwork or mechanics. Create the actual game from the player’s request.\n\nRead ../WORLD.md and relevant plain Markdown notes under ../design/ and DESIGN.md. Use normal conversation and the player's installed pi extensions to clarify or plan when needed. Follow a request to proceed directly. Implement agreed features in actual code and assets, then inspect real gameplay and screenshots and refine the result. Follow the required image-generation workflow below, saving usable assets under game/assets/.\n\n${assetCreationGuidance}\n\nGodot projects receive --host=URL and --token=TOKEN after the -- separator. Use AI content jobs for future regions/levels and validate gameplay invariants before activation; use stable keys and saves for revisits.\n\nopenfun check .. validates source loading/syntax; /play starts this game. world_preview_game captures an isolated real preview for visual review. Parsing alone does not prove gameplay or visual quality. See OPENFUN_PROTOCOL.md for generation and state APIs.\n`,
    );
    await cp(
      join(projectRoot, "docs", "runtime-protocol.md"),
      join(staging, "OPENFUN_PROTOCOL.md"),
    );
    await cp(
      join(projectRoot, "tools", "godot", "death_lifecycle.gd"),
      join(staging, "openfun_death_lifecycle.gd"),
      { force: false },
    );
    await cp(
      join(projectRoot, "tools", "godot", "mesh_materials.gd"),
      join(staging, "openfun_mesh_materials.gd"),
      { force: false },
    );
    await rename(staging, directory);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return directory;
}

export function requireProjectTrust(
  worldDir: string,
  trustProject = false,
): void {
  const marker = join(resolve(worldDir), ".openfun", "imported-project.json");
  if (!existsSync(marker)) return;
  if (!trustProject)
    throw new Error(
      "This imported game contains executable project code. Review game/ first, then use /play --trust-project or openfun play <directory> --trust-project to run it on your computer.",
    );
  unlinkSync(marker);
}

export async function checkGameProject(
  worldDir: string,
  godot?: string,
  trustProject = false,
) {
  requireProjectTrust(worldDir, trustProject);
  const info = inspectGameProject(worldDir);
  if (!info) throw new Error("This world has no game/project.godot yet");
  const { project, engine } = info;
  if (!lstatSync(project).isDirectory())
    throw new Error("The game project must be a local directory");
  const executable = resolveTool("godot", godot);
  if (!executable)
    throw new Error("Godot not found. Install Godot 4 or set OPENFUN_GODOT.");
  return new Promise<{ engine: "godot"; project: string; output: string }>(
    (resolveCheck, reject) => {
      const child = spawn(
        executable,
        ["--headless", "--path", project, "--import"],
        {
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, 45000);
      const collect = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-1024 * 1024);
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (
          timedOut ||
          code !== 0 ||
          /SCRIPT ERROR:|Parse Error:|Failed to load script|^ERROR:/m.test(
            output,
          )
        ) {
          reject(
            new Error(
              `Godot project validation failed${timedOut ? " (timeout)" : ""}:\n${output}`,
            ),
          );
        } else resolveCheck({ engine, project, output });
      });
    },
  );
}
