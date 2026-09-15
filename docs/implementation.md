# Current implementation

This page describes the current prototype. The [architecture](architecture.md) describes the target design; the [roadmap](roadmap.md) makes 2D the next product milestone. Existing 3D experiments remain available, but runtime asset/code generation, epoch0-only publishing, multiplayer and OpenFun Cloud are not implemented yet.

## Runtime and ownership

OpenFun is one Node.js package. The CLI launches pi's native interactive session; the creator edits a world-local Godot project, and an authenticated local World Host supplies generated data and persistent state during play. Authoring tools provide image generation, asset libraries, Meshy and Blender integration. Godot and Blender are installed separately.

| Location                         | Responsibility                                                               |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `src/agent/`                     | pi sessions, bundled extensions, world tools and creation guidance           |
| `src/world/`                     | World identity, specifications, SQLite state and current-directory discovery |
| `src/generation/`                | Structured content jobs, experimental 3D chunks and bounded design context   |
| `src/godot/`                     | Blank project initialization, playback, validation and isolated diagnostics  |
| `src/assets/`                    | Images, reusable libraries, Meshy jobs, Blender invocation and GLB import    |
| `src/polish/`                    | Optional candidate-based authoring loop                                      |
| `src/sharing/`                   | Portable world archives, resource validation and import trust                |
| `src/host.ts`                    | Authenticated loopback HTTP and generation worker lifecycle                  |
| `tools/blender/`, `tools/godot/` | Bundled asset and diagnostic helpers                                         |
| `tests/fixtures/games/`          | Source-only regression fixtures, never used as generated games               |

Each world has `world.sqlite`, `WORLD.md`, an editable `game/` project and optional public `design/` notes. No-argument startup uses the exact invocation directory, never a parent or recent world. Existing project files are preserved. `/new` changes only the conversation; `/world` displays project information. To work on another project, exit OpenFun and start it from that directory.

New projects start with a blank Godot Node scene, protocol guidance and generic helpers. No genre game is copied, and playback never falls back to an installed sample. The creator can author 2D, 2.5D or 3D scenes and scripts; that flexibility is broader than the next milestone's verified 2D scope.

### Why a CLI and Host

The creator's instructions are only part of the product. `/play` also starts a Host that schedules asynchronous generation, enforces a request budget and persists results and game state. This continues without an active authoring conversation. Stopping the game/Host stops generation. The CLI integrates that lifecycle with login, project discovery and engine launch.

## Content generation and persistence

`/content/jobs` accepts a project-defined schema, prompt and context. Workers add bounded world/design documents, recent published results and the latest save in the same namespace, then use pi to produce structured data. Creator and background workers currently reuse the world's saved provider/model/thinking preference and OpenFun authentication. Background workers do not load creator sessions, skills, MCP extensions or project executable tools.

Stable namespace/key pairs deduplicate work. Conflicting requests are rejected, completed results persist, and retries are explicit. Failed requests never silently become procedural content. Published content may be prefetched or rejected: it is not assumed to have been played. Only explicit player state and observations establish what happened.

Project code defines requests, validates generated results and decides when to activate them. It should prefetch while the current content remains playable. Runtime workers currently generate JSON within implemented mechanics; they cannot author new files, call asset services or install new mechanisms. Extending that capability is a roadmap item.

An experimental 3D API separately generates 32-meter chunks with boundary constraints and a restricted entity schema. Its queue starts only when `/snapshot` is requested. These specialized structures do not constrain the scripts a creator can author in Godot.

`/game/state` stores bounded JSON with optimistic revisions. `WorldStore` also stores structured entities, player changes and command deduplication. Single-player movement is client-simulated; authoritative multiplayer is not implemented. See the [runtime protocol](runtime-protocol.md) for the implemented API and the [runtime design guide](game-design/runtime.md) for game-side integration.

Godot receives the Host URL and bearer token at launch. Provider credentials stay outside game files. Asset tools are currently authoring-time integrations; the gameplay Host does not automatically browse libraries or generate new images, models or animation clips.

## CLI workflows

From a checkout or installed CLI:

```sh
openfun create ./arena --no-chat
openfun check ./arena
openfun preview ./arena --demo
openfun play ./arena
openfun pack ./arena --output ./arena.openfun
openfun import ./arena.openfun ./shared-arena
openfun play ./shared-arena --trust-project
openfun doctor
```

`create --no-chat` initializes files without starting an authoring conversation; a blank project is not a playable game. Supply `--template /path/to/godot-project` only when you want to start from your own Godot project. The old `openfun demo` creation command is removed. `--demo` disables model requests and uses project-provided test data; it does not install a sample game.

The `preview` CLI command uses the default headless diagnostic mode. For rendered frames and scheduled visual checks, ask the creator to use `world_preview_game` with `mode: "windowed"` as described below. Model-free preview does not test live generation.

Interactive `/play --generation-budget 24` sets the current Host's AI request budget; `/stop` stops both game and Host. Configuration and defaults are documented in [configuration](configuration.md).

## Checks and previews

`openfun check` runs Godot import/script validation. `world_review_game` provides source clues, not a quality score or proof that an integration ran. Runtime continuation needs a separate check: prefetch an unseen unit during play, activate it, save, then restart with zero generation budget and recover it. Distinguish deterministic test content from actual model output.

`world_preview_game` packages/imports a temporary world, disables new AI generation and leaves the original save unchanged. Reports are written under `artifacts/previews/`. Diagnostics support up to 120 seconds, scheduled Godot actions, keys and mouse buttons. Match names to the game's actual input bindings; nonexistent actions fail explicitly.

- **Headless (default):** checks inputs, logs and observable state without a window, rendered images, audible audio or GPU measurements.
- **Windowed:** captures actual frames when visual, animation or rendered diagnostics are needed. Automated windows request no focus, pass through clicks and release mouse capture. Games should respect `OPENFUN_AUTOMATED_TEST=1` by avoiding cursor capture/warping, focus grabs and fullscreen; authored scripts can still affect OS input state.

Example tool input for an existing `attack` action:

```json
{
  "mode": "windowed",
  "seconds": 3,
  "inputs": [
    { "at": 1, "kind": "action", "name": "attack", "pressed": true },
    { "at": 1.1, "kind": "action", "name": "attack", "pressed": false }
  ],
  "captureTimes": [0.8, 1.05, 1.2, 1.5, 2.5]
}
```

Times start with scene startup; allow time for loading. Frame-interval summaries include p50/p95/p99, maximum and over-budget samples, but include scheduling and capture overhead. They do not replace target-device release-build profiling. Screenshots alone cannot prove collision correctness, natural animation, progression or enjoyable play. Use state/log checks and playtests as appropriate. See [evaluation](evaluation.md) and the [game design guides](game-design/runtime.md).

## Optional polish loop

`/polish` starts an opt-in authoring loop, separate from gameplay content generation. You can add a focus, for example `/polish improve combat feedback and level pacing`, or accept the creator's native confirmation invitation. The loop uses a separate bundled pi child session with saved model preferences. It has no round, total-duration or call-count cap; normal tool timeouts, service quotas and user constraints still apply.

The controller works in `.openfun/polish/` on a candidate copy: observe, choose a concrete improvement, edit, preview/check, then retain or restore the round. Completion, no meaningful gain, a blocker, failure or interruption stops/pauses work. Failed paid generation is not silently resubmitted.

| Command                  | Effect                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `/polish status`         | Show progress, recent reports and candidate path                                                |
| `/polish stop`           | Stop the worker and pause; does not stop gameplay                                               |
| `/polish resume [focus]` | Explicitly recover from the retained checkpoint, discarding an interrupted round                |
| `/polish apply`          | Apply a verified candidate after stopping the game, including accepted rounds from a paused run |
| `/polish discard`        | Discard the unapplied candidate and retain the original game                                    |

Ordinary chat input pauses polishing; model changes, new sessions and shutdown stop the session's worker. Restarting OpenFun never resumes it automatically. The latest 20 reports form bounded worker context; full reports and checkpoints remain on disk without limiting iteration count.

Each round has a source checkpoint and requires a native `world_polish_result`. Worker reporting requires an error-free rendered preview after the last mutation; the controller independently validates changed source with Godot. These checks do not objectively certify visual quality or fun.

Only `game/` and public `design/` files are promoted. Automatic promotion requires unchanged source, an unchanged verified candidate and a stopped game/Host; otherwise the candidate remains for explicit apply or review. Original directories are retained, and a promotion journal supports recovery on explicit apply/resume. Candidate database state never replaces the original world database, generated runtime content or saves. Save migration requires a decision before applying it.

Candidate isolation is not an OS sandbox for authored code or MCP tools. Source format/size limits come from the sharing pipeline. Meshy task identities survive recovery to prevent duplicate submissions; provider credentials remain in OpenFun's profile. Polish reports, backups and sessions do not enter sharing packages.

## Sharing and distribution

Current world archives include Godot resources, public design notes, completed generated content and saves. They do not yet separate an epoch0 release from a played world. Import validates paths, sizes and hashes before creating the destination and never executes code. Imported executable projects require explicit trust before play, check or preview. Credentials, private author configuration, symlinks and local backups are excluded. See [world format](world-format.md) for format and compatibility details.

The npm package uses an explicit file allowlist for compiled product code, Blender/Godot helpers, game-design guides, runtime protocol, READMEs and legal notices. Engine binaries, tests, personal worlds and development reports are excluded. See [CONTRIBUTING](../CONTRIBUTING.md) for development and acceptance commands.
