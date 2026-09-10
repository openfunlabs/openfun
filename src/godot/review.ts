import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

/** Bounded source inventory. Signals guide inspection; they never certify a game. */
export function reviewGameProject(worldDir: string) {
  const root = resolve(worldDir);
  const assets: string[] = [];
  const scripts: string[] = [];
  const codedArtCandidates: string[] = [];
  const uiCodeCandidates: string[] = [];
  const uiTextureCandidates: string[] = [];
  const generatedUiReceipts: string[] = [];
  const audioCandidates: string[] = [];
  const referenceCandidates: string[] = [];
  const contentRequests: string[] = [];
  const stateRequests: string[] = [];
  const previews: string[] = [];
  let entries = 0;
  let bytes = 0;
  let truncated = false;
  function walk(dir: string, depth: number, imagesOnly = false) {
    try {
      if (!existsSync(dir)) return;
      let ancestor = root;
      for (const part of relative(root, dir).split(/[\\/]/)) {
        ancestor = join(ancestor, part);
        if (lstatSync(ancestor).isSymbolicLink()) return;
      }
      if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink())
        return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (++entries > 1500) {
          truncated = true;
          return;
        }
        if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
        const file = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (depth < 6) walk(file, depth + 1, imagesOnly);
          else truncated = true;
          continue;
        }
        if (!entry.isFile()) continue;
        const label = relative(root, file).replaceAll("\\", "/");
        const ext = extname(file).toLowerCase();
        if (imagesOnly) {
          if (ext === ".png") previews.push(label);
          continue;
        }
        if (
          [
            ".glb",
            ".gltf",
            ".blend",
            ".png",
            ".jpg",
            ".webp",
            ".svg",
            ".ogg",
            ".wav",
            ".mp3",
          ].includes(ext)
        )
          assets.push(label);
        if (
          [".png", ".jpg", ".jpeg", ".webp"].includes(ext) &&
          /^game\/assets\/(references|generated)\//.test(label)
        )
          referenceCandidates.push(label);
        if ([".ogg", ".wav", ".mp3"].includes(ext)) audioCandidates.push(label);
        if (
          [".png", ".webp", ".jpg"].includes(ext) &&
          /(?:\/ui\/|panel|button|hud|skin)/i.test(label)
        )
          uiTextureCandidates.push(label);
        if (
          entry.name.endsWith(".png.source.json") &&
          lstatSync(file).size < 4096
        ) {
          try {
            const receipt = JSON.parse(readFileSync(file, "utf8"));
            if (
              receipt.tool === "world_generate_image" &&
              receipt.purpose === "ui"
            )
              generatedUiReceipts.push(label);
          } catch {
            /* Untrusted or incomplete receipt. */
          }
        }
        if (ext === ".svg") codedArtCandidates.push(label);
        if (![".gd", ".cs", ".tscn", ".tres"].includes(ext)) continue;
        if ([".gd", ".cs"].includes(ext)) scripts.push(label);
        const size = lstatSync(file).size;
        if (size > 256 * 1024 || bytes + size > 2 * 1024 * 1024) {
          truncated = true;
          continue;
        }
        bytes += size;
        const source = readFileSync(file, "utf8");
        if (
          /\bdraw_(?:circle|polygon|rect|colored_polygon)\s*\(|\b(?:SphereMesh|BoxMesh|CylinderMesh|PrismMesh|ImmediateMesh)\b|\bset_pixel\s*\(/.test(
            source,
          )
        )
          codedArtCandidates.push(label);
        if (/\bStyleBoxFlat\b|\bColorRect\b/.test(source))
          uiCodeCandidates.push(label);
        if (/\/content\/jobs|\/snapshot/.test(source))
          contentRequests.push(label);
        if (/\/game\/state|\/command/.test(source)) stateRequests.push(label);
      }
    } catch {
      truncated = true;
    }
  }
  walk(join(root, "game"), 0);
  walk(join(root, "artifacts", "previews"), 0, true);
  const nextChecks = [
    "Performance is a delivery requirement: inspect design/performance.md for target hardware/resolution/renderer/FPS, the actual gameplay route and capture-free rendered p95/p99/hitches before and after fixes. Run mode=windowed with captureTimes=[], seconds=60 and warmupSeconds=5; exercise busy gameplay, not just menus. Test real content activation separately because previews have zero AI budget. Missing measurements or headless-only timing cannot establish smoothness. Profile observed sustained misses/repeated stalls, fix their cause and rerun the same route without sacrificing required art or animation.",
    "Read design/runtime.md and trace its implemented fixed rules, AI variation, schema, asset vocabulary, pacing and continuity state to the game. After the first playable slice, missing continuation rules or an unwired trigger is unfinished work unless the user requested a finite/offline game. Test next-content activation and zero-budget replay separately from visual previews.",
    "New-game UI requires generated text-free skins applied to actual HUD/menu controls; generic kits or an unused concept are insufficient. Trace generatedUiReceipts to runtime textures; receipts can be edited and do not certify visible use. Inspect uiCodeCandidates for replacement decoration, allowing plain contrast/focus overlays supporting real assets. For generated UI art, verify reusable text-free skins are integrated with native controls. Exercise button states/focus, narrow and wide nine-slice panels, changing values and long localized text without image regeneration; inspect alpha edges and pointer handling. A flattened UI mockup cannot establish usable UI.",
    "Check design/art.md and actual image-generation results: new-game art requires a generated visual target and its use in playable raster assets or reference-guided 3D models, unless the user explicitly chose an alternative. Inspect in-game integration; a concept image, file count or code-only placeholder scene is not finished art. Report image-generation blockers and unfinished art explicitly.",
    "Inspect the actual gameplay camera render; judge focal point, silhouette, palette, lighting, environment detail, UI and feedback. File counts cannot measure beauty. Fix the most visible weaknesses and render again.",
    "For motion/combat read world_design_guide animation, then exercise attacks with timed inputs and keyframe captures; validate actual contact and reactions, not only effects. Inspect design/animation.md and a lethal-hit sequence through impact, fall, final pose and cleanup; confirm the dead actor cannot attack and rewards occur once. Check foot sliding, grip, transitions and sprite identity/flicker.",
    "Read mechanics/ui/performance guides as relevant. Test meaningful choices, UI navigation and representative frame pacing; static inventory cannot establish enjoyment or smoothness.",
    "Trace the player's continuation trigger to a real request, validation, activation and save. Test three successive unseen units, a consequential choice and game-specific duplicate rejection; identify changed player decisions rather than renamed content. Revisit after restart; source matches cannot prove this path runs.",
  ];
  nextChecks.push(
    "Review design/audio.md: select actual background music, not only sound effects. Trace source/license to playback, audition loop seams and transitions, check Music/SFX buses, mute and repeated state changes. Audio files alone do not establish a good mix; explain deliberate silence.",
  );
  if (!generatedUiReceipts.length)
    nextChecks.push(
      "No generated UI receipt found. For a new game generate purpose=ui skins and integrate them; for established art inspect existing provenance or explicit user exceptions. Do not certify UI from a file-name match.",
    );
  if (codedArtCandidates.length)
    nextChecks.push(
      "Inspect codedArtCandidates for hand-coded production artwork. Replace script-drawn characters, props, decorative UI and primitive-assembled models with actual sourced/generated assets. Native text/layout, collision, temporary greyboxes and effects supporting real assets are allowed; literal matches alone do not prove a violation. Verify provenance and visible integration, not only a concept image.",
    );
  if (!referenceCandidates.length)
    nextChecks.push(
      "No local reference image candidates found under game/assets/references or generated. Before final modeling of a new game, generate and view a visual target; reuse established generated art for scoped edits. Search only supplements the required generation workflow. Check design/art.md for references elsewhere or online; absence here is a prompt to investigate, not proof that no reference exists.",
    );
  if (!assets.length)
    nextChecks.push(
      "No authored media files found. For a new game, generate and inspect a visual target and integrate suitable raster assets or reference-guided 3D art before expanding scope. Do not treat script-drawn placeholders as finished art; respect explicit user exceptions.",
    );
  if (!previews.length)
    nextChecks.push(
      "No saved preview found. Capture and inspect gameplay with world_preview_game; a loading screen is not a reviewed playable scene.",
    );
  if (!contentRequests.length)
    nextChecks.push(
      "No literal OpenFun generation endpoint found in game scripts. Inspect wrappers if present; otherwise implement a genre-appropriate AI continuation loop instead of a finite hardcoded sequence (unless explicitly requested).",
    );
  if (!stateRequests.length)
    nextChecks.push(
      "No literal OpenFun state endpoint found. Verify where generated content identities and player progress survive restart.",
    );
  return {
    kind: "source-inventory-not-quality-certification",
    truncated,
    assets: { count: assets.length, examples: assets.slice(0, 24) },
    codedArtCandidates: codedArtCandidates.slice(0, 24),
    uiCodeCandidates: uiCodeCandidates.slice(0, 24),
    uiTextureCandidates: uiTextureCandidates.slice(0, 24),
    generatedUiReceipts: generatedUiReceipts.slice(0, 12),
    audioCandidates: audioCandidates.slice(0, 24),
    referenceImageCandidates: referenceCandidates.slice(0, 12),
    scripts: scripts.length,
    generationSourceCandidates: contentRequests.slice(0, 12),
    persistenceSourceCandidates: stateRequests.slice(0, 12),
    previews: previews.slice(-6),
    nextChecks,
    limitations:
      "Literal matches may be comments or unused code; wrappers may hide endpoints. Existing images may be stale or unused; reference candidates may actually be sprites/textures and require visual inspection. This review does not execute code, judge art, or prove live AI generation.",
  };
}
