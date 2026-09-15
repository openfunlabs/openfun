# Developing OpenFun

Use Node.js 22.19+ and the pnpm version pinned in `package.json`. OpenFun is a single package; do not introduce Bun or install a separate global pi.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm format:check
pnpm test:e2e
```

`check` includes TypeScript checking, unit/integration tests and a clean build. Ordinary tests make no model calls; Host and plugin tests need loopback ports. `test:e2e` requires local Godot and Blender and covers installed entry points, pi extensions, gameplay, assets and rendering. Configure tools with `OPENFUN_GODOT`, `OPENFUN_BLENDER` or `openfun setup`. Use `pnpm test:e2e -- --cli /path/to/openfun` to check a specific installed entry point.

## Repository structure

See [current implementation](docs/implementation.md) for module ownership. The [architecture](docs/architecture.md) and [roadmap](docs/roadmap.md) describe the target rather than claiming it is already implemented. The next milestone is 2D; existing 3D/Meshy experiments are retained without being the current product focus.

Builds compile only `src/` into `dist/`. The npm `files` allowlist includes product helpers, game-design guides, runtime protocol, READMEs and legal notices; tests and engine binaries are excluded. Resolve runtime resources from the package root and test resources from the test module, never a developer-specific path. Keep the English and Chinese README in sync when changing public behavior.

`tests/fixtures/games/` contains engineering regression games only. New projects start blank; fixtures are never copied into creation or used to impersonate product-generated output. Product-quality evaluation follows [evaluation](docs/evaluation.md), separately from engineering tests.

Keep test output in `.output/` and ordinary test worlds in system temporary directories. Install engines outside the repository, preferably under `~/.openfun/tools/`, and keep personal games in their own directories. Do not commit models, virtual environments, installation archives, personal sessions, credentials or experimental logs. Update the relevant topic document instead of adding a report for each internal test.

Use a short-lived branch and independent worktree. Run checks appropriate to the change and report model/engine validation separately. Commit and PR operations follow the user's authorization; preserve existing player projects and uncommitted work.

## Live model acceptance

Live tests are explicit and separate from ordinary CI. Choose the scenario, provider and model:

```sh
pnpm test:live creation <provider> <model>
pnpm test:live chunks <provider> <model> <new-world-directory>
pnpm test:live levels --run-live --world=<new-directory> --provider=<provider> --model=<model>
```

These consume model quota and do not run in default CI. Once live generation is authorized, use relevant real acceptance tests within that authorization and budget. Retain task IDs so polling, timeouts or download retries do not create duplicate paid jobs. Creation, chunks and levels cover different paths; never label injected test data as model output.

For a game with continuous generation, exercise unseen content during play, activation, saving and zero-budget restart/recovery. Source checks and previews alone do not test that path. See the [runtime guide](docs/game-design/runtime.md).

## Asset integration acceptance

Public-service tests do not request model inference or paid generation:

```sh
pnpm test:live library .output/library-live
pnpm test:live resources .output/resources-live
```

`library` checks Poly Haven/ambientCG search and import, textured glTF/material resources and offline reuse. `resources` checks Kenney sprites/audio/3D packs and indexed design-reference retrieval. Downloaded assets stay in the chosen output directory. Inspect actual resources in Godot before claiming visual quality; confirm sprite filtering, GLB texture dependencies and audio decoding. Successful loading does not establish enjoyable gameplay.

Paid image/Meshy test commands and recovery rules are documented in [assets](docs/assets.md).

### Experimental 3D animation acceptance

Generate and inspect a character reference, then query `world_animation_library` for real attack, hit and death action IDs. With the corresponding Meshy generation authorized:

```sh
pnpm test:live animation <world-directory> <existing-model-key> <revision-prefix> <attack-ID> <hit-ID> <death-ID>
```

Artifacts and usage receipts are stored under that world's `artifacts/animation/`. Use `tools/godot/animation_probe.gd` to inspect imported skeletons, clip lengths and frames, then verify normal-speed transitions in the game. The probe requires rendered output and a JSON configuration such as:

```json
{
  "clips": [
    { "label": "death", "resource": "res://assets/generated/example.glb" }
  ],
  "output": "/absolute/output"
}
```

Launch Godot with `--path <game> --script <absolute-probe-path> -- <absolute-config-path>`. A successful download or skeleton check is not animation-quality validation. See the [animation guide](docs/game-design/animation.md) for death presentation, retargeting, sprite workflows and material recovery helpers.

The deterministic `node --import tsx tests/e2e/death-animation.mjs --visual` test captures lethal-hit, fall, rest, fade and cleanup stages with Godot; it makes no paid model calls and does not demonstrate production artwork.

## Automated diagnostics

Prefer headless Godot for functional checks. Headless mode does not verify rendered art, visible animation, audible audio or GPU performance. Use `world_preview_game` with `mode: "windowed"` when rendered checks are needed and record what was actually verified. Windowed diagnostics request no focus and release mouse capture; game code should respect `OPENFUN_AUTOMATED_TEST=1`. Use short meaningful cases and an isolated rendering display when available. Normal user-requested play remains interactive.

See [preview behavior](docs/implementation.md#checks-and-previews) for scheduled input examples and measurement limits. Passing engineering tests does not prove that a game looks good or is fun.
