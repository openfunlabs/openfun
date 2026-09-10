# OpenFun

用对话创作、探索和分享持久化的游戏世界。

OpenFun 复用 pi 的原生终端、模型选择和登录，由 Agent 编辑当前目录的 Godot 游戏，并通过 Blender 制作资产。支持 2D、2.5D 和 3D。游玩时可以提前生成后续地图、关卡和剧情，保存结果与玩家进度。

## 为什么是独立 CLI，而不只是 Skill

OpenFun 不仅要在创作时指导 Agent 写游戏，还要在玩家游玩期间持续运行生成服务。`/play` 启动 Godot 和本地 Host：Host 调用所选模型、调度异步生成、限制预算、保存任务与游戏状态，并在重访或重启时复用已生成内容。后续生成不依赖创作对话一直进行，停止游戏/Host 后则停止生成。

Skill 可以承载工作流，也可以指导 Agent 启动外部程序，但 Skill 文档本身不提供持续运行的队列、服务和存储。独立 CLI 把这些运行时能力、登录和引擎启动整合成玩家可安装的产品；Skill/内置指南是其中的创作知识层。

## 安装

需要 Node.js 22.19+ 和 Godot 4；制作三维资产时需要 Blender。pi、MCP 适配器、Context Mode 与官方问答扩展随包安装，无需预装全局 pi。引擎及大体积模型不在包内。

目前尚未发布 npm registry，请从本仓库构建安装包，避免误装同名包：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm pack --pack-destination .output
npm install --global --ignore-scripts ./.output/openfun-<版本>.tgz
openfun setup
mkdir my-world
cd my-world
openfun
```

将 `<版本>` 替换为 package.json 的 version。安装时跳过依赖安装脚本，避免 Context Mode 修改其他客户端配置。命令为 `openfun`，由包管理器直接安装，无需创建别名。

启动后用 `/model` 选模型，必要时 `/login`。告诉 Agent 想创作的游戏；用 `/play` 启动游戏窗口，对话仍可继续。无参数启动只打开当前目录的世界，不搜索父目录或最近项目。新目录首次启动会创建世界。创建或打开其他项目时，退出 OpenFun，在终端切换到目标目录后重新运行 `openfun`。

需要图生 3D 时，用 `/login meshy` 配置独立 Meshy API key，然后让 Agent 根据参考图生成带纹理模型并接入游戏。详见 [资产制作](docs/assets.md)。

## 常用操作

| 命令                         | 用途                       |
| ---------------------------- | -------------------------- |
| /play                        | 启动当前游戏               |
| /play --generation-budget 24 | 设置本次游玩的 AI 请求预算 |
| /stop                        | 停止游戏与 Host            |
| /new                         | 同一世界的新对话           |
| /world                       | 查看当前项目信息           |
| /mcp                         | 管理 MCP 服务              |
| /ctx-stats                   | 查看 Context Mode 状态     |

```sh
openfun create ./arena --no-chat
openfun check ./arena
openfun preview ./arena --demo
openfun play ./arena
openfun pack ./arena --output ./arena.openfun
openfun import ./arena.openfun ./shared-arena
openfun play ./shared-arena --trust-project
openfun doctor
```

新项目从空白 Godot 入口开始，不预填示例游戏、玩法、角色或场景。Agent 根据你的需求创作实际游戏。可通过 `--template /path/to/godot-project` 明确提供你自己的 Godot 项目。示例创建命令 `openfun demo` 已移除。`--demo` 仅用于无模型接口测试，不提供示例游戏；空白项目尚不是可玩的作品。

世界包可以包含游戏源码、资源、公开设计文档、已生成内容和存档。首次执行导入的游戏需显式信任；分享包不包含作者登录信息。现在仅支持 Godot，不支持浏览器游戏或引擎切换。

## 可选的持续打磨

第一版完成并验证后，Agent 可通过 pi 原生确认框邀请玩家继续打磨；选择同意即开始。也可直接输入 `/polish`，或指定方向，如 `/polish improve combat feedback and level pacing`。默认关闭，**不设轮次、总时长或工具调用次数上限**；仍使用当前模型、已有服务配置和各服务本身的额度。

OpenFun 在当前项目 `.openfun/polish/` 中创建候选副本，用内置 pi 连续执行“观察 → 选择重点 → 修改 → 实际预览与检查 → 保留或回退”。每轮只处理有依据的主要问题，延续美术和剧情方向，并同步后续内容生成规则。判断目标达成、没有实质收益或需要玩家选择时结束/暂停；失败也会暂停，不静默重试付费生成。

| 操作                     | 用途                                                 |
| ------------------------ | ---------------------------------------------------- |
| `/polish status`         | 查看进度、最近报告及候选路径                         |
| `/polish stop`           | 中止当前工作并暂停；不等于停止游戏                   |
| `/polish resume [focus]` | 明确恢复，丢弃中断轮次并从已保留检查点继续           |
| `/polish apply`          | 游戏停止后应用已验证候选；也可应用暂停前已接受的轮次 |
| `/polish discard`        | 放弃尚未应用的候选，保留原游戏                       |

普通聊天输入会先暂停后台打磨；切换模型、退出或新建会话也会停止本会话工作。重启不会自动续跑。每轮摘要显示在终端，完整报告和检查点留在本项目；不会写入分享包或替换玩家存档。

完成后，只有原目录未被修改、游戏已停止且候选未变化时才自动应用。否则保留候选，供玩家停止游戏后应用或手动审阅合并。原始 `game/` 和 `design/` 会保留备份；原世界数据库、运行时已生成内容及存档不被候选数据库覆盖。涉及存档迁移时要求模型暂停交由玩家决定。

候选目录用于避免误改正在玩的版本，**不是操作系统安全沙箱**。验证要求包括最后一次修改后的无引擎错误预览，以及独立的 Godot 导入检查；这些能检查链路和明显回归，不能客观保证更美观或更好玩。后台模型看到的是近期报告和当前候选，不会凭空获得人的游玩体验。当前复用分享包的资源格式和大小约束，超出约束会明确报错。

## 能力与边界

Agent 可以实现游戏脚本、场景、美术与玩法；创作指引要求检查实际画面和玩法，不能保证任意需求都一次生成精美完整游戏。后台内容任务生成结构化数据，完整 Blender MCP 实时建模尚未成为后台服务。内置 world_generate_image 已通过 pi Codex 订阅真实出图测试，可用于概念图、贴图与建模参考；图生三维模型仍需 Blender 制作或额外服务。多人联机、云端作品社区及跨平台签名安装器尚未交付。

OpenFun 源码采用 MIT。Context Mode 使用 Elastic-2.0，Godot、Blender 等组件保留各自许可证，详见 [第三方声明](THIRD_PARTY_NOTICES.md)。

开发和测试见 [CONTRIBUTING](CONTRIBUTING.md)。源码文档位于 docs/：architecture、configuration、assets、runtime-protocol、world-format。配置、实验和测试输出应放在源码目录之外或被忽略的 .output/，不要把个人世界当作仓库示例提交。

OpenFun 使用自己内置的 pi 和独立的 `~/.openfun/agent/` 配置。不会继承本机 pi 的账号、插件或 `.pi` 项目配置；首次使用请在 OpenFun 中通过 `/login` 登录并用 `/model` 选择模型。

### 创作质量与持续生成

OpenFun 会在每轮创作中提供当前项目的素材、预览与生成接口线索；Agent 也可用
`world_review_game` 更新检查。默认创作流程先打磨一个完整的游戏画面，再扩展内容，
并按游戏类型设计持续生成的区域、关卡、事件或任务。明确要求有限或离线游戏时遵循用户要求。

检查工具只提供源码线索，不会给美术打分，也不能证明接口已经执行。交付前仍需查看
`world_preview_game` 的真实画面，测试后续内容激活和存档恢复，并区分测试数据与真实 AI 生成。
持续生成受 Host 的预算和并发限制；后台数据生成不会自动生成新的 Blender 模型。

基础玩法可用后，Agent 应主动把实际游戏规则整理到 `design/runtime.md`：固定机制、可生成内容、关卡或剧情约束、难度与奖励边界、角色连续性、资源清单、预取触发与存档规则。随后把这些规则落实为游戏的 schema、异步请求、校验与激活代码。Host 会读取世界及设计文档；只写规则、不接入游戏不能算完成。

每次实现重要效果或机制后，应主动启动游戏，操作该功能并检查画面、日志和状态，修复后重新验证。视觉预览不申请新 AI 内容；运行时生成必须另测“当前内容游玩中预取下一段 → 激活 → 保存 → 零预算重启恢复”，并明确区分模拟数据测试与真实模型测试。

新游戏默认使用生图生成并检查视觉目标及关键素材。用户参考图和搜索图片可作为补充；UI 使用无文字素材配合 Godot 动态文本和交互。参考路径、具体美术决策与素材用途记入 `design/art.md`，完成后对照实际游戏截图。修复代码或延续已有美术时复用现有成果。

### 动作、玩法、性能与游戏 UI

内置 `world_design_guide` 提供五份按需读取的指南：`animation`、`mechanics`、
`performance`、`ui`、`runtime`，包含制作步骤、测试方法和原始资料链接。内容是 OpenFun 编写的
实践指南，不包含整本书、视频转录或第三方游戏素材。Agent 应在相关设计与修改前读取。

`world_preview_game` 支持最长 120 秒的隔离诊断，可发送定时动作、键盘、鼠标按钮输入，
默认以 headless 方式运行，不打开窗口、不抢鼠标、不播放声音。返回实际输入时间和预热后的模拟帧间隔 p50/p95/p99、
最大间隔、超过 50 ms 的次数及部分引擎计数。使用前必须核对游戏的实际输入绑定。
例如按名为 `attack` 的 Godot action 攻击：

```json
{
  "seconds": 3,
  "inputs": [
    { "at": 1, "kind": "action", "name": "attack", "pressed": true },
    { "at": 1.1, "kind": "action", "name": "attack", "pressed": false }
  ],
  "captureTimes": [0.8, 1.05, 1.2, 1.5, 2.5]
}
```

输入与截图时间从场景启动后计算，需要给场景加载留时间；不存在的动作会明确报错。
该工具不修改原世界存档，不申请新 AI 内容。帧间隔包含系统调度、VSync 与截图开销，
用于发现问题，不能替代目标设备上的正式构建性能测试。截图不能单独证明碰撞正确、
动画自然或玩法有趣；仍需配合实际游戏状态、日志和人工游玩。

参考资料与具体工作流见 [动作](docs/game-design/animation.md)、
[玩法](docs/game-design/mechanics.md)、[性能](docs/game-design/performance.md)、
[游戏 UI](docs/game-design/ui.md)。

### OpenFun 的终端界面

启动页显示 OpenFun 版本、当前世界和创作/游玩入口。底层 pi 版本与插件配置可通过
`/about` 查看；`/model`、`/login` 和会话功能继续使用内置引擎。默认精简启动资源列表，
仍显示加载错误；需要详细信息时，可在 `/settings` 关闭 Quiet startup，或使用
`openfun -- --verbose`。已有明确的启动偏好会保留。

这层界面适配使用 pi 的公开扩展接口，没有修改其上游代码或伪造底层版本号。
部分高级设置和第三方插件界面仍保留原有名称。

OpenFun's CLI interface and system notices use English. User-authored world names, game text,
and conversations retain their chosen language. Startup suppresses only Node's known SQLite
experimental-status warning; other warnings and errors remain visible. Set
`OPENFUN_SHOW_RUNTIME_WARNINGS=1` to include that warning when diagnosing the runtime.

### Developing future content

Runtime content requests now receive recent published results and the latest save from the same namespace, in addition to world/design documents and game-supplied context. The generator is instructed to develop consequences, objectives, relationships and spatial challenges instead of reskinning previous levels. Published content is not assumed to have been played. Existing keys still replay their original content without a model call.

New-game authoring must implement a development arc, meaningful content grammar and game-specific repetition checks, then verify three successive unseen units and a consequential choice. Existing games with narrow schemas still need their game code/design expanded; this update does not automatically add mechanics, generate runtime meshes or rewrite saved levels. See [the runtime design guide](docs/game-design/runtime.md).

### Character motion and death presentation

The bundled animation guide covers coherent reference-based sprite keyframes, 2D cutout rigs, Blender-rendered sprites and retargeted 3D clips, with source links and integration checks. New projects include an editable `game/openfun_death_lifecycle.gd` helper: combat death is immediate and idempotent, while reaction/fall, final-pose hold and cleanup remain separate presentation stages. The helper is not an animation asset; authors still need suitable poses or clips and synchronized gameplay events.

The roguelite example retains defeated actors through a basic fall/hold/fade instead of deleting their visuals on the lethal frame. Its geometry and motion remain demonstration assets. Existing games are preserved; ask the creator or `/polish` to adapt their animation pipeline. Optional external tools/libraries are documented, not automatically installed or bundled.

Run `node --import tsx tests/e2e/death-animation.mjs --visual` with Godot available to exercise lethal-hit handling and capture impact/fall/rest/fade/cleanup frames. It uses deterministic test content and makes no paid model calls.

Animation quality can be validated with real Meshy assets using the explicit live animation test. The bundled Godot animation probe captures imported poses and normal playback. New projects also include `openfun_mesh_materials.gd` for restoring original PBR materials onto the same rigged character after verifying matching UV triangle topology. This addresses material loss observed in a real rig/animation roundtrip; it is opt-in at model integration and skips mismatched or ambiguous charts. See the animation guide and CONTRIBUTING.md for the workflow.

With Meshy configured and authorized, the creator and polish Agent are encouraged to generate suitable principal 3D assets and complete necessary texturing, rigging and animation stages. Separate API billing does not require repeated approval within existing authorization. Explicit budgets and local-only preferences still apply. Blender remains useful for precise construction, refinement and integration; Tripo generation is not yet integrated.

OpenFun now searches and imports free reusable assets through bundled `world_search_assets`, `world_asset_info` and `world_download_asset` tools. Poly Haven models/PBR maps/HDRIs and ambientCG materials are available without login or generation credits. Imports retain sources and CC0 license records and are reused offline within the project. Powered by Poly Haven. The creator searches suitable existing assets before generating common items, keeping Meshy/image generation for gaps and bespoke art. See [reusable libraries and subscription candidates](docs/assets.md#reusable-asset-libraries-alpha30). Runtime level generation reuses the prepared asset kit; background asset downloading is not implemented.

The asset tools also support Kenney's public catalog for 2D sprites, tile sets, UI, audio and stylized 3D packs, with CC0 checks and offline reuse. `world_search_design_references` and `world_read_design_reference` add a curated, source-linked reading workflow for mechanics, content, maps and interactive narrative. This is a small reference index, not a general web search or a bundled story engine. New `narrative` and `levels` guides connect research to concrete decisions, persistent consequences and playtests. See [resources and design references](docs/assets.md#2d-3d-and-design-references-alpha31).

Gameplay depth is prioritized over content volume during creation, live content generation and polish. The Agent should establish the game's core appeal, implement a vocabulary of meaningful interactions, and verify how later play develops those decisions. Enemy/weapon/system counts are not targets, and familiar mastery or recovery can be appropriate. Runtime workers use supplied observations and consequences without inventing telemetry or unsupported mechanics; behavior/schema extensions belong to authoring and must be tested. These instructions improve the design workflow but do not certify enjoyment or automatically upgrade previously generated games.

产品质量评测标准、评分依据和重复验证流程见 [评测规范](docs/evaluation.md)。工程测试通过不代表游戏美观或好玩。

### Music and UI artwork

Music is now searchable with `world_search_assets source=opengameart kind=music`, then inspect/download a CC0 track using the existing library tools. The `audio` design guide covers background music, sound effects, mixing, looping and source credits. Incompetech and itch.io are additional browser research sources, not native API integrations.

Image generation defaults to GPT Image 2.5 Sunburst through OpenFun's own pi/Codex login. The image tool also accepts explicit Flare or legacy Image 2 selection, without a silent downgrade. New games must generate and integrate a text-free UI skin (`purpose=ui`); Godot supplies live text, values, layout and input. Existing approved skins are reused for later edits and generated content.

### Nonintrusive automated testing

Automatic game checks use Godot `--headless`, including scheduled inputs and isolated save checks.
Headless diagnostics cannot verify rendered art, animation appearance, audible audio or GPU performance;
those results stay unverified until the appropriate rendered/audio check is performed.
Agents select `mode=windowed` automatically when visual, animation, audio or rendering checks are needed;
no separate user confirmation is required. Windowed diagnostics request no focus, pass through mouse
clicks and release mouse capture. Games should respect `OPENFUN_AUTOMATED_TEST=1` by skipping cursor
capture/warping, focus grabs and fullscreen. These measures reduce disruption but cannot prevent arbitrary
scripts from changing OS input state. Batch short meaningful tests; prefer an isolated rendering display
when available. Normal user-requested `openfun play` remains interactive.
