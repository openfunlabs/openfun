# Game UI with a specific identity

Use for HUDs, menus, rewards, inventories, dialogue and pause screens. Establish the game's visual language first; do not import a generic SaaS dashboard into every game.

## Design from player decisions

For each screen, identify what the player needs to notice and do next. During action, reserve the focal area for targets and threats; keep persistent HUD information compact and stable. A reward screen should make tradeoffs easy to compare. An inventory needs scanning and navigation more than ornamental panels. Match density to the genre rather than applying a universal minimalism rule.

Create a small Godot Theme: type hierarchy, spacing steps, panel treatment, semantic colors and focus/selection/disabled states. Use consistent icon language and game-appropriate materials. Honor the user's art direction; a neon or glass style is valid when intentional. Avoid habitual gradient headings, glowing borders, identical rounded cards, unrelated emoji and decorative counters. Replace generic praise and lorem ipsum with concise, accurate game language.

The open-source [Impeccable project](https://github.com/pbakaus/impeccable) emphasizes product-specific visual decisions and inspecting the real interface. Its web-oriented implementation is not a Godot theme; this guide adapts the review approach rather than bundling its browser detectors. The repository uses Apache-2.0; check current license/NOTICE if incorporating its code.

## Generate reusable UI art, keep live content native

For a new game's HUD and menus, **generate and integrate a cohesive text-free UI skin** with `world_generate_image purpose=ui`, using the approved visual target as a reference. A generic downloaded kit can supplement the skin but does not replace this new-game requirement. An unused mockup, a concept-only call, or a generated background behind otherwise code-drawn decorative controls does not count. Scoped edits and later content reuse the approved skin. Respect explicit user alternatives; service failure leaves UI art incomplete, not permission to silently draw substitutes.

Do not finish decorative panels, button surfaces or icons with StyleBoxFlat, ColorRect, draw\_\* calls, authored SVG or pixel drawing. Native Labels, layout, hit testing and simple contrast/focus overlays supporting textured controls remain necessary. This rule applies to actual HUD, inventory, dialogue and pause/reward screens, not only the title menu. Generate reusable parts rather than a flattened screenshot with invisible click zones.

Split responsibilities before generating:

| Element                 | Generate once                                         | Implement in Godot                                              |
| ----------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| Panel/dialogue          | Border, surface, corner ornaments, portrait frame     | PanelContainer and StyleBoxTexture, containers, live text       |
| Labeled button          | Text-free surface and matching visual states          | Button with themed StyleBoxTexture and localized text           |
| Fixed-shape icon button | Icon, normal/pressed/focus/disabled artwork as needed | TextureButton, focus, accessible label or tooltip, hit area     |
| Health/cooldown         | Empty frame and reusable fill texture                 | TextureProgressBar value or shader mask; separate numeric Label |
| Inventory/reward        | Reusable slot frames, rarity accents, item icons      | Item data, selection, quantities, navigation and tooltips       |
| Decorative artwork      | Background, crest, flourish                           | TextureRect preserving aspect ratio; live controls above it     |

Keep names, dialogue, prices, counters, key prompts and all localizable copy OUT of generated images. Use Label, RichTextLabel or Button.text with translation keys, font fallback and bidirectional layout when supported. Update values from game state without calling an image model. Never regenerate the same button for each label, language, item count or frame of animation. Even static text should be native unless the user deliberately requests a decorative wordmark.

Generate a small kit first: one panel family, one button family and the few essential icons. Request front-facing orthographic UI artwork, no perspective, no letters/numbers/watermarks, quiet text-safe centers and clear silhouettes. For nine-slice panels, request straight repeatable edges and corner detail confined to borders; keep central crests as separate overlays. Example prompt, adapted to the actual world: "A single text-free dialogue panel skin, teal enamel and restrained brass corners, front-facing, straight tileable edges, empty dark low-detail center for dynamic text, generous border-safe margins, transparent outside; no lettering, numerals, symbols resembling text, scene or mockup." Use reference editing for related assets and states to preserve dimensions, border geometry and material language.

Save generated originals, then prepare runtime assets under game/assets/ui/. Inspect actual dimensions and alpha: a painted checkerboard is not transparency, and a prompt requesting transparency does not guarantee an alpha channel. Re-generate/edit unsuitable art with the available image tool or use configured asset-processing tools to extract it; do not claim automatic background removal exists. Validate at gameplay size over both light and dark scenes. Avoid large multi-element sheets with uncertain crop boundaries; if using an atlas, measure actual regions, add padding against filtering bleed and store those regions explicitly.

When preparing a nine-slice skin, trim real transparent outside margins and use the resulting texture coordinates for texture/content margins. Verify the actual rendered result when using AtlasTexture: a crop region alone does not prove StyleBoxTexture margins refer to the expected pixels. If necessary prepare one cropped runtime texture using the engine/asset pipeline while retaining the generated original; do not redraw its artwork.

Record a short UI section in design/art.md: source/generated paths, runtime paths, node use, state mapping, slice margins, text-safe padding, target scale and filtering. This is practical asset metadata, not a mandatory questionnaire or a new project schema.

## Assemble the generated skin in Godot

Prefer native Button + shared Theme/StyleBoxTexture for text-bearing resizable buttons. StyleBoxTexture preserves corners through nine-slice scaling; set texture margins from the measured image border and content margins from the text-safe area (they are different). PanelContainer can use the same approach for content-driven panels. NinePatchRect is useful as a decorative panel; it does not by itself replace layout or a button. Do not stretch a whole ornate frame as one TextureRect. [StyleBoxTexture](https://docs.godotengine.org/en/stable/classes/class_styleboxtexture.html).

For each button define normal, hover, pressed, disabled and focus. Use consistent generated state variants where the material needs them; reuse the texture with modulation, a small offset or a deliberate focus overlay for simpler states. Do not generate five unrelated silhouettes. Keep sizes and slice margins aligned so hover/press does not shift layout. Focus should remain visible on top of the current state. TextureButton suits fixed-shape artwork but has no native text property: add a separate Label with mouse_filter = IGNORE, or choose a regular themed Button for text. Decorative children must not consume the intended control's pointer events. [TextureButton](https://docs.godotengine.org/en/stable/classes/class_texturebutton.html).

Use TextureProgressBar for a generated frame and fill; drive value/max_value from game state, with a separate Label for numbers. Set up the fill area so changing values does not stretch the frame or distort ornaments. [TextureProgressBar](https://docs.godotengine.org/en/stable/classes/class_textureprogressbar.html).

Use containers, anchors and minimum sizes so longer strings can wrap or expand panels. Keep fonts independent of raster skins; use font sizes and fallback fonts appropriate to supported languages. Test CJK, long translations and text scaling where relevant, and RTL layouts when supported. [Godot localization](https://docs.godotengine.org/en/stable/tutorials/i18n/internationalizing_games.html).

Load and share UI textures/themes once; avoid full-screen 2K/4K images for tiny icons, unbounded state variants, repeated image decoding, or generation/network work in input/frame handlers. Size textures for their visible use, choose filtering for the art style, and check memory/upload hitches when opening menus. Preserve semantic controls and real interaction even when most visible decoration is generated artwork.

## Implement states and input

Use Godot Control containers, anchors and shared themes for adaptive layout. Test the actual target resolutions, long localized text and larger text sizes. Keep body text legible over changing scenery with deliberate contrast. Convey critical state with more than color. Provide visible keyboard/controller focus where supported, predictable back/pause behavior, and mouse interaction. Prevent clicks on UI from accidentally triggering attacks beneath it. [Godot GUI documentation](https://docs.godotengine.org/en/stable/tutorials/ui/index.html).

Make pressed, unavailable, selected, loading and failed states distinct. Explain why an option is unavailable. A generation wait should preserve progress and expose an actionable retry; the player does not need provider names, JSON schemas or internal job IDs. Motion should clarify state changes and remain responsive to input, with reduced shake/flashes where applicable.

## Review

Inspect real gameplay and menu captures at the supported resolutions. Ask whether the UI could be dropped unchanged into an unrelated game; if so, identify which typography, information hierarchy or material treatment needs a game-specific decision. Check goal visibility, selected state, text overflow, occlusion and visual competition with the world. Inspect nine-slice corners at narrow and wide sizes, alpha fringes, icon cropping and normal/hover/pressed/disabled/focus states. Change labels, language and counters without regeneration; verify that text stays in its safe area and decorative children do not block clicks. Exercise the actual controls, including failure and return paths. Fix the most consequential issues in one batch and confirm; do not consume endless generation rounds chasing a subjective score.

[Godot's official demos](https://github.com/godotengine/godot-demo-projects) include native GUI examples. Demo code and individual fonts/art may have different notices; verify the selected files before reuse. No third-party UI assets are bundled here.
