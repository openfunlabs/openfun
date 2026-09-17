# OpenFun product evaluation

Specification: `evaluation-v1.2`. This version adds evidence tied to project versions, layered checks, negative controls and regression requirements. Scoring anchors are unchanged and still need empirical calibration. Keep v1.0/v1.1 results under their original versions; changes to cases, anchors or eligibility require a new version. The [quality improvement plan](quality-improvement.md) lists implementation stages and their status.

## Purpose and scope

Evaluate whether an ordinary user receives a coherent, attractive, enjoyable game with meaningful AI continuation. Tool use is necessary evidence of workflow, never sufficient evidence of quality. Fun takes precedence over content volume. Enemy, weapon, level, asset and word counts are not quality targets.

Evaluate the installed `openfun` entry, bundled agent, actual tools, actual Godot game and live Host. Start in a new empty project. Default initialization contains only a blank Godot entry and integration guidance, not a demonstration game. Source-only integration fixtures are excluded from product trials and the published package. Existing unit/e2e tests remain engineering checks, not product scores. In particular the legacy `tests/live/creation.mjs` explicitly disables image generation and is NOT a full product evaluation.

Current runtime generates schema-bound data using implemented behavior and pre-imported assets. Do not score it as a live code/model-generation engine. Score whether the creator builds sufficient expressive capacity and wires meaningful continuation. Future capability expansions require separately versioned targets. Sharing has a portability gate; multiplayer is out of scope.

## Run registration and isolation

Before each run record run ID, case/version, exact user prompt, product version and source/package digest, provider/model ID, thinking level, tool versions, OS/hardware/display resolution, service availability, credential-presence booleans, cache condition and run purpose (calibration/baseline/candidate/holdout/polish). Never record secrets or auth payloads. Provider aliases and stochastic services limit reproducibility even with unchanged local configuration.

Use only OpenFun-owned authentication. Do not alter the user's games. Create author worlds in a fresh temporary directory outside the development repository; otherwise ancestor Git/source discovery contaminates installed-product evaluation. Keep the world path in registration and copy evidence to the artifact directory. Keep private logs and game artifacts under `.output/evaluations/<run-id>/`. The author sees the ordinary user prompt and normal product instructions; never inject the rubric, expected tool sequence, test solutions or baseline game. The evaluator may inspect the rubric. Record all interventions and retries. Do not manually repair a trial game and call it autonomous success.

Separate cold-project trials (no project assets or session history) from reuse trials (explicitly supplied approved project assets). Record global/tool caches rather than claiming they are empty. Never delete credentials or user caches to create a cold run. Compare like conditions. Preserve failed runs, not just successful samples.

No default product-polish round/call cap is introduced. Evaluation interruption is explicit: user stop, service blocker, stalled process or declared observation window. An interrupted creation is `incomplete`, not a completed failure or an excluded run. Record elapsed time and useful progress. Watchdogs protect resources; their thresholds must be declared and cannot be used to silently discard slow samples.

## Cases

Use the following exact prompts for calibration/development. The direct-delivery preference avoids fabricated questionnaire answers. A genuine blocking question is recorded and answered by the user; do not secretly supplement the brief.

| ID  | Ordinary prompt                                                                                                                                    | Required coverage                                                                           | Applicability                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| A   | 做一个 2D 俯视角动作探索游戏：我提着灯探索逐渐苏醒的森林遗迹，希望战斗有手感，越往深处走越有意思。直接做出完整第一版，细节你决定。                 | Contact/reaction/death, movement, situational decisions, live next-area generation, revisit | All dimensions; narrative evaluated at the scope the game promises |
| B   | 做一个 3D 海岛探索游戏，我是夜间送信的邮差，逐渐发现一位失踪守塔人的故事。海岛要有吸引力，航行到远处还能发现新的地方。直接做好第一版，细节你决定。 | Principal 3D art, spatial exploration, clues/consequences, live new areas                   | All; combat is not required                                        |
| C   | 做一个 2D 光线解谜游戏，规则容易理解，但后面的谜题能让我重新思考前面学会的东西。直接做出第一版，不要战斗。                                         | Rule composition, readable outcomes, escalating understanding without arbitrary extra rules | Combat N/A; narrative may be N/A before authoring                  |
| D   | 做一个小镇调查游戏，我通过对话、线索和选择，发现居民之间隐瞒的往事，希望之后还能发生新的事件。直接做出第一版。                                     | Character motivation, usable clues, choices, continuity and payoff                          | Combat N/A; motion graded for actual interaction needs             |
| E   | 做一个温暖的海边小店经营游戏，收集材料、制作商品、认识客人，希望经营越久越有新的取舍，而不是只等数字变大。直接做出第一版。                         | Resource tradeoffs, progression, meaningful customers/events, saves                         | Combat N/A                                                         |

Calibrate with A and B first. Then add C–E and independently worded variants. Freeze fresh holdout prompts before candidate results are known; keep them out of author prompts and product guidance. Rotate holdouts after exposure. Add explicit finite/offline and approved-asset-reuse cases to test respect for user exceptions. Lack-of-credentials, HTTP errors, slow generation and invalid-content tests are separately labelled fault trials, not ordinary quality baselines.

## Three result layers

### Gates

Each gate is `pass`, `fail`, `unverified` or `not_applicable` with evidence and reason. A gate failure prevents overall acceptance; no score can compensate. External outages retain the observed failure and an external attribution; run completion/quality must not be fabricated.

| Gate                               | Required evidence                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 Playable delivery               | Launch and exercise core interaction, progression and failure/retry; no blocking crash or softlock                                                                                    |
| G2 Honest claims                   | Compare reported tool/generation/test success to actual results; fixture data never described as model output                                                                         |
| G3 Production asset sourcing       | Principal visible artwork sourced/reused/generated and integrated; no script-drawn or primitive-assembled substitute artwork without an explicit user exception                       |
| G4 Actual continuation             | For open-ended cases, real provider job becomes visible, playable subsequent content without evaluator intervention; author is idle/closed while Host continues                       |
| G5 Persistence                     | Restart/revisit preserves generated identities and material player consequences; no unnecessary regeneration or erased progress                                                       |
| G6 Project/configuration isolation | Correct working directory, OpenFun-owned configuration; no dependency on standalone pi or changes to other user projects                                                              |
| G7 Portable sourced assets         | Local asset references resolve, source/licenses retained; package and import into a fresh test directory can load the game; online continuation credentials are configured separately |

A local source-pattern match alone cannot fail G3: collision, text/layout, supporting effects and greyboxes during development are legitimate. Trace final visible assets. Existing approved assets do not require repeat generation. For new games the required image target and a dedicated text-free UI skin must also be generated/viewed and applied. Verify actual HUD/menu texture use, live text, button states and source receipts; a concept image or downloaded generic skin alone does not meet the new-game UI requirement. Assess music selection separately from sound effects, including licensed source, loop seam, state transitions and mute. Document intentional silence and user exceptions. A failed service does not authorize quietly hand-coding replacement production art; label art incomplete.

### Quality anchors

Use integers 0–4, plus `NV` (not verified) and justified `N/A`. Common meaning: 0 absent/unusable; 1 superficial with major failure; 2 functional but materially weak; 3 good within observed scope; 4 consistently strong across multiple tested situations. Evidence gaps are NV, not zero or assumed success. Register N/A before running where possible; author omission is not inapplicability.

| Dimension                              | 1: superficial                                                | 2: functional/weak                                                          | 3: good                                                                                                              | 4: strong across observations                                                                                           |
| -------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Q1 Understanding and autonomy          | Ignores central request or waits for tool-by-tool direction   | Delivers only a narrow demo or needs material prompting                     | Coherent first version from ordinary prompt, reasonable decisions, respects constraints                              | Anticipates relevant interaction/content needs and resolves observed problems without scope drift                       |
| Q2 Asset sourcing and integration      | Token tool call or unused concept; coded substitutes dominate | Real assets present but mismatched, incomplete or only in menus             | Appropriate search/reuse and gap generation, principal assets visible with provenance                                | Cohesive kit adapted effectively to camera, motion, UI and later content; avoids wasteful regeneration                  |
| Q3 Visual expression                   | Placeholder composition, unreadable or incoherent art         | Attractive isolated parts, weak in-game composition/material consistency    | Clear focal hierarchy, silhouettes, palette, materials and lighting in real gameplay                                 | Distinctive identity remains coherent across locations, interactions and resolutions                                    |
| Q4 Controls, motion and feedback       | Static attack ring/instant disappearance or unclear response  | Actions work but contact, transitions or cues feel weak                     | Responsive input, readable anticipation/action/recovery, consequences and intentional death/cleanup where applicable | Consistent timing and body/weapon/environment feedback across movement, action and interruption                         |
| Q5 Core decisions and appeal           | Repetitive action with no meaningful response/choice          | Some choices but one obvious tactic dominates most observed situations      | Choices or skills have situational value and readable consequences; player can learn                                 | Multiple coherent approaches/expressions produce satisfying, understandable tradeoffs across sampled play               |
| Q6 Development and richness            | Renaming, palette/stat/count changes dominate continuation    | Real novelty exists but soon repeats or distracts from core appeal          | Later content develops existing decisions/relationships, with practice and recovery                                  | Sustained coherent development and payoff without endless systems, grind or arbitrary invalidation of earned strategies |
| Q7 Narrative/character/world coherence | Contradictions, generic exposition, choices ignored           | Some coherent setup but weak motivations or payoff                          | Usable clues/motivations and persistent consequences appropriate to game's promise                                   | Relationships and discoveries meaningfully develop, branch and resolve across observed events                           |
| Q8 Live generation experience          | Fake/manual continuation, broken activation or lost state     | Real generation works but abrupt waits, fragile continuity or poor recovery | Proactive prefetch, understandable waiting/retry, validation and reliable restart/revisit                            | Smooth observed transitions and robust fault handling with meaningful context-driven continuation                       |
| Q9 UI and comprehension                | Player cannot understand goals, controls or state             | Usable with explanation, awkward focus/text/layout                          | First-time player understands and acts; readable controls, focus and feedback                                        | World-specific UI stays clear across long text, input states, resolutions and failures                                  |
| Q10 Performance and verification       | Blocking errors/jank; only claims or parse checks             | Basic testing, visible stalls or unresolved material issues                 | Author exercises changes, fixes findings; representative play and activation meet declared performance target        | Repeated representative checks show stable pacing/reliability and validated fixes without regression                    |

Do not require combat, a story, new weapons or elaborate decoration in every genre. Sound presence, synchronization and mix support Q3/Q4/Q9 as applicable; do not double-count the same failure. Score 0 when the dimension is required but missing or unusable. Each score needs a positive observation, limitation, evidence locator and confidence (low/medium/high). Q5 human enjoyment is not established by model judgement: label model/playback judgement `proxy` and retain human feedback separately.

Do not average ordinal scores into a pass/fail total. Show the profile, weakest applicable dimension, gate outcomes and repeated-run distribution. Acceptance initially requires every applicable dimension >=3 with evidence and all gates passed. NV cannot pass. Mark human-fun validation pending until human playtest exists; no arbitrary numerical weighting can erase that distinction.

### Efficiency and reliability record

Record time to first playable, author-declared completion, model/API requests, actual reported tokens/credits, repeated submissions, cache/reuse and human interventions. Unknown costs remain unknown; subscriptions are not converted to invented per-call dollar prices. Quality comes first; efficiency diagnoses waste, not a reason to skip useful authorized art generation. Track failure frequency separately from the completed-game quality profile.

For performance register hardware, resolution, desired frame rate and representative scenes before measuring. Store p50/p95/p99 frame time, visible stalls, sample duration, shader/import warmup versus warm play and content activation. Do not invent a universal threshold or claim smoothness from average FPS. A 60 Hz test's nominal frame budget is 16.7 ms; agreement with a target must be examined with tails and observed stalls. Report memory growth only over the actual measured interval.

## Observation protocol

1. Launch installed `openfun` in an empty directory through the normal creator path, using native JSON/RPC transport only for observation if necessary. Preserve normal extensions/tools. Record transport differences; separately verify actual terminal startup. No test-specific hidden author instructions.
2. Capture tool start/end, sanitized arguments/result metadata, errors, elapsed time, provider selection and final claims. Save artifacts and immutable first-delivery snapshot outside the author workspace. Strip host tokens/auth, avoid duplicating base64 images in logs. Snapshot hashes and metadata are receipts, not aesthetic proof.
3. First-time play: try the delivered controls without reading source or accepting author explanations. Record confusion and interventions. Then inspect code/input mappings to automate repeatable paths; label this assisted phase.
4. Capture normal-speed gameplay (not only menu screenshots), action/reaction/death where applicable, UI states and representative locations. No need for arbitrary fixed screenshot counts; capture evidence for the claimed score.
5. Play at least three actually visited subsequent units for applicable continuation cases. This is a sampling minimum, not a design quota. Include a later-duration sample, a consequential choice, familiar strategy and reasonable alternative. Generated/prefetched is not played. Do not claim infinite quality from a finite sample.
6. Correlate Host jobs/provider calls with loaded content IDs, changes in player decisions and persisted consequences. Observe with creator idle/closed. Fault trials separately test pending/failed/invalid data and recovery.
7. Restart and revisit; compare important saved values and IDs, ensure replay does not regenerate content. Package/import test assets into a fresh directory for G7.
8. Freeze first-version score before polish. Start product polish only in the designated phase with explicit authorization and record each accepted/reverted round. Report polish delta separately; do not overwrite initial scores.
9. Score independently from the author's self-report; blind version identity in side-by-side visual/play comparisons when practical. Human disagreements and confidence are retained. Calibrate anchors using shared evidence before treating scores as comparable.

## Calibration, regression and stopping

Start with A/B calibration runs. They are exploratory observations, not a release-quality baseline. Freeze rubric adjustments after reviewing ambiguities and record changes. Run the formal baseline after calibration without mid-run product changes. Keep the executable/package immutable for each batch.

For each issue record the failed objective, evidence, observable effect, scope and suspected cause: conflicting/missing instruction; tool discovery/usability; service transport/outage; runtime/schema capacity; agent execution; game design/art; evaluator defect. One symptom may have several causes. Fix the smallest defensible root cause, not automatically another prompt paragraph.

Re-run the same ordinary prompt in a fresh project after a product change, then an unexposed/other-genre prompt. Improving one saved game is not evidence of improved OpenFun. Keep input/model/cache conditions comparable. All attempts, interruptions and service failures remain in the report. Do not select the best of several attempts and call it representative.

For initial acceptance use at least three independent creations of each core case under the frozen candidate and show each profile; require every applicable dimension >=3 and all gates passed in those acceptance runs. Failed earlier candidates remain visible. Small samples are preliminary evidence, not a statistical reliability guarantee. Human fun remains a separate calibration/acceptance dependency. Repeated no-gain or capability blockers require diagnosis and an honest status, not silently relaxed thresholds or unlimited repetitive trials.

## Artifacts and report template

The specification, implementation plan and test harness belong in version control. Large private outputs live in `.output/evaluations/<run-id>/`: registration, sanitized events, first-delivery snapshot, gameplay evidence, job/state receipts, scores, issue log and optional polish reports. Restrict snapshots to test projects; no copied authentication directories. Do not expose credentials in screenshots or shared archives.

```markdown
# Evaluation <run-id>

- Specification/case/purpose:
- Product/package digest and model/settings:
- Environment, caches and available services:
- Exact prompt and interventions:
- Outcome: complete / incomplete / blocked
- Observed duration and units actually played:

| Gate | Result | Evidence | Attribution/limits |
| ---- | ------ | -------- | ------------------ |

| Dimension | Score or NV/N/A | Positive observation | Gap | Evidence | Confidence/proxy |
| --------- | --------------- | -------------------- | --- | -------- | ---------------- |

## Issues

| ID  | Objective | Observed failure | Evidence | Suspected cause | Proposed fix | Retest |
| --- | --------- | ---------------- | -------- | --------------- | ------------ | ------ |

## Usage and timing

Actual reported amounts, unknowns, reuse and duplicate submissions.

## First version versus polish

Immutable baseline, separately scored changes, regressions and remaining gaps.

## Verdict

Acceptance status, human-playtest status, unresolved blockers and next experiment.
```

## Running registered cases

Use Node 22 and `node tests/evaluation/run.mjs --cli /absolute/path/to/installed/openfun/dist/cli.js --case A --model <selected-model-id> --purpose calibration`. A–E use the frozen ordinary prompts above. `--purpose` distinguishes calibration, baseline, candidate, holdout and polish metadata; it does not secretly start product polish. A private pre-registered holdout may use `--case H1 --brief /absolute/path/to/ordinary-brief.txt --purpose holdout`; the exact text is saved in registration, never supplemented with the rubric. Keep the brief outside the author project. The runner records an independent-play target of 1280×800 / 60 Hz without adding it to the author prompt.

### Unattended authorship and desktop isolation

Start the registered ordinary brief once and allow OpenFun to finish autonomously. Capture events
to disk; the evaluator does not coach, edit the generated game, or send corrective prompts during
a first-delivery run. Review the completed trace and artifacts afterward rather than repeatedly
watching intermediate tool calls. Report operational interruptions separately. Improvements belong
in OpenFun and are assessed by a fresh registered candidate run.

Use headless for routine functional tests, and let OpenFun choose windowed checks when visual,
animation, sound or rendered-performance evidence is needed, without additional user confirmation.
Batch meaningful checks and avoid desktop input takeover. Headless results alone cannot pass visual,
audio or GPU-performance gates. Record the actual test mode and evidence; an autonomous rendered
check is not an evaluator intervention. An isolated rendering environment is preferable when available.

## v1.2 evidence and regression requirements

### Tie evidence to a project version

Allow greyboxes during development; final delivery must meet the production-art requirements. Record development checks, first delivery, authorized polish and live continuation separately. Keep first-delivery evidence after later repairs. For continuation, save content IDs and state revisions alongside the game version. G4 requires real generation, which a zero-generation-budget preview cannot test.

For each observation, record the frozen project digest, capture time, scene, input sequence or procedure, and result. Include the test mode, seed and initial state where controlled, capture timestamps or log offsets, and relevant job/content IDs. Save a separate snapshot and report after material edits.

Create a manifest of sorted relative paths and SHA-256 file digests for the frozen `game/`, `design/` and `WORLD.md`, excluding generated caches and credentials. The project digest is the SHA-256 of the saved UTF-8 manifest bytes. Keep state/database evidence separately with its revision and digest. An independent reviewer must check that the manifest matches the project used in the observation.

Record tool use and player-visible results separately. Use asset receipts to verify sourcing, in-game evidence to assess Q2/Q3/Q9, import logs to check engine compatibility, and motion footage to assess Q4. When an artifact supports several dimensions, explain what it shows for each; do not count one defect more than once. The generated visual target and UI skin remain required as in v1.1.

### Layered checks and negative controls

| Layer              | What to observe                                                                                                | What it cannot establish alone                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Resource structure | Source/license, file hashes, dimensions, frame bounds, pivots, clip names/durations, material/skeleton mapping | Cohesive art or good motion                              |
| Engine loading     | Native resource import and load, missing references, runtime errors                                            | Reachability, enjoyable decisions or attractive gameplay |
| Interaction        | Input → state transition → visible/audible consequence; objective/failure/retry; save/revisit                  | All possible states are correct                          |
| Player experience  | First-time comprehension, real-time motion, choices, later development, human feedback                         | Unlimited future content quality                         |

Before using a new checker, verify that it rejects a relevant known failure: wrong frame bounds or pivot, missing animation, damage outside the contact interval, unintended instant removal on death, unreachable objective, fake completion flag, invalid content, or stale evidence. These are requirements for future checks; they do not describe a completed test suite. Keep fixture results separate from autonomous product trials, and record false positives and limitations. Claims about reachability or solvability must state the modeled rules, initial state and search bounds. Path search alone cannot verify mechanics it does not model.

### Change regression matrix

| Change                | Required focused observations before broader evaluation                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Art/UI replacement    | Actual gameplay composition, scale/pivot, clipping, hit areas, text/focus states, long text, loading and portability                      |
| Motion/combat         | Movement, hit and miss, interruption, lethal reaction/cleanup, input responsiveness, audio/contact synchronization                        |
| Mechanics/progression | Goal → decision → consequence, failure/retry, known viable alternative, save/load, applicable content validation                          |
| Runtime content       | Real job → validation → publication → activation → play; invalid/slow/error recovery; restart/revisit and preserved identity              |
| Polish                | Immutable before/after versions, claimed improvement, affected behaviors, regressions, candidate rejection/rollback                       |
| Latency/cost          | Cold/reused assets, queue/provider/processing/import/activation time, cancellations/retries/duplicate paid submissions, unchanged quality |

After focused checks pass, test the change with fresh ordinary prompts and an unexposed or other-genre case. Release acceptance still requires repeated trials of the frozen candidate, all applicable dimensions >=3, all applicable gates passed, and separately recorded human playtest. Incomplete instrumentation does not justify lower thresholds.

To assess Q6, describe the new decision, rule interaction, relationship or consequence encountered during play. Renamed rooms, palette changes, count increases or numerical scaling alone are insufficient. In asset-reuse trials, list the supplied assets, their sources and what was newly created. A trial with a hidden prebuilt game cannot count as an empty-project trial.

Measure queue, provider, transfer, asset processing, import, validation and activation time separately where instrumentation exists; mark the rest unknown. Report time to first playable, completed delivery and later content waits, with cold/warm conditions and reported usage. Include failed attempts, cancellations and paid requests with uncertain outcomes. Compare costs only alongside quality results.

### Machine-checkable review records

The runner registers trials under v1.2. Scoring requires a separate review: after independent observation, write a private `review.json` alongside the run's evidence. Its schema is defined in `tests/evaluation/report.ts`:

- Top level: `specification`, `runId`, `case`, `phase` (`first-delivery`, `polish`, `continuation`), `projectDigest`, `reviewer`, `outcome` (`complete`, `incomplete`, `blocked`).
- `evidence`: unique `id`, relative `file`, file `sha256`, `projectDigest`, ISO UTC `capturedAt`, `kind` (`gameplay`, `image`, `audio`, `state`, `performance`, `provenance`, `inspection`, `human-feedback`), `scene`, `procedure`, `observation`. Include precise timestamps/offsets and capture mode in the procedure. The manifest itself may be an inspection artifact.
- `gates`: exactly one record for each G1–G7 with `id`, `result`, `reason`, `evidence` ID list. Pass/fail requires evidence; N/A requires a reason reviewed against the case.
- `dimensions`: exactly one record for each Q1–Q10 with `id`, `score` (0–4, NV or N/A), `observation`, `limitation`, `confidence`, `judgment` (`human` or `proxy`), `evidence` ID list. Numeric scores require evidence. An N/A observation explains applicability; missing author work is not N/A.
- `humanPlaytest`: `status` (`pending`, `completed`), `notes`, `evidence` ID list. Completed requires actual human-feedback evidence, including limitations and unfavorable feedback. Completion does not itself mean positive feedback.

Run `node --import tsx tests/evaluation/validate.ts /absolute/path/to/run/review.json` from the development checkout. It reads files only and uses no model/service quota. Evidence files must resolve inside the report directory; absolute paths, escaping symlinks, missing files, checksum mismatches, mismatched snapshot labels, duplicate IDs and missing references are rejected. Unknown fields and older specification versions are rejected instead of silently migrated.

Exit 0 means the record is structurally valid and file checksums match. Exit 1 means the record is invalid or the input could not be read. A valid record may contain low scores or NV. `recordedThresholdsMet` summarizes only the recorded gates, scores and completion status; `productAccepted` always remains false.

An independent reviewer must inspect gameplay, match the manifest to the executed project, check N/A decisions and human-feedback attribution, and decide whether the evidence supports each score. Product acceptance also requires repeated trials and separate human-playtest results. Proxy judgments cannot establish human enjoyment.
