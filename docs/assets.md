# Assets

The next product milestone focuses on 2D games. The prototype already includes image generation, reusable asset libraries and experimental Meshy/Blender workflows. Meshy remains available; separating 3D tools from the common asset extension is future work. These tools run during authoring and polish, not in the gameplay Host's background content jobs.

## Asset workflow

1. Establish a coherent camera, palette and style. For a new game, generate and inspect a gameplay visual target; user references can guide it.
2. Inspect `game/assets/` and search suitable libraries. Reuse a coherent kit, then generate missing or distinctive sprites, backgrounds, portraits and UI artwork. Existing approved assets do not need regenerating on every edit or future level.
3. Integrate actual resources in Godot. Code implements gameplay, native text/layout, scene assembly, collision, animation and supporting effects. Hand-coded SVG, pixel arrays and primitive-assembled characters/props do not replace finished production artwork. Temporary greyboxes remain explicitly unfinished.
4. Record source paths, art decisions and actual uses in `design/art.md`. Check the game from its real camera, including scale, animation, readability and interaction.

When image generation is unavailable, report the actual configuration, login or quota blocker and continue suitable greybox/mechanic work. Do not silently switch providers, claim an image was generated or present greyboxes as finished art. Existing authorization and explicit user budgets/local-only constraints govern external generation; individual workflow stages do not erase that authorization.

Source review only supplies clues: it cannot prove provenance or artistic quality. Inspect receipts, files and their visible use in the game. See the [animation](game-design/animation.md), [UI](game-design/ui.md), [audio](game-design/audio.md) and [performance](game-design/performance.md) guides for integration and acceptance.

## Image generation

`world_generate_image` is a native pi extension. It currently requires a conversation model with the Codex Responses API and OpenFun's own Codex login. It sends a hosted image-tool request to the subscription endpoint, without launching Codex CLI, copying local pi credentials, changing the conversation model or falling back to a separately billed API. Arbitrary image providers are a target design capability, not an implemented common interface.

Use `/login` inside OpenFun, select a Codex model with `/model`, then ask for the needed art. Current code defaults to `gpt-image-2.5-sunburst`; `imageModel` can explicitly select `gpt-image-2.5-flare` or `gpt-image-2`. These describe the existing integration, not a product-wide model recommendation. Access depends on the service/account, and a rejected model is not silently downgraded.

| Parameter    | Purpose                                                                         |
| ------------ | ------------------------------------------------------------------------------- |
| `prompt`     | Describe the desired visual or edit                                             |
| `references` | Up to five PNG/JPEG/WebP files inside the current project, at most 24 MiB total |
| `size`       | Requested dimensions; returned PNG dimensions are authoritative                 |
| `imageModel` | Explicit supported image-tool model selection                                   |
| `purpose`    | Use `ui` for reusable text-free game UI artwork                                 |

Copy outside references into the project first. Results are new files under `game/assets/generated/<uuid>.png`, with actual path, dimensions and byte count returned for inspection. Source receipts record the requested model and purpose. Existing files are not overwritten, and resources/receipts can be shared with the game. Set `images: false` in `plugins.json` to disable the bundled extension.

The transport retains completed image bytes even if the terminal summary omits them, but saves only after successful response completion. Partial previews are not final assets. Errors return bounded, credential-redacted diagnostics; failures, limits and timeouts do not automatically retry. Calls consume subscription quota. This subscription integration is not a general provider API contract.

Explicit live verification consumes subscription quota:

```sh
pnpm test:live images <codex-model>
# Optional reference filename inside .output/image-live:
pnpm test:live images <codex-model> concept.png
```

### UI skins and dynamic content

New-game UI uses generated, text-free panels, button surfaces, borders, icons and bar textures through `purpose: "ui"`. Apply the actual skin to native Godot controls; text, values, localization, input and layout remain dynamic. Use Theme/StyleBoxTexture for scalable panels, TextureButton for fixed shapes and TextureProgressBar where appropriate.

Keep reusable UI assets under `game/assets/ui/` and retain their generated originals. Record slice margins, text-safe areas and control-state mappings in `design/art.md`. Verify actual alpha, long text, target resolutions and hover/pressed/disabled/focus states. A concept image alone is not integrated UI. The prototype does not provide an automatic atlas-cutting or background-removal service. See the [UI guide](game-design/ui.md).

## Reusable asset libraries

Three bundled tools search and import reusable assets without model requests or generation credits:

- `world_search_assets`: select `source`, English keywords for online catalogs, `kind`, `limit` and `offset`. `local` searches imported library receipts, not every local file or visual similarity.
- `world_asset_info`: pass the returned `provider`/`id`; inspect source/license, variants and available size information.
- `world_download_asset`: pass the same provider/id and the exact returned `variant`. Resources and supported dependencies are imported under `game/assets/library/`; the tool does not create gameplay scenes.

| Source        | Current integration                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `local`       | Project library receipts and offline reuse                                                                                            |
| `kenney`      | Public-page adapter for CC0 sprites, tile sets, UI, audio, models and textures; use the returned `pack` variant and pagination offset |
| `opengameart` | Public-page adapter for CC0-filtered music; use `kind: "music"` and an individual OGG/MP3/WAV variant                                 |
| `polyhaven`   | Official HTTP API for CC0 models, PBR maps and HDRIs; textured glTF dependencies are imported together. Powered by Poly Haven.        |
| `ambientcg`   | Public HTTP API for CC0 materials and HDRIs, including material ZIP variants                                                          |

Kenney/OpenGameArt adapters are not official APIs. They require verified license information and may need maintenance if website markup changes. OpenGameArt does not import ZIP-only albums. Kenney imports supported PNG/JPEG, audio, GLB/glTF and textures, resolves local dependencies and reports unsupported editor sources, formats and web shortcuts. It does not install starter-kit code or guarantee that a character pack contains attack/death animations. Inspect actual frames and directions.

For Poly Haven models, prefer a small glTF variant such as `gltf/1k/gltf` when offered. Other PBR variants may be individual maps. ambientCG material ZIPs contain texture sets; optional Blender/USD/MaterialX and material-definition files are skipped and reported. Build the Godot material from the imported maps.

Imports include `asset-source.json` and `ASSET-LICENSE.md` with provider, source URL, license, variant and hashes. They accompany shared resources. Repeat imports verify files and work offline; customized files are preserved instead of overwritten. Keep modifications in separate copies. Metadata is cached for an hour in the creator process, while downloads are reused within each project across sessions; there is no global asset cache.

Downloads are bounded to 32 MiB per file and 64 MiB per selected asset. ZIPs allow up to 32 MiB compressed, 64 MiB expanded and 512 imported resources. The sharing/preview pipeline separately permits 4,000 game resources and 4,096 archive entries including metadata, with resource bytes capped at 96 MiB and single resources at 32 MiB. Normal archive limits also apply. Select an appropriate kit or smaller variant and retain provenance. See [world format](world-format.md).

Godot scale, sprite filtering, materials, collision, polycount, lighting and audio still need inspection. Library music requires auditioning and loop/transition checks, not just downloading. Incompetech and itch.io are browser research sources, not native integrations. Commercial subscriptions and paid packs are not interchangeable with CC0; OpenFun's MIT license does not relicense artwork or grant permission to redistribute paid source assets.

Public-service validation commands are documented in [CONTRIBUTING](../CONTRIBUTING.md#asset-integration-acceptance). They download only into the chosen test directory, not the published package.

## Experimental 3D generation and processing

The retained Meshy pipeline uses direct HTTP APIs and project-local task records; no Meshy CLI or separate MCP server is required. Blender supports refinement and integration. The next 2D milestone does not remove these capabilities or change old assets and tasks.

Use `/login meshy` or `MESHY_API_KEY`. Meshy consumes separate API credits, outside Codex subscription quota. Credentials stay in OpenFun's profile and do not appear in tool parameters. Tripo key storage is available through `/login tripo`, but generation is not integrated. See [configuration](configuration.md#asset-service-credentials).

| Tool                      | Workflow                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `world_generate_model`    | Submit exactly one local PNG/JPEG `reference` or text `prompt`, with a stable revision `key`                              |
| `world_model_status`      | Query that key once and download completed self-contained GLB resources; querying does not submit a new paid generation   |
| `world_process_model`     | `refine`, `retexture`, `rig` or `animate`, using a new key per stage and a completed `sourceKey` or supported local model |
| `world_animation_library` | Query real action IDs before animation; uses Meshy login without generation credits                                       |

Reference-image tasks generate textured models; text tasks produce an untextured preview that needs a separately billed `refine` stage. Images are uploaded to Meshy, capped at 20 MiB. Current defaults request Meshy 7, PBR/2K textures and about 10,000 faces with triangular retopology; requested polycount is a target. Completed GLB resources must be self-contained and at most 32 MiB.

Tasks persist in `.openfun/meshy/` across restarts. Reusing the same key/input does not resubmit; an intentional revision uses a new key. A submission timeout does not automatically retry: inspect the Meshy API task list, then recover with the optional `taskId` on `world_model_status`. API tasks and the web asset list are distinct. Download failures require another status/download attempt, not another generation. Shared output contains GLB/source records, not credentials, temporary URLs or raw responses.

A typical chain is `guard-preview-v1` → `guard-painted-v1` (`refine`) → `guard-rig-v1` (`rig`) → action-library lookup → `guard-attack-v1` (`animate`). Check completion before each dependent stage. `retexture` and `rig` can also upload a local self-contained GLB; animation requires a completed rig source. Rig status may expose service-returned walking/running clips through `output`; unavailable outputs fail explicitly.

Automatic rigging targets conventional textured biped humanoids with separated limbs; upload guidelines include A/T pose, +Z facing and no more than 300,000 faces. Mechanical hinges and non-humanoid rigs need their own workflow. Downloaded skeletons/clips still require deformation, material, weapon-socket, collision and normal-speed gameplay checks. Text-to-motion and automatic reduction are not native OpenFun tools.

`world_import_asset` validates/imports a local GLB. `world_build_asset` retains a constrained Blender geometry recipe helper in `tools/blender/build.py`; it does not replace sourced/generated production artwork or represent Blender's full capabilities. Existing shell/file tools or explicitly configured MCP services can operate Blender. Generic helpers such as `openfun_death_lifecycle.gd` and `openfun_mesh_materials.gd` assist integration but are not animation assets. See the [animation guide](game-design/animation.md).

Explicit paid image-to-3D verification:

```sh
pnpm test:live meshy /path/to/world game/assets/references/chest.png chest-v1
```

Full animation acceptance is documented in [CONTRIBUTING](../CONTRIBUTING.md#experimental-3d-animation-acceptance). Historical successful prop generation does not validate every asset category, and no new live-service result is implied by this documentation update.

API references: [image-to-3D](https://docs.meshy.ai/en/api/image-to-3d), [text-to-3D](https://docs.meshy.ai/en/api/text-to-3d), [retexture](https://docs.meshy.ai/en/api/retexture), [rigging](https://docs.meshy.ai/en/api/rigging), [animation](https://docs.meshy.ai/en/api/animation), [action library](https://docs.meshy.ai/en/api/animation-library).

## Design references

`world_search_design_references` searches a small bundled index by keyword/topic, not the live web. `world_read_design_reference` retrieves bounded, source-linked passages with continuation offsets and caches readings in memory for an hour. It neither installs narrative engines nor runs reference code. Source text is reference data, not executable instructions or automatically licensed production content.

Use `world_design_guide` for `animation`, `mechanics`, `performance`, `ui`, `runtime`, `narrative`, `levels` and `audio`. Translate references into concrete player decisions, level constraints and persistent consequences; keep brief notes in `design/` and consolidate implemented runtime rules in `design/runtime.md`. Reading sources does not establish enjoyable play. See [narrative](game-design/narrative.md), [levels](game-design/levels.md) and [runtime](game-design/runtime.md).

## Runtime boundary

Current `/content/jobs` requests produce structured data and reuse prepared assets/mechanics. Games prefetch, validate and activate results while preserving stable IDs and saves. Background jobs do not automatically search libraries, generate new media, run Blender/Meshy or rewrite mechanism code.

The target is to make the full content/asset creation capability available during play, including new assets and mechanisms. Provider-independent generation, artifact preparation and safe activation still need implementation and validation. See [architecture](architecture.md) and [roadmap](roadmap.md).
