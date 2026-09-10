import { parseArgs } from "node:util";
import { resolve, join } from "node:path";
import { existsSync, readFileSync, mkdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { WorldStore } from "./world/world.js";
import { launchAgent, getPiCli } from "./agent/session.js";
import { buildAsset } from "./assets/blender.js";
import { packWorld, importWorld } from "./sharing/package.js";
import { projectRoot, resolveTool, saveToolConfiguration } from "./paths.js";
import { openOrCreateWorld, openfunHome } from "./world/library.js";
import { startPlayer } from "./godot/player.js";
import { importAsset } from "./assets/import.js";
import {
  checkGameProject,
  ensureGameProject,
  gameTemplateSource,
  inspectGameProject,
} from "./godot/project.js";
import { agentDirectory, bundledPlugins } from "./agent/pi-environment.js";

const HELP = `OpenFun — Create, explore, and share persistent game worlds

  openfun                         Open the current directory's game, or create one here
  openfun create <directory> [--name <name>] [--template <Godot-project>] [--no-chat]
  openfun chat <directory> [-- <agent-options>]
  openfun play <directory|file.openfun> [--demo] [--godot <path>] [--player <path>]
  openfun inspect <directory>
  openfun check <directory>        Validate the game project and scripts
  openfun preview <directory> [--demo]  Capture an isolated game preview
  openfun build-asset <directory> <recipe.json> [--blender <path>]
  openfun import-asset <directory> <file.glb>
  openfun pack <directory> --output <file.openfun>
  openfun import <file.openfun> <directory>
  openfun doctor
  openfun setup                    Discover and save engine paths

Use /model, /login, and /settings in the creator. OpenFun owns its configuration and credentials.
Example: openfun chat ./worlds/forest -- --provider openai-codex --model <model-id>
Choose your model; opening the creator does not send a model request.
Use /play to play, /world for project info, and /new for a new conversation.
To open another project, exit OpenFun and run it from that directory.
New regions are generated in the background. --demo explicitly uses offline example content.
`;

async function main() {
  const raw = process.argv.slice(2);
  const separator = raw.indexOf("--");
  const piArgs = separator >= 0 ? raw.slice(separator + 1) : [];
  const argv = separator >= 0 ? raw.slice(0, separator) : raw;
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      name: { type: "string" },
      seed: { type: "string" },
      template: { type: "string" },
      "no-chat": { type: "boolean" },
      output: { type: "string" },
      blender: { type: "string" },
      godot: { type: "string" },
      player: { type: "string" },
      "smoke-test": { type: "boolean" },
      screenshot: { type: "string" },
      headless: { type: "boolean" },
      demo: { type: "boolean" },
      "generation-budget": { type: "string" },
      "trust-project": { type: "boolean" },
    },
  });
  const [command, target, extra] = positionals;
  if (values.version) {
    console.log(
      JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"))
        .version,
    );
    return;
  }
  if (values.help) {
    console.log(HELP);
    return;
  }
  if (!command) {
    if (values.template && !inspectGameProject(process.cwd()))
      gameTemplateSource(values.template);
    const worldDir = openOrCreateWorld(process.cwd());
    await ensureGameProject(worldDir, values.template);
    process.exitCode = await launchAgent(worldDir, {
      piArgs,
    });
    return;
  }
  if (command === "doctor") {
    console.log(
      JSON.stringify(
        {
          node: process.version,
          pi: getPiCli(),
          agentDirectory: agentDirectory(),
          bundledPlugins: bundledPlugins(),
          blender: resolveTool("blender") ?? "Not found: set OPENFUN_BLENDER",
          godot: resolveTool("godot") ?? "Not found: set OPENFUN_GODOT",
          model:
            "Choose a model with /model; sign in to a provider with /login",
          multiplayer:
            "Local single-player; the Host protocol is separate from the game",
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === "setup") {
    console.log(JSON.stringify(saveToolConfiguration(), null, 2));
    return;
  }
  if (!target) throw new Error("A world directory or package is required");
  const dir = resolve(target);
  if (command === "create") {
    if (values.template) gameTemplateSource(values.template);
    const store = WorldStore.create(dir, {
      name: values.name ?? "New World",
      seed: values.seed ?? "openfun",
      description: "A game waiting for your design.",
      rules: [
        "Explored content persists, and player actions leave lasting changes.",
      ],
    });
    store.close();
    console.log(`World created: ${dir}`);
    await ensureGameProject(dir, values.template);
    if (!values["no-chat"])
      process.exitCode = await launchAgent(dir, { piArgs });
    return;
  }
  if (command === "chat") {
    const world = new WorldStore(dir);
    world.close();
    process.exitCode = await launchAgent(dir, { piArgs });
    return;
  }
  if (command === "inspect") {
    const world = new WorldStore(dir);
    try {
      console.log(JSON.stringify(world.inspect(), null, 2));
    } finally {
      world.close();
    }
    return;
  }
  if (command === "check") {
    const checked = await checkGameProject(
      dir,
      values.godot,
      values["trust-project"],
    );
    console.log(
      `${checked.engine} project validation passed: ${checked.project}\n${checked.output}`,
    );
    return;
  }
  if (command === "preview") {
    const { requireProjectTrust } = await import("./godot/project.js");
    requireProjectTrust(dir, values["trust-project"]);
    const { captureGamePreview } = await import("./godot/preview.js");
    console.log(
      JSON.stringify(
        await captureGamePreview(dir, { demo: values.demo }),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "build-asset") {
    if (!extra) throw new Error("Provide a recipe JSON file");
    const world = new WorldStore(dir);
    world.close();
    console.log(
      JSON.stringify(
        await buildAsset(
          dir,
          JSON.parse(readFileSync(resolve(extra), "utf8")),
          { blender: values.blender },
        ),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "import-asset") {
    if (!extra) throw new Error("Provide a local GLB file");
    console.log(
      JSON.stringify(await importAsset(dir, resolve(extra)), null, 2),
    );
    return;
  }
  if (command === "pack") {
    if (!values.output) throw new Error("Use --output file.openfun");
    console.log(
      JSON.stringify(await packWorld(dir, resolve(values.output)), null, 2),
    );
    return;
  }
  if (command === "import") {
    if (!extra) throw new Error("Provide a destination directory");
    console.log(
      JSON.stringify(await importWorld(dir, resolve(extra)), null, 2),
    );
    return;
  }
  if (command === "play") {
    let worldDir = dir;
    if (dir.endsWith(".openfun")) {
      const imports = join(openfunHome(), "saves");
      mkdirSync(imports, { recursive: true });
      if (statSync(dir).size > 64 * 1024 * 1024)
        throw new Error("World package exceeds the 64 MiB limit");
      const packageHash = createHash("sha256")
        .update(readFileSync(dir))
        .digest("hex");
      worldDir = join(imports, packageHash);
      if (!existsSync(worldDir)) await importWorld(dir, worldDir);
    }
    console.log(`Opening world: ${worldDir}`);
    const player = await startPlayer(worldDir, {
      trustProject: values["trust-project"],
      player: values.player,
      godot: values.godot,
      headless: values.headless,
      smokeTest: values["smoke-test"],
      screenshot: values.screenshot,
      host: {
        generationMode: values.demo ? "demo" : "ai",
        ...(values["generation-budget"] !== undefined
          ? {
              generation: { maxNewChunks: Number(values["generation-budget"]) },
            }
          : {}),
      },
    });
    const interrupt = () => {
      void player.stop().catch(() => undefined);
    };
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", interrupt);
    try {
      process.exitCode = await player.completion;
    } finally {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", interrupt);
    }

    return;
  }
  throw new Error(`Unknown command: ${command}\n${HELP}`);
}
main().catch((error) => {
  console.error(
    `OpenFun: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
