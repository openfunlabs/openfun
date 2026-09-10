# Architecture

OpenFun is one Node.js package. The CLI launches pi's native interactive session; the agent edits a world-local Godot project, and a local authenticated World Host supplies AI content and persistent state. Blender authors assets. The creator and background workers reuse the player's provider/model/thinking choice.

## Ownership

| Directory            | Responsibility                                                              |
| -------------------- | --------------------------------------------------------------------------- |
| src/agent            | pi session, bundled extensions, world tools and creation guidance           |
| src/world            | World identity, specification, SQLite state and cwd-based discovery         |
| src/generation       | Structured content jobs, 3D chunk generation and design context             |
| src/godot            | Blank project initialization, playback, validation and isolated screenshots |
| src/assets           | Blender worker invocation and GLB import                                    |
| src/sharing          | Portable world archives, resource validation and import trust               |
| src/host.ts          | Authenticated loopback HTTP and worker lifecycle                            |
| tests/fixtures/games | Source-only regression fixtures; never installed or used in creation        |
| tools/blender        | The product's constrained Python asset worker                               |

No-argument startup uses the exact invocation directory, never a parent or recent world. Each world has world.sqlite, WORLD.md, editable game/ and optional design/ notes. Native /new changes only the conversation; /world displays project information. To create or open another project, exit OpenFun and start it from the desired directory. There is no in-session world picker or project creation command. Existing project files are preserved.

## Generation and persistence

Generic /content/jobs accepts a project-defined schema, prompt and context. The worker adds bounded world/design documents and uses pi to produce structured data. Stable namespace/key pairs deduplicate work; conflicting requests are rejected, completed results persist, retries are explicit and failed requests never silently become procedural content. Project code validates reachability, difficulty and gameplay before activating a result. It should prefetch future levels and keep play responsive while waiting.

The exploration template also uses a specialized 32-meter chunk generator with boundaries and a restricted entity schema. This is separate from generic jobs because its navigation and publication rules differ. The queue starts only when /snapshot is requested. These tools do not limit the mechanics an agent can implement in Godot scripts.

/game/state stores arbitrary bounded JSON with optimistic revisions. WorldStore stores structured entities, player changes and command deduplication. Single-player movement is client-simulated; authoritative multiplayer is not implemented.

## Execution and sharing

Godot receives the Host URL and bearer token at launch. Creator credentials never belong in game files. Background workers do not load creator sessions, skills, MCP extensions or project executable tools. Full Blender MCP modeling is not yet a background asset service.

Project checks run Godot import/script validation. Preview packages and imports a temporary world, disables new-model generation, renders an actual viewport and leaves the original save unchanged. Render success does not prove controls, artistic quality or progression.

Sharing includes Godot resources, public design notes, generated content and saves. Imports validate archive paths, limits and hashes before creating a destination and never execute code. An imported executable project requires explicit trust before play, check or preview. Private author configuration, credentials, symlinks and local backups are excluded. See [runtime protocol](runtime-protocol.md) and [world format](world-format.md).

The published package includes only compiled product code, the Blender worker, the runtime protocol and legal notices. Tests, engine binaries, local worlds, historical experiments and development reports are excluded.

## Optional polish controller

`src/polish/` adds an opt-in authoring loop, separate from the gameplay content Host. A native pi command or confirmed `world_offer_polish` starts a candidate-only bundled pi worker with the world's saved model preferences. No round, duration or call cap is imposed. Completion/no-gain judgments, blockers and user interruption stop the loop; normal tool timeouts and provider quotas still apply.

The controller snapshots the candidate before each round, requires a native `world_polish_result` completion, and independently runs Godot import checks before accepting changed source. Worker reporting requires an error-free preview with returned images after the last mutation. The report is a model judgment, not a beauty score. Recent 20 reports form bounded worker context; complete reports and checkpoints remain on disk without limiting iteration count.

Only `game/` and public `design/` files are promoted; source hashes detect concurrent edits, an active Host prevents promotion, original directories are retained, and a promotion journal supports interruption recovery on explicit apply/resume. The original database and player state are never replaced by candidate state. Source formats/sizes inherit the sharing pipeline limits. Meshy task identities are retained across candidate recovery to avoid duplicate submissions; native provider credentials remain in OpenFun's own profile. Candidate isolation is not an OS sandbox for authored code or MCP tools.

`/polish stop`, user input, model changes and session shutdown stop the worker process group; an interrupted round is restored from its checkpoint on explicit resume. Restarting OpenFun never automatically resumes work. The loop uses a separate child session so the main CLI remains responsive; no standalone pi executable or new agent framework is required.

New projects start with a blank Godot Node scene, protocol guidance and generic helpers. No genre game is copied, and playback never falls back to an installed sample. An explicit user-supplied Godot project remains supported. Regression game fixtures are excluded from the npm package and product evaluation.
