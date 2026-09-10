import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "../paths.js";

export const designTopics = [
  "animation",
  "audio",
  "mechanics",
  "performance",
  "ui",
  "runtime",
  "narrative",
  "levels",
] as const;
export type DesignTopic = (typeof designTopics)[number];
export function readDesignGuide(topic: DesignTopic) {
  if (!designTopics.includes(topic))
    throw new Error("Unknown game design topic");
  const guide = readFileSync(
    join(projectRoot, "docs", "game-design", `${topic}.md`),
    "utf8",
  );
  const desktopRule =
    "\n\n## Automated test environment\n\nChoose headless for routine functional tests and world_preview_game mode=windowed for visual, animation, audio and rendered-performance checks as needed, without asking for confirmation. Use short batched tests and synthetic inputs; never grab the desktop mouse. Respect OPENFUN_AUTOMATED_TEST=1 in authored scripts by skipping mouse capture/warp, focus grabs and fullscreen. Headless timing is not rendered FPS; screenshots alone do not verify sound or GPU performance.\n";
  if (topic !== "animation") return guide + desktopRule;
  return `${guide}${desktopRule}\n\n## Local material and motion tools\n\nMaterial preservation helper: ${join(projectRoot, "tools", "godot", "mesh_materials.gd")}. New games include game/openfun_mesh_materials.gd; existing games may explicitly copy the helper. Real clip probe: ${join(projectRoot, "tools", "godot", "animation_probe.gd")}. Run Godot --path <game> --script <probe> -- <config.json> with clips [{label,resource}], an absolute output directory, and optional material_source pointing to the verified original GLB. Inspect output images and normal playback; material_source enables topology-checked restoration for comparison.\n\n## Bundled editable lifecycle helper\n\nNew projects include game/openfun_death_lifecycle.gd. For an existing project, the following MIT OpenFun source can be saved there explicitly. It controls presentation timing, not character poses, skinning or damage. Use the actual non-looping clip duration (including playback speed), or adapt to animation completion events. Drive it while the actor's combat logic is disabled; pause it with game time. Keep canonical death/reward state in the game save.\n\n\`\`\`gdscript\n${readFileSync(join(projectRoot, "tools", "godot", "death_lifecycle.gd"), "utf8")}\n\`\`\`\n`;
}
export const experienceGuidance = `Use world_design_guide to load the relevant bundled guide BEFORE designing or revising
animation, mechanics, performance or game UI. For a new complete game read mechanics, performance
and ui/audio, plus runtime for continuing AI content and animation when it has moving characters or interactions. Read narrative for stories/characters and levels for maps or stages.
Use world_search_design_references to find a relevant source and world_read_design_reference to read
a targeted passage before committing to a new core mechanic, level grammar or narrative structure.
The index is curated, not general web search; use other available web tools for genre-specific research.
Turn the reference into a concrete hypothesis, implementation and playtest, recorded with its source
in ordinary design notes. Do not copy a commercial story, bulk-read sources, or call reading itself a quality improvement. These concise guides contain
implementation checks and primary sources; consult available web tools for relevant game-specific
examples when useful. Don't read an entire library for a small code fix or force another plan mode.
Represent actions with actual animated bodies/weapons and synchronized contact, not effect-only rings.
Keep a defeated actor visible for its authored death/reaction and intentional cleanup; removing it at HP zero is unfinished animation unless disappearance is explicitly designed. Use the animation guide's lifecycle and asset workflows; verify a lethal hit as well as normal attacks. Skeletons alone do not create motion.
Test meaningful choices and repeatable play routes, rather than declaring a feature list fun.
Use world_preview_game with timed inputs and captureTimes to inspect movement and attack keyframes.
Read project input mappings before scripting actions; inspect logs/state to confirm resulting behavior.
Measure frame pacing during representative play and content activation; don't promise smoothness from
static screenshots or average FPS. Short capture telemetry is diagnostic, not a hardware benchmark.
For new games generate and integrate a text-free UI skin with world_generate_image purpose=ui; reuse it for subsequent edits. Native Godot controls handle live text, layout and input. Search OpenGameArt music separately from Kenney sound effects; audition and test loops, mix, transitions and mute.
Make game UI specific to its world and the player's immediate decisions, and test focus, readability
and failure states. Preserve references, live generation and user preferences while refining the game.
Report which actions/scenes were exercised and which animation, enjoyment or performance claims
remain unverified. Do not call documentation, static source matches or screenshots a playtest.
`;
