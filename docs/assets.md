# 资产制作

OpenFun 使用 Godot 运行游戏，结合 Meshy 与 Blender 制作三维资产。创作会话和新项目 OPENFUN.md 共享创作指引，无需额外问卷或 Plan 模式。

新游戏默认使用图像生成模型建立初始视觉目标；实际素材优先复用项目与合适的素材库，仅为缺口和独特资产生成。无需每个素材或每个后续关卡都重新生图。只修复已有代码或玩家明确要求跳过生图时例外。

1. 确定风格、镜头和色板，调用 `world_generate_image` 生成并查看游戏镜头的视觉目标。用户参考图可作为输入，网络搜索用于补充。
2. 先检索、复用一组风格一致的关键素材，再生成缺少的素材或建模参考。2D 将精灵、背景、头像等实际接入游戏；3D 在 Meshy 已配置且用户已授权时，主动使用图生模型制作合适的主要角色、道具等，再用 Blender 修整；精确结构或不适合生成的资产可用 Blender 制作。独立计费是费用说明，不是禁止调用。已有授权无需逐阶段重复确认，但用户明确的预算、离线或服务限制仍须遵守。
3. 代码负责玩法、布局、特效和资源整合。不能把纯代码绘制的基础形状、方块和球体当作最终主要美术，也不能只生成一张概念图就算完成。
4. 在 `design/art.md` 记录图片路径及实际用途，在 Godot 游戏镜头下检查与视觉目标的差异并修正。模型仍需处理比例、碰撞、动画和玩法衔接。

生图不可用时说明登录、配置或额度等实际阻碍，继续机制与灰盒工作，但明确最终美术未完成，不静默切换 provider 或声称已经出图。后续编辑复用已有成果，避免重复生成。

world_build_asset 调用 tools/blender/build.py，通过受限几何配方生成带材质的 GLB，适合简单资产；它不是 Blender 全部能力的上限。复杂资产可以由原生文件/Shell 工具或配置好的 MCP 服务制作。world_import_asset 验证并导入本机 GLB。

## UI 素材与动态内容分离

新游戏的 UI 也纳入生图流程：先生成风格一致的无文字面板、按钮底图、边框、图标和血条纹理，再放进 Godot 原生控件。文字、数值、翻译、布局、焦点和点击行为由代码负责，同一张底图可用于不同标签或语言，不随血量变化重新生图。

可变大小的面板和文字按钮使用 Theme + StyleBoxTexture 九宫格拉伸，固定造型按钮使用 TextureButton，血条使用 TextureProgressBar。素材放在 `game/assets/ui/`，原始生图保留；在 `design/art.md` 记录切片边距、文字安全区和状态映射。必须检查真实透明通道、不同分辨率、长文本以及正常/悬停/按下/禁用/焦点状态。整张 UI 效果图只能作为参考。

具体提示词、控件选择和验收步骤见内置 [UI 指引](game-design/ui.md)，Agent 使用 `world_design_guide ui` 读取。此更新提供创作与验收工作流，不新增自动切图或抠图服务。

## 实时生成边界

地图与关卡通过 /content/jobs 异步预取，验证后激活并持久保存。资产应使用稳定标识、复用已有产物，等待时不阻塞游戏主循环。此 API 生成结构化数据，不执行任意 Blender 作业。

独立 Blender MCP 实验曾从同一场景输出带材质的宝箱 GLB 和透明正交 PNG，证明文本建模可同时用于三维素材和预渲染精灵。但完整 MCP 建模尚未接入后台任务调度。通用实时建模仍需实现并验证调度、产物校验、缓存与加载；元数据不等于生成模型。研究脚本和本机模型环境不属于产品发行内容。

## 图像生成

OpenFun 默认内置轻量 pi 扩展 `world_generate_image`。它通过 pi 的 `modelRegistry.getApiKeyAndHeaders` 使用当前 Codex 模型和 OpenFun 独立的原生登录态，向订阅 Responses 端点发送托管 `gpt-image-2.5-sunburst` 工具请求（默认；`imageModel` 可明确选择 `gpt-image-2.5-flare` 或 `gpt-image-2`），不启动 Codex CLI，不复制认证，不切换模型，也不自动回退到按量付费 API。

在 OpenFun 中使用 `/login` 单独登录 OpenAI Codex（不继承本机 pi 的登录），使用 `/model` 选择 Codex 模型，然后正常描述需求，例如：

> 先为森林药剂师的宝箱生成概念图，深青色木材、黄铜包角和琥珀药瓶。看图后搜索匹配模型，或使用 Meshy 图生 3D，再用 Blender 优化。

工具参数为 `prompt`、可选 `references`（最多五个当前项目内的 PNG/JPEG/WebP 路径）、可选 `size`。返回实际路径、尺寸和字节数。请求尺寸是发给服务的目标，实际尺寸以返回结果为准。图片保存到当前项目 `game/assets/generated/<uuid>.png`，不会覆盖已有文件，并可随游戏资源一起分享。参考图总计不超过 24 MiB；项目外图片需先复制进项目。可在 `plugins.json` 中设置 `"images": false` 关闭内置扩展。

建议流程：生成概念图 → 用 pi `read` 查看 → 保存简短美术规范 → 搜索匹配模型或使用 Meshy 图生 3D，再用 Blender 优化 → 导出 GLB 并接入 Godot → 用 `world_preview_game` 检查游戏画面。图像生成不会自动重建三维网格，多个视角也不保证几何完全一致。已有创作工具可以执行 Blender 脚本；后台内容任务仍不执行完整建模作业。

订阅请求使用 `stream: true` 和 `instructions`，读取最终 `response.output_item.done` 图片，在收到整个响应成功完成后才保存。不会将局部预览当作最终资产。失败、限额或超时不自动重试。图像调用计入订阅额度。

实测：2026-09-08 使用 pi 登录态和 GPT-6 Astra 成功获取 GPT Image 2 概念图，并通过原生 pi 工具引用该图生成另一视角。实测服务未严格遵守请求尺寸，保存与报告使用 PNG 的实际尺寸。此前 `pi-openai-toolkit@0.12.0` 使用非流式请求的路径返回 HTTP 400；本扩展使用订阅流式协议。协议来自公开实现的研究，第三方订阅接入并非 OpenAI 承诺稳定的通用 API。

手动真实验证（消耗订阅额度）：

```sh
pnpm test:live images gpt-6-astra
# 第二个参数是 .output/image-live 内的参考图片路径
pnpm test:live images gpt-6-astra concept.png
```

## Meshy 建模、材质与角色动画

先在 OpenFun 中使用 `/login meshy` 填入密钥，或设置 `MESHY_API_KEY`。该服务使用独立 Meshy API 额度，不包含在 Codex 订阅中。密钥只由 OpenFun 的原生登录存储管理，不传给生成工具的参数。

可以直接告诉 Agent：“先生成并检查药剂师宝箱的参考图，再用 Meshy 做带纹理的 3D 模型，接入 Godot，并检查实际画面。”当前聊天模型无需切换。主体完整、背景干净、遮挡少的单物件参考图比整张游戏场景更适合作为输入。

- `world_generate_model`：传入稳定的 `key`（如 `chest-v1`）和项目内 `reference` PNG/JPEG 路径，提交一次任务。支持 `targetPolycount`、`texturePrompt`、`pose`。图片会上传至 Meshy，上限 20 MiB。
- `world_model_status`：用同一个 `key` 查询一次进度；完成时下载 GLB 至 `game/assets/generated/`，返回可供 Godot 使用的 `res://` 路径。等待期间继续其他创作工作，避免频繁轮询。
- 默认使用 Meshy 7、纹理/PBR、2K 纹理和约 10,000 面的三角网格重拓扑。面数为目标值。产物必须为不超过 32 MiB 的自包含 GLB；下载或校验失败不会以占位模型冒充成功。

任务保存在项目 `.openfun/meshy/`，重启后可以继续查询。相同 `key` 与输入不会重复提交；有意重做时使用新的版本 key。提交超时不自动重试，以免重复扣费：先查 Meshy API 任务列表（API 任务与网页资产列表分开），再用 `world_model_status` 的可选 `taskId` 恢复未确定的任务。下载失败只重新查询和下载，不重新生成。可分享内容仅包含 GLB 与来源记录，不包含 API key、临时下载链接或原始响应。

这是一条创作时的异步资产管线，尚未直接接入游玩 Host 的后台资产调度。生成结果仍需处理比例、碰撞、动画播放与玩法衔接，并在 Godot 实际检查材质和画面。Tripo 目前可通过 `/login tripo` 保存密钥，生成 API 尚未集成。

2026-09-08 实测：使用此前 GPT Image 2 生成的药剂师宝箱参考图，仅提交一个 Meshy 任务，成功获得 9,138,536 字节的 GLB。Blender 导入得到 10,057 个三角面和 3 张 2048×2048 的 PBR 贴图；Godot 导入并通过按键切换渲染了三个不同角度，无脚本错误。颜色和主要造型保留，但它是单个静态网格，没有骨骼或动画，开箱/拿取药瓶仍需拆分部件和实现交互。这是单个道具的验证，不代表所有类型资产的质量。

本地模拟接口、原生登录和错误恢复另有自动化测试。显式付费测试：

```sh
pnpm test:live meshy /path/to/game game/assets/references/chest.png chest-v1
```

参考：[Meshy 图生 3D API](https://docs.meshy.ai/en/api/image-to-3d)、[Meshy 认证](https://docs.meshy.ai/en/api/authentication)。

参考：[OpenAI 图像生成](https://learn.chatgpt.com/zh-Hans/docs/image-generation)、[pi-openai-toolkit](https://github.com/awoaCrim/pi-openai-toolkit)、[pi-codex-image-tool](https://github.com/ross-jill-ws/pi-codex-image-tool)、[Tripo 图生模型](https://developers.tripo3d.ai/en/docs/generation-image-to-model/p)。

Meshy 新增工具：

- `world_generate_model` 也接受 `prompt`（与 `reference` 二选一）：文本生成的是未贴图 preview，随后通过 `world_process_model` 的 `refine` 操作上色。这是两个独立计费任务。
- `world_process_model`：`refine` 完善文本预览；`retexture` 用文字或图片换材质；`rig` 给带纹理的双足人形自动绑定；`animate` 给完成绑定的角色应用动作库动作。每一步使用新的 `key`，通过 `sourceKey` 引用已完成任务。重新贴图和绑定也支持项目内 Blender 导出的自包含 `model` GLB，会上传模型至 Meshy。
- `world_animation_library`：免费查询实时动作目录，支持搜索和分类。先选择返回的 `action_id`，再传给动画操作；不要编造 ID。
- `world_model_status`：统一查询所有阶段并下载 GLB；绑定任务可选择 `output: "walking"` 或 `"running"` 下载服务实际返回的附带动作，缺少该输出时明确报错。下载不会创建付费任务。

例如：`guard-preview-v1` 文本建模 → `guard-painted-v1` refine → `guard-rig-v1` rig → 查询动作库 → `guard-attack-v1` animate。每一步完成后先查询状态。也可以从检查过的角色参考图直接生成带纹理模型，或从 Blender GLB 开始。

自动绑定主要适用于带纹理、肢体清晰分离的常规双足人形；建议 A/T pose，上传 GLB 朝 +Z，面数不超过 300,000。它不能替代宝箱铰链、机械结构或非人形的专用绑定。骨骼和动画下载有结构检查，但变形质量、动作衔接、武器挂点、攻击判定、碰撞与游戏状态仍需在 Blender/Godot 中实现并实测。文本生成动作、自动减面等 API 暂未作为原生工具接入。

Meshy 已有 MIT 开源的[官方 MCP](https://github.com/meshy-dev/meshy-mcp-server)和[官方 CLI](https://github.com/meshy-dev/meshy-cli)，不需要再造服务器。OpenFun 当前直接接入这些选定 API，复用自己的登录、项目任务记录与资产导入；无需额外安装 CLI（其要求 Node 24+）或维护第二份凭据。需要更广泛功能时可通过已有 MCP 插件配置官方服务器。

接口参考：[文本建模](https://docs.meshy.ai/en/api/text-to-3d)、[重新贴图](https://docs.meshy.ai/en/api/retexture)、[绑定限制](https://docs.meshy.ai/en/api/rigging)、[动画](https://docs.meshy.ai/en/api/animation)、[动作目录](https://docs.meshy.ai/en/api/animation-library)。

alpha.20 验证：121 项本地测试通过，包括新增接口的模拟任务链、输出缓存、错误恢复与原生插件加载；已使用配置的 Meshy 账户真实查询免费动作目录，并验证 alpha.19 宝箱任务离线复用。新增文本、贴图、绑定和动画付费链路尚未进行真实服务端生成测试。

Asset selection follows visual quality: configured and authorized Meshy is encouraged for suitable principal assets and necessary processing stages. An Agent-authored Blender-first plan must be reconsidered under current user instructions; genuine user constraints remain binding. Tripo credentials can be stored, but its generation API is not yet integrated.

## Reusable asset libraries (alpha.30)

Before generating common assets, inspect the project's existing `game/assets/`, search suitable free resources and reuse a coherent kit. Keep the initial generated visual target for art direction; existing models, materials, sprites or UI artwork do not need to be regenerated to satisfy that target. Use Meshy/image generation for missing assets and distinctive characters, then refine and verify in Godot. Existing authorization for generation remains valid.

Three bundled native pi tools work without accounts or extra MCP installations:

- `world_search_assets`: `source: "local"` indexes imported library receipts in this project; `"polyhaven"` or `"ambientcg"` searches a free online catalog. Use English keywords, `kind` (`all`, `models`, `textures`, `hdris`), `limit` and `offset`. This is keyword search, not visual similarity or a universal local asset index.
- `world_asset_info`: supply a returned `provider` and `id`; inspect available variant keys, sizes, source and license. For Poly Haven models choose `gltf/1k/gltf` where offered. Other variants are individual PBR maps or HDRIs. ambientCG offers material ZIPs such as `default/1K-JPG`.
- `world_download_asset`: supply the same provider/id and the exact returned `variant`. Imports under `game/assets/library/`, including a model's referenced textures/buffers or a material archive's supported images. Optional Blender/USD/MaterialX/material-definition files in ZIPs are skipped and reported; create the Godot material from the actual texture maps. Original imported files are immutable to this tool: repeat imports validate hashes and work offline, while user edits are preserved rather than overwritten. Make customized copies separately.

Imports carry `asset-source.json` and `ASSET-LICENSE.md` with provider, source URL, CC0 license, variant and file hashes. These accompany game resources in sharing packages. Metadata is cached for an hour in the creator process; downloaded resources are reused within each project across sessions. There is no global cross-project cache yet. Downloads are bounded to 32 MiB per file and 64 MiB per selected asset; large photo-scanned assets may require a smaller variant, and normal sharing-package limits still apply. Godot scale, PBR setup, collision, polycount and scene lighting still need inspection. The tool does not automatically instantiate gameplay scenes.

These are authoring-time tools. Pre-import the asset kit and reference its stable paths when authoring runtime continuation. The gameplay content Host does not automatically browse or download arbitrary new models during play. Reusing models should accompany new objectives, layouts and consequences, not repeated gameplay.

### Provider assessment, checked 2026-09-08

| Source                                                                   | Assets and access                                                                                                                                                                                                                                     | OpenFun status                                                                                                                                         |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Poly Haven](https://polyhaven.com/our-api)                              | CC0 models, PBR maps and HDRIs; public HTTP API without login. Live API use requires a unique User-Agent and visible source credit.                                                                                                                   | Native search/info/import, including glTF dependencies. Powered by Poly Haven.                                                                         |
| [ambientCG](https://docs.ambientcg.com/api/v2/full_json/)                | Public metadata/download API; [CC0 assets](https://docs.ambientcg.com/license/).                                                                                                                                                                      | Native search/info/import using the working v2 endpoint. Material ZIPs and HDRI variants supported; v3 also exists.                                    |
| [Kenney](https://kenney.nl/support)                                      | CC0 game packs, useful for coherent 2D, UI and stylized 3D kits.                                                                                                                                                                                      | Web/download workflow; no native catalog adapter or official API verified in this review.                                                              |
| [Blendkit, formerly BlenderKit](https://www.blendkit.com/plans/pricing/) | Free and subscription libraries; official [local client API](https://github.com/BlenderKit/bk_client/blob/main/client/docs/API.md) supports search/download, and an official [Godot plugin](https://www.blendkit.com/blendkit-in-godot/) is in alpha. | Best next subscription integration candidate; not installed or integrated. Respect per-asset license and user entitlement.                             |
| [Synty](https://syntystore.com/en-gb/community/faq)                      | Cohesive stylized packs and All Access Pass; source-format availability varies by pack.                                                                                                                                                               | Evaluate as a user-owned local kit first; no supported automation API verified. Do not bundle paid source assets into freely editable world downloads. |

Subscriptions are not interchangeable with CC0. Blendkit's [royalty-free FAQ](https://www.blendkit.com/docs/licenses/licensing-faq/) permits games subject to extraction restrictions; Synty's [one-time license](https://syntystore.com/pages/one-time-purchase-licence) restricts source sharing and uploading models to third-party 3D generation services. Consult the license for the actual purchase/subscription before implementing sharing or Meshy processing for these assets. OpenFun's MIT code license does not relicense artwork.

Community Poly Haven MCP adapters exist, for example [dcc-asset-polyhaven](https://github.com/dcc-mcp/dcc-asset-polyhaven). This version uses the official HTTP API directly so users need neither another server nor an open Blender session just to search and import. No third-party adapter code or asset packs are bundled.

Explicit real-service verification (no model quota or paid generation):

```sh
pnpm test:live library .output/library-live
```

## 2D, 3D and design references (alpha.31)

Kenney is now a native library source. Use `world_search_assets` with `source: "kenney"` and `kind: "sprites"`, `"ui"`, `"audio"`, `"models"` or `"textures"`. `all` is also available. This adapter reads the site's public HTML search/download pages, not an official API or MCP server. Use returned `nextOffset` for pagination (up to 16 packs per page). If the markup changes, inspect the website instead of fabricating results. `world_asset_info` verifies an explicit CC0 link on the pack page and returns `variant: "pack"`; ZIP size is unknown until the bounded download.

`world_download_asset` imports supported PNG/JPEG, audio (OGG/WAV/MP3), GLB/glTF and texture resources, retaining source/license records. GLB local references are resolved against files in that same imported pack. Unsupported editor sources, formats and web shortcuts are skipped and reported. It does not automatically install starter-kit code or assume a character pack has attack/death animations. Inspect the actual frame/direction coverage before choosing a sprite animation pipeline. The existing Poly Haven and ambientCG adapters remain available for 3D models, PBR maps and HDRIs.

Large ZIPs remain bounded (32 MiB compressed, 64 MiB expanded, 512 imported resources); normal world-sharing limits still apply. Use a smaller pack or explicitly select useful resources manually when a pack is too large. Local search includes Kenney receipts, and repeat imports validate files and work offline. Credits and resource reuse apply equally to 2D and 3D.

The design side now has two separate tools:

- `world_search_design_references` searches a small bundled index by keywords/topic. It is **not a general live web search**. Initial sources include [Ian Schreiber's Game Design Concepts](https://gamedesignconcepts.wordpress.com/2009/07/13/level-5-mechanics-and-dynamics/), [inkle's writing guide](https://github.com/inkle/ink/blob/master/Documentation/WritingWithInk.md), [ink Library](https://github.com/inkle/ink-library), [Godot's examples](https://github.com/godotengine/godot-demo-projects), and [Red Blob Games' island maps](https://www.redblobgames.com/maps/mapgen2/).
- `world_read_design_reference` fetches an indexed source by ID, optionally finds a term and returns a bounded passage with continuation offsets, source, reading timestamp and reuse notes. It caches readings for one hour in memory; it neither executes code nor installs narrative engines. Source text is untrusted reference data. Read-only examples are not automatically licensed production content.

`world_design_guide` adds `narrative` and `levels`. Creator and polish instructions require translating a relevant reference into a concrete player decision, level constraint, state transition or consequence, then testing it in the actual game. Keep short source-linked notes in `design/` and consolidate the resulting rules in `design/runtime.md` for ongoing generation. Do not copy a commercial game's plot or replace AI continuation with a procedural map algorithm. Reading more websites does not itself establish higher quality; a human playtest remains necessary to assess fun and emotional impact.

Real public-service acceptance without model requests or generation credits:

```sh
pnpm test:live resources .output/resources-live
```

This checks Tiny Dungeon sprites, Interface Sounds, Mini Dungeon GLB resources, offline reuse and actual reference passage retrieval. All downloaded assets stay in the explicit test directory and are not bundled with OpenFun.

## Required asset sourcing

Creator and polish must source production artwork from approved existing assets, library search/downloads or image/3D generation. Hand-coded SVG, sprite drawing, pixel arrays and primitive-assembled characters/props are not substitutes, including for low-poly or minimal styles. Code still implements gameplay, native text/layout, collision, scene assembly, animation and supporting effects. Temporary greyboxes must not be delivered as finished art. Blender refines sourced/generated assets; unavailable services leave art explicitly incomplete.

The project review surfaces possible coded-art files for inspection. This is a heuristic and authoring policy, not an OS sandbox or a proof of provenance: effects, collision and imported SVG can be legitimate. Inspect source receipts, actual files and their visible gameplay use. Existing approved kits do not need to be regenerated for every edit.

Image transport retains completed image bytes when terminal summaries omit them, while still requiring terminal success. Structured service errors report bounded, credential-redacted code/parameter/message diagnostics; raw error bodies are not exposed and failed requests are not retried automatically. The default remains GPT Image 2; no automatic model or paid-API fallback is introduced.

Library kits and their Godot import-setting files are supported by the sharing/preview pipeline up to 4,000 game resources (4,096 archive entries including metadata). Resource bytes remain bounded at 96 MiB, single resources at 32 MiB and the whole archive at its existing limits. Limit errors identify the offending path and whether file count or size was exceeded. Keep an appropriate kit and source/license receipts; moving unused originals is preferable to destroying provenance. This fixes the calibration case where two supported library packs plus import metadata exceeded the old 480-resource limit.

## Music and generated UI skins

`world_search_assets source=opengameart kind=music` searches live CC0-filtered music pages. Inspect `world_asset_info` and download a returned individual OGG/MP3/WAV variant with `world_download_asset`. This is a public-page adapter, not an official API; it rejects unverified licenses and does not import ZIP-only albums. Existing download size/path/redirect checks and source receipts apply. `kind=audio` local search also finds imported music. See `world_design_guide audio` for selection, licensing, loops, transitions and mute; Incompetech and itch.io are additional browser sources, not native integrations.

For new-game UI, `world_generate_image purpose=ui` generates a reusable text-free skin and saves a `.png.source.json` receipt recording the requested image model and purpose. Apply the actual skin to native Godot controls, keep text/values dynamic, and reuse it for later content. New-game requirements cover gameplay HUD, dialogue, inventory and menus; a concept-only image or generic kit alone does not satisfy them. Review reports flag UI source candidates and receipts without pretending static matches certify quality.

GPT Image 2.5 Sunburst is the default image tool model; conversation model selection is unchanged. Flare and legacy Image 2 require explicit `imageModel` selection. No silent downgrade or API-billing fallback. Returned dimensions are measured from the PNG: do not assume the requested size is guaranteed by the subscription endpoint. See [official Sunburst model documentation](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst).
