# OpenFun

**English** | [简体中文](README.zh-CN.md)

**OpenFun is an open-source AI game creation and runtime framework for generating an initial world (epoch0) and continuously expanding its content and assets during play.**

Describe the game you want to make, shape its initial world and rules, and let later play develop new places, characters, items, stories, and eventually mechanics. OpenFun is designed for people who have never used a game engine, while keeping the generated Godot project accessible to experienced developers.

This repository is an early feasibility prototype. The first product milestone focuses on **2D games**; the [roadmap](docs/roadmap.md) then moves toward basic 3D, richer open worlds, and more game genres.

## How it works

- **Create epoch0.** The creator defines the initial content, assets, and rules. This can be a substantial world with its own systems and progression.
- **Keep creating during play.** OpenFun uses player actions and world state to generate subsequent content and assets. Updates are discrete; the game keeps running between them.
- **Run with Godot.** Godot handles input, game logic, physics, and rendering. OpenFun manages creation, generation, and persistence around it.

The target is to make the same creative capabilities available during authoring and play. See the concise [architecture](docs/architecture.md), including why we chose Godot.

## What works today

The CLI bundles pi for conversation, model selection, and authoring. The agent edits a real Godot project; `/play` starts Godot and a local Host that queues content requests, enforces a request budget, and saves generated results and player progress.

| Available in the prototype                                   | Still ahead                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Godot authoring, including experimental 3D tools             | A dependable 2D creation and continuous generation experience             |
| Structured runtime content using existing scripts and assets | New assets and mechanics generated and activated during play              |
| Local projects, persistence, and world package import/export | Separate epoch0 releases and evolving world saves                         |
| Text model selection through pi                              | Independently configurable media providers and local multimodal inference |

Current image generation uses a specific pi/Codex integration. Providers are intended to be configurable by capability; no particular text or image model defines OpenFun. Current restrictions are documented in [configuration](docs/configuration.md) and [assets](docs/assets.md).

## Get started

You need **Node.js 22.19+**, **pnpm**, and **Godot 4**. Blender is optional for existing 3D workflows. Engines and large models are installed separately; a global pi installation is unnecessary.

Build and install from this repository:

```sh
git clone https://github.com/openfunlabs/openfun.git
cd openfun
pnpm install --frozen-lockfile
pnpm build
pnpm pack --pack-destination .output
npm install --global --ignore-scripts ./.output/openfun-<version>.tgz
openfun setup
mkdir my-world
cd my-world
openfun
```

Replace `<version>` with the version in `package.json`. The global install skips dependency scripts to prevent Context Mode from changing other clients' configuration.

Use `/model` to choose a model and `/login` when needed. OpenFun uses its own profile in `~/.openfun/agent/`. Describe your game and let the agent create it before using `/play`: a new project starts with a blank Godot scene.

| Command                        | Purpose                                           |
| ------------------------------ | ------------------------------------------------- |
| `/play`                        | Start the current game and its local Host         |
| `/play --generation-budget 24` | Set this play session's generation request budget |
| `/stop`                        | Stop the game and Host                            |
| `/world`                       | Inspect the current project                       |
| `/new`                         | Start a new conversation in the same world        |

OpenFun opens the current directory. To work on another game, exit, change directories, and run `openfun` again. See [CLI workflows](docs/implementation.md#cli-workflows) for checks, previews, packaging, and the optional polish loop.

## Documentation

- [Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md)
- [Current implementation](docs/implementation.md) · [Configuration](docs/configuration.md) · [Assets](docs/assets.md)
- [Runtime protocol](docs/runtime-protocol.md) · [World format](docs/world-format.md)
- [Contributing and tests](CONTRIBUTING.md) · [Game quality evaluation](docs/evaluation.md)

## License

OpenFun is [MIT licensed](LICENSE). Dependencies and external tools retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
