# OpenFun

**English** | [简体中文](README.zh-CN.md)

**OpenFun is an open-source AI game creation and runtime framework for generating an initial world and continuously expanding its content and assets during play.**

Describe the game you want to make, shape its initial world and rules, and let later play develop new places, characters, items, stories, and eventually mechanics. OpenFun is friendly to both people who have never used a game engine and experienced game developers.

[Installation](#installation) · [Usage](#usage) · [Architecture](#architecture) · [Roadmap](#roadmap)

## Installation

You need **Node.js 22.19+** and, for the current version, **Godot 4**. The agent runtime is bundled.

One-command installation is planned once the npm package is published:

```sh
npm install -g --ignore-scripts openfun
```

The package is not published to npm yet. Use the source installation below for now.

<details>
<summary>Install from source</summary>

Install pnpm, then run:

```sh
git clone https://github.com/openfunlabs/openfun.git
cd openfun
pnpm install --frozen-lockfile
pnpm pack --out .output/openfun.tgz
npm install -g --ignore-scripts ./.output/openfun.tgz
```

Packing also builds the project. Skipping dependency install scripts prevents them from changing other clients' configuration.

</details>

## Usage

```sh
openfun setup
mkdir my-world
cd my-world
openfun
```

Use `/login` to sign in and `/model` to choose a model. Describe your game, create its initial world, and use `/play` to open the game window.

| Command                        | Purpose                                      |
| ------------------------------ | -------------------------------------------- |
| `/play`                        | Start the game and local generation service  |
| `/play --generation-budget 24` | Set this session's generation request budget |
| `/stop`                        | Stop the game and generation service         |
| `/world`                       | Inspect the current project                  |
| `/new`                         | Start a new conversation in the same world   |

OpenFun uses the current directory as the world. To switch projects, exit, change directories, and run `openfun` again.

<details>
<summary>Configuration and advanced commands</summary>

- **Models and login:** OpenFun keeps its own profile in `~/.openfun/agent/`; use `OPENFUN_HOME` to change the data root. Authoring and background generation currently use the world's saved model preference. The built-in image tool currently uses OpenFun's Codex login with a Codex conversation model; independent media providers are part of the design below.
- **Tools:** `openfun setup` saves discovered engine paths. Set `OPENFUN_GODOT` for an explicit engine path. Use `/mcp` for MCP services and `/ctx-stats` for Context Mode. Defaults can be configured in `~/.openfun/plugins.json`; the asset-library extension is currently controlled by `assets3d`.
- **Budget:** The default is 12 generation requests per play session, with a range of 0–100. Failed attempts count; zero allows reuse of saved content without new requests.
- **Diagnostics:** `openfun doctor` checks configuration. `/about` shows runtime versions. Use `openfun -- --verbose` for detailed startup output.

Standalone project commands:

```sh
openfun create ./arena --no-chat
openfun check ./arena
openfun preview ./arena --demo
openfun play ./arena
openfun pack ./arena --output ./arena.openfun
openfun import ./arena.openfun ./shared-arena
openfun play ./shared-arena --trust-project
```

Creation starts from a blank project; `--template /path/to/project` selects your own starting project. Current world packages contain the project, generated content, and saves. Imported executable projects require explicit trust. Credentials are excluded from sharing.

Checks and previews make no new model requests. Previews are headless by default; ask the agent to use `world_preview_game` with `mode: "windowed"` for actual rendered frames. Previewing is separate from verifying generation, activation, saving, and recovery during play.

For optional continued refinement, use `/polish [focus]`. Inspect with `/polish status`, pause with `/polish stop`, resume with `/polish resume`, or discard with `/polish discard`. The loop has no fixed round or time limit. It works on a candidate copy, and applying it with `/polish apply` requires a stopped game. Existing saves are preserved.

</details>

## Architecture

The design centers on **content, assets, and a game engine**. The goal is to make the same creative capabilities available during authoring and play.

![OpenFun architecture](docs/diagrams/architecture.png)

| Part            | Responsibility                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------- |
| **Content**     | Fixed rules, expandable world entries, and records of what happened during play                |
| **Assets**      | Images, sprites, tiles, video, music, sound, 3D models, and reusable scenes composed from them |
| **Game engine** | Input, simulation, game state, physics, rendering, and activation of prepared updates          |

### Content: fixed rules and an evolving world

Rules belong to Content, with a clear separation between what generation must preserve and what it can expand.

![Content: fixed core, world entries, and play history provide context for generation](docs/diagrams/content.png)

| Part              | What it contains                                                                             | How it changes                                                         |
| ----------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Fixed core**    | Core world principles, foundational rules, and limits on future generation                   | Defined by the creator at epoch0; ongoing generation cannot rewrite it |
| **World entries** | Places, characters, items, quests, stories, and permitted mechanics with their behavior code | Created at epoch0, then expanded or updated within the fixed rules     |
| **Play history**  | Events that happened, player choices, and accepted world changes                             | Recorded as play progresses; unplayed drafts are not history           |

Inspired by [SillyTavern's World Info](https://docs.sillytavern.app/usage/core-concepts/worldinfo/), generation uses a persistent core plus relevant entries selected for the current situation. OpenFun's design combines the fixed core, relevant world entries and history, and current engine state as context for each generation task.

Gameplay rules are enforced by code and validation as well as described to the model. New mechanics must stay within the fixed core; a creator can deliberately revise that core in a new release. Live state such as health and position remains the responsibility of the engine and saves.

### Assets: media and reusable scenes

Assets include both individual media resources and **scenes (Scene)** built by combining them.

![Assets: media combine into character scenes, map regions, and larger nested scenes](docs/diagrams/assets.png)

- **Media:** images, including illustrations, sprites, textures, tiles, and animation frames; video; music and sound effects; and 3D models.
- **Scenes:** reusable compositions that reference media and other scenes, define their layout and hierarchy, and connect to behavior logic from Content.

For example, a character's body, outfit, animations, and footsteps can form a character scene. Terrain, trees, buildings, and character scenes can form a map region. Multiple regions can form a larger scene, reusing the same assets along the way. Scenes retain these parts and relationships; they are more than a combined image. Each scene instance has its own runtime state managed by the engine.

### Initial world and ongoing generation

The creator defines the content, assets, and rules of **epoch0**, including constraints for future development. This can be an entire playable world.

During play, player actions and world state inform later updates: generate content and assets, prepare and validate them, activate them at a suitable point, then persist the results. These updates form later epochs; they can happen independently and reuse unchanged content. The engine keeps running between updates.

Games can organize maps in different ways, such as separate platforming levels or connected regions in an open world. When adding a new mechanic, existing gameplay and saves should keep working. OpenFun keeps track of content prepared for later and what the player has already experienced. Returning to an area or loading a save preserves the existing world and the player's progress.

Publishing is designed around an epoch0 release. Each playthrough creates an evolving world instance with its own later content and saves. A multiplayer instance shares accepted updates and an authoritative world state.

### Agent, engine, and models

The **current agent is built on pi, and the current game runtime uses Godot**. Godot's [MIT license](https://godotengine.org/license/), compact node/scene structure, and [runtime resource loading](https://docs.godotengine.org/en/stable/tutorials/export/exporting_pcks.html) make it a practical starting point. Future versions may migrate to or support other engines as the project develops.

Text models produce content, logic, and generation instructions. New media assets come from image, video, audio, and 3D generation models; suitable existing assets can also be reused. Code handles logic, layout, collision, and integration.

The design supports configuring providers by capability, including local and cloud models. No particular text or media model defines OpenFun. Generation can work ahead of play to balance latency, quality, and cost.

## Roadmap

| Stage                             | Target experience                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **2D games**                      | Games in the style of Terraria and Stardew Valley that generate new regions, monsters, items, assets, and stories during play        |
| **Basic 3D games**                | Minecraft-like worlds with new map chunks, monsters, and items, supported by streaming, spatial interaction, and a 3D asset pipeline |
| **High-quality open-world games** | Long-term ambition toward the scale, systemic depth, and presentation of games such as Fallout and GTA                               |

Expand toward roguelites, platformers, card games, and other genres as the foundation matures. Each stage should demonstrate enjoyable play, consistent world state, reliable recovery, and manageable generation costs.

### Local inference

Work toward user-configurable, locally runnable **diffusion models for text, images, video, audio, and 3D** to lower the ongoing cost of play. Adoption depends on model availability, hardware, latency, and quality; cloud providers remain an option.

### OpenFun Cloud

**OpenFun Cloud is the planned UGC platform for creating, publishing, sharing, and playing continuously evolving AI games.**

- Publish, discover, and remix epoch0 releases with their initial content, assets, and rules.
- Host persistent worlds and multiplayer sessions with shared generation results.
- Provide managed inference for hosted games, including cloud multiplayer.
- Enable mobile creation and play through cloud rendering, with attention to latency, touch controls, bandwidth, and GPU cost.

Cloud services can develop alongside 2D and 3D support. Cloud rendering and model inference are separate capabilities.

## Development

<details>
<summary>Build, test, and internal references</summary>

Use Node.js 22.19+ and the pnpm version pinned in `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm format:check
```

`check` runs type checking, unit/integration tests, and the build. It makes no model calls. Engine acceptance tests and live model tests run separately; model tests consume quota.

Keep personal worlds outside the repository and test output in `.output/`. Keep both READMEs in sync. Runtime protocol and game-design guides remain internal resources used by the agent; [world format](docs/world-format.md) and [evaluation](docs/evaluation.md) are developer references.

</details>

## License

OpenFun is [MIT licensed](LICENSE). Dependencies retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
