# Roadmap

OpenFun's first product milestone is 2D. We will expand from a reliable creative and gameplay loop toward basic 3D, more genres, and eventually the complexity of AAA open worlds. These are capability milestones, not release dates or claims about the current prototype.

## Starting point: feasibility prototype

Today, OpenFun can author Godot projects, run a local generation Host, persist structured content and saves, and import/export world packages. Authoring includes experimental 3D tools, but runtime generation uses existing scripts and assets. It cannot yet generate and activate arbitrary new assets or mechanics during play.

The current package exports a project's present content and saves. Epoch0 publishing, multiplayer, and OpenFun Cloud remain planned work. See [current implementation](implementation.md).

## 1. 2D worlds that grow during play

**Reference experience:** a Terraria-like game with new regions, monsters, items, and stories generated as the player explores.

- Make creating and refining a playable epoch0 approachable through conversation, with coherent art, animation, interactions, and UI.
- Generate and prepare later maps, assets, encounters, and narrative ahead of demand. Stream them into the running world while preserving established places and player consequences.
- Extend beyond structured data to validated behavior and mechanic changes. Share the creative pipeline between authoring and gameplay instead of maintaining permanently different capabilities.
- Separate epoch0 releases from evolving world instances and saves, laying the foundation for later publishing and multiplayer.
- Decouple text/code and image providers. Keep ordinary 2D asset discovery and reuse independent of optional 3D tools.

**Milestone evidence:** create a playable world, explore multiple unseen regions with newly generated assets and content, activate a tested mechanic change during play, revisit earlier regions, and resume the saved world without regenerating established results. Measure generation wait time, failures, play quality, and cost; passing engineering checks alone is insufficient.

### Existing Meshy integration

Keep the current experimental Meshy implementation during the documentation transition. Its extension also contains general asset-library tools used by 2D games, so deleting that module would remove useful functionality. During the 2D refactor, separate shared library tools from 3D generation and make Meshy optional. Meshy and Blender are not prerequisites for the 2D milestone; additional 3D provider work follows the next stage.

## 2. Basic 3D worlds

**Reference experience:** a Minecraft-like world that generates new map chunks, monsters, and items during play.

- Extend the same content/asset lifecycle to 3D chunks, streaming, collision, navigation, and persistence.
- Add configurable 3D generation providers and validate imported geometry, materials, rigs, and animations before activation.
- Support simple but complete 3D interaction and progression, with measured rendering and generation budgets.

**Milestone evidence:** move through a growing 3D world, encounter newly prepared assets, and reload explored chunks and saves consistently within the target device budget.

## 3. Rich open worlds and broader genres

**Long-term ambition:** worlds approaching the systemic depth, scale, and presentation of games such as Fallout or GTA.

Develop richer characters and animation, interconnected world systems, persistent narrative consequences, larger environments, and production-quality asset workflows. Validate performance, continuity, and author control as scale grows.

Expand support for roguelites, platformers, card games, and other genres through appropriate mechanics and content representations. The shared architecture is the lifecycle of content and assets; every game need not use a terrain or chunk schema. AAA quality is a long-term ambition requiring substantial validation, with no committed delivery date.

## Parallel tracks

### Local inference and model choice

Support user-configured providers and independently chosen models for different capabilities. Over time, aim to run suitable **diffusion models locally for text, images, video, audio, and 3D**, lowering the recurring cost of play and enabling more local operation.

Adoption depends on model availability, hardware requirements, latency, and quality. Diffusion is a direction, not a requirement imposed on every provider. Reuse assets, cache accepted results, and generate ahead of play regardless of model architecture.

### OpenFun Cloud and UGC

**OpenFun Cloud is the planned UGC platform for creating, publishing, sharing, and playing continuously evolving AI games.**

- Publish and discover epoch0 releases, including their initial assets and generation rules; support remixing with provenance and appropriate asset permissions.
- Host persistent world instances and authoritative multiplayer state, with shared generation results and coordinated activation.
- Offer managed inference for hosted games, including cloud multiplayer, alongside storage and world operation. Keep inference costs visible and controllable.
- Provide cloud rendering for mobile creation and play. Evaluate input latency, touch controls, bandwidth, session continuity, and GPU cost on real devices. Cloud rendering is distinct from cloud inference; either can be used independently.

Publishing follows the epoch0/instance separation; multiplayer follows consistent shared activation; cloud rendering follows an operable hosted runtime. The Cloud platform can evolve alongside 2D and 3D support without waiting for the final open-world milestone.

### Godot integration

Start with the existing separately installed engine. Evaluate managed downloads, bundled builds, and deeper embedding or custom builds when they improve setup or hosting. Preserve upstream maintainability and check each dependency's licensing before including it in a hosted service. Supporting multiple engines is not an initial milestone.

## Next implementation sequence

1. Establish the epoch0/instance distinction while preserving existing projects and saves.
2. Separate provider capabilities and shared asset tools from experimental 3D integration.
3. Build one end-to-end 2D pipeline for generation, preparation, validation, activation, and recovery during play.
4. Prove it in a small complete game before generalizing to more genres and 3D.

Detailed schemas and migration mechanics belong in the individual refactor proposals. This roadmap keeps the architecture small while making its intended direction explicit.
