# Design and verify continuing AI gameplay

Use this guide for new games with ongoing AI-generated regions, levels, encounters or story. Plan this alongside the core loop; after the first playable slice works, consolidate the actual rules and complete the integration before delivery. Respect an explicit finite/offline design. A rules document alone is not a running system.

## Persist a generation contract

Write concise project-specific rules in design/runtime.md, read automatically by the Host for each new request. Use WORLD.md for world canon and design/art.md for visual identity. Runtime workers have no memory of the author conversation. Include:

- Fixed mechanics and invariants: movement/combat rules, progression, world geography, character identities and irreversible consequences.
- AI-controlled variation: room topology, encounters, rewards, dialogue, objectives or branching events; define ranges, prerequisites, asset IDs and valid combinations.
- Content unit and schema version: a floor, region or encounter; entry/exit connections, reachable objectives, spawn safety, difficulty and reward bounds. Keep future content expressible in implemented mechanics.
- Pacing and novelty: challenge/rest rhythm, progression limits, recent content to avoid repeating, and story prerequisites that prevent resurrecting dead NPCs or replaying resolved quests.
- Request trigger, prefetch lead time, maximum outstanding work, ready-content buffer, activation boundary, failure/retry UI and save/revisit behavior.
- Exact code/scene locations implementing request construction, schema, semantic validation, activation and saves. Update the document when those rules change.

Use plain Markdown, not a mandatory questionnaire. Keep rules compact: documents have bounded size and are creative input, not executable tools. Do not send every prior dialogue or full save; include relevant player stats/choices, recent events, unresolved threads, neighbors and the allowed asset vocabulary in each request context. Keep identities stable across content units.

## Design development, not endless reskins

Define a development arc in design/runtime.md: the current situation, unresolved tensions, possible turning points, player-dependent branches, payoffs and what opens after an arc ends. These are possibilities, not a fixed script. Separate immutable canon from things that can evolve: relationships, territory, objectives, available routes and unlocked combinations. A new name, palette or increased enemy HP is not enough.

For each next unit, supply an explicit compact progression context: active/completed content IDs, player choices and irreversible consequences, unresolved threads, current chapter/region, unlocked capabilities, recent layouts/objectives and the intended next development. A prefetched unit is a possibility until activated; never treat it as played. Carry long-term canon and resolved events in the save/context even after they leave recent history. Use separate namespaces for independent campaigns; use stable entity IDs for recurring characters.

The Host automatically adds recent published content and the latest save from the same namespace. These are bounded structured excerpts, with truncation marked; published does not mean played. This helps older games avoid blind repetition but does not replace explicit progression state or cross-namespace context supplied by the game.

Implement a content grammar with meaningful room to grow. An arena schema with only title, color and enemy count can only create variants of that arena. For the intended game, implement several supported objective types, spatial affordances, encounter roles, narrative state transitions and unlocks; let the schema select and compose them. NPC dialogue should affect an implemented relationship, route, quest or choice where appropriate. UI should expose those changing goals and choices using stable controls and prepared art, not change arbitrarily every floor. Prepare reusable visual families and character variants with image generation and optionally model services during authoring. Runtime JSON does not generate new textures, meshes, scripts or UI widgets by itself. Adding a new capability requires implementing its interpreter and assets, not merely widening the prompt.

Before activating content, compare game-specific signatures (objective type, topology, encounter roles, story transition) with recent played units. Reject unintended structural duplicates with an explicit failed-content/retry flow; do not silently replay the old level. Do not use a generic text similarity threshold: deliberate revisits and repeated mechanics with new consequences can be valuable. Show the reason, preserve progress and avoid automatic retry storms.

Acceptance must cover at least three successive unseen units, a consequential player choice and a restart. Record what the player does differently in each unit and which earlier action caused the next development. Verify that a resolved quest stays resolved and unused prefetched content does not become canon. Include a deliberate duplicate fixture to exercise the game's semantic rejection. Structural tests alone cannot certify novelty or fun; inspect the actual played sequence.

## Wire the actual runtime

Read game/OPENFUN_PROTOCOL.md (source: docs/runtime-protocol.md). Godot receives a loopback Host URL and capability token on startup. Use asynchronous HTTPRequest with Authorization; never put provider keys in the game. OpenFun runs the selected model behind that Host. [Godot HTTPRequest](https://docs.godotengine.org/en/stable/classes/class_httprequest.html).

1. Restore saved state and existing jobs before submitting. Use a versioned namespace/key for each logical unit; identical requests reuse the job, changed inputs require a new revision. Freeze a request once submitted; do not rebuild its context every frame.
2. POST /content/jobs with prompt, JSON schema and compact context while the player is occupied. Poll the existing job at a bounded interval, never per frame. A transient network error is not permission to submit a duplicate unit. Polling does not call a model.
3. Treat pending/running as unavailable. For ready data, validate gameplay semantics as well as JSON structure: connectivity, safe spawns, objective reachability, difficulty, item/asset references and narrative prerequisites. The Host validates structure; the game owns these semantic checks.
4. Prepare content off the critical path, then activate at a safe boundary. New JSON describes existing mechanics/assets, not arbitrary code or automatically generated meshes. Preserve the current playable content while waiting; do not unload it just because a request is pending.
5. Save active job/content IDs, player state, resolved consequences, selected rewards and request identity using /game/state. Serialize revision-based saves and handle conflicts; keep published content immutable. Revisit must reuse saved content and its modified state.
6. On failure or exhausted budget show a useful wait/retry/return option; preserve progress. Explicit retry uses the failed job endpoint and consumes another attempt. Do not spin retries or present procedural fixtures as AI output. Cosmetic choices may have authored fallbacks, but missing generated levels must be explicit.

The Host already provides the queue, provider integration, task persistence, cancellation, structural validation and state storage. Implement the game-specific trigger/interpreter/validator; do not invent another server or require the author chat to stay active. Sharing carries public rules and ready content, not credentials. Recipients need their own configured model for unseen content. Meshy/Blender asset generation is a separate authoring pipeline and is not automatically invoked by content jobs.

## Verify the continuation, not just the first scene

Proactively run the game after each meaningful gameplay/visual change; inspect screenshots and logs/state for the changed behavior, fix failures and rerun the affected path. For continuation, use an isolated acceptance world and a bounded request budget:

- Play content A while B is requested; prove movement/input stays responsive during pending work.
- Validate and activate B with a materially new layout, objective or encounter. A changed title alone is not continuing gameplay.
- Exercise invalid results, slow/failed requests and exhausted budget. Verify safe waiting and explicit recovery without duplicate submissions or corrupt state.
- Modify B through player action, save, restart with zero generation budget and revisit. Assert the same content ID and player consequences return without another model call.
- Use deterministic injected fixtures for repeatable failure coverage, then separately run a real selected-provider test when available. Record which path was tested, request counts, content IDs and remaining limits. Never describe fixture output as AI-generated.

world_preview_game is isolated and does not request new content; it proves renders/input only. Use /play or a dedicated live Host acceptance for actual generation. Parsing, screenshots and source grep alone do not establish end-to-end continuation. See the bundled roguelite template and tests/e2e/roguelite.mjs in source for concrete integration and fixture acceptance; the template is an example, not a genre restriction.

## Supply reasons for development, not content quotas

Include the game's core appeal and supported interaction vocabulary in design/runtime.md. Describe what decisions each kind of development can create, when familiar content or recovery is appropriate, and what must remain fair and consistent. Do not prescribe a monster/weapon count or endless unlock schedule. New objectives and layouts should deepen the existing loop or pay off player consequences.

The existing request context and save state can carry compact observed play information: available build/actions, recently used actions, outcomes, recent encounter roles and unresolved consequences. The author must implement that collection; OpenFun does not infer live player telemetry automatically. Distinguish observations from hypotheses about mastery or boredom. Prefetched/published units remain unplayed until the game says otherwise.

Runtime generation still interprets a fixed schema and implemented behaviors. If those cannot express a meaningful new interaction, fix the authoring-time runtime/schema/assets and validate compatibility. Do not invent unsupported fields, run new code from generated text, or call stat inflation rich progression. Validate resulting fairness, reachability, build viability and actual changed decisions. Novelty is subordinate to play value and is not required in each individual room.
