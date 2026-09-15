# OpenFun

[English](README.md) | **简体中文**

**OpenFun 是一个开源 AI 游戏创作与运行框架，用于生成初始世界（epoch0），并在游玩过程中持续扩展游戏内容与资产。**

描述你想制作的游戏，塑造初始世界和规则，让后续游玩逐步发展出新的地点、角色、道具、剧情，乃至游戏机制。OpenFun 面向从未使用过游戏引擎的普通用户，也向有经验的开发者开放生成的 Godot 项目。

当前仓库是用于验证可行性的早期原型。第一个产品里程碑聚焦 **2D 游戏**，之后沿着 [Roadmap](https://github.com/openfunlabs/openfun/blob/main/docs/roadmap.md) 逐步支持基础 3D、更丰富的开放世界和更多游戏类型。

## 工作方式

- **创作 epoch0。** 创作者定义初始内容、资产和规则。它可以是一个规模可观、拥有自身系统和成长路线的世界。
- **游玩中持续创作。** OpenFun 根据玩家行为和世界状态生成后续内容与资产。生成以离散更新推进，游戏在更新之间持续运行。
- **使用 Godot 运行。** Godot 负责输入、游戏逻辑、物理和渲染，OpenFun 围绕它管理创作、生成与持久化。

目标是让创作阶段和游玩阶段具备相同的创作能力。简洁的 [架构设计](https://github.com/openfunlabs/openfun/blob/main/docs/architecture.md) 说明了这一方向，也解释了为什么选择 Godot。

## 当前能力

CLI 内置 pi，提供对话、模型选择和创作能力。Agent 编辑真实的 Godot 项目；`/play` 启动 Godot 和本地 Host，由 Host 调度内容请求、控制请求预算，并保存生成结果和玩家进度。

| 原型已经具备                             | 后续目标                                      |
| ---------------------------------------- | --------------------------------------------- |
| Godot 游戏创作，包括实验性 3D 工具       | 稳定可靠的 2D 创作与持续生成体验              |
| 基于已有脚本和资产的结构化运行时内容生成 | 在游玩中生成并启用新资产、新机制              |
| 本地项目、持久化、世界包导入导出         | 区分 epoch0 发布版本与持续演化的世界存档      |
| 通过 pi 选择文本模型                     | 独立配置媒体模型 provider，以及本地多模态推理 |

当前生图使用特定的 pi/Codex 集成。设计上按能力配置 provider，不将任何特定文本或图像模型绑定到 OpenFun 的产品定义。现有限制见 [配置](https://github.com/openfunlabs/openfun/blob/main/docs/configuration.md) 和 [资产](https://github.com/openfunlabs/openfun/blob/main/docs/assets.md) 文档。

## 开始使用

需要 **Node.js 22.19+**、**pnpm** 和 **Godot 4**。现有 3D 工作流可选用 Blender。引擎和大体积模型需要单独安装，无需全局安装 pi。

从本仓库构建并安装：

```sh
git clone https://github.com/openfunlabs/openfun.git
cd openfun
pnpm install --frozen-lockfile
pnpm build
pnpm pack --pack-destination .output
npm install --global --ignore-scripts ./.output/openfun-<version>.tgz
openfun setup
mkdir my-world
cd my-world
openfun
```

将 `<version>` 替换为 `package.json` 中的版本。全局安装时跳过依赖脚本，避免 Context Mode 修改其他客户端的配置。

用 `/model` 选择模型，必要时使用 `/login` 登录。OpenFun 使用独立的 `~/.openfun/agent/` 配置。先描述游戏，让 Agent 完成创作，再使用 `/play`：新项目从空白 Godot 场景开始。

| 命令                           | 用途                       |
| ------------------------------ | -------------------------- |
| `/play`                        | 启动当前游戏及本地 Host    |
| `/play --generation-budget 24` | 设置本次游玩的生成请求预算 |
| `/stop`                        | 停止游戏与 Host            |
| `/world`                       | 查看当前项目信息           |
| `/new`                         | 在同一世界中开始新对话     |

OpenFun 打开当前目录。切换游戏时，退出程序、切换目录，再运行 `openfun`。检查、预览、打包和可选的持续打磨功能见 [CLI 工作流](https://github.com/openfunlabs/openfun/blob/main/docs/implementation.md#cli-workflows)。

## 文档

- [架构设计](https://github.com/openfunlabs/openfun/blob/main/docs/architecture.md) · [Roadmap](https://github.com/openfunlabs/openfun/blob/main/docs/roadmap.md)
- [当前实现](https://github.com/openfunlabs/openfun/blob/main/docs/implementation.md) · [配置](https://github.com/openfunlabs/openfun/blob/main/docs/configuration.md) · [资产](https://github.com/openfunlabs/openfun/blob/main/docs/assets.md)
- [运行时协议](https://github.com/openfunlabs/openfun/blob/main/docs/runtime-protocol.md) · [世界格式](https://github.com/openfunlabs/openfun/blob/main/docs/world-format.md)
- [贡献与测试](https://github.com/openfunlabs/openfun/blob/main/CONTRIBUTING.md) · [游戏质量评测](https://github.com/openfunlabs/openfun/blob/main/docs/evaluation.md)

## 许可证

OpenFun 使用 [MIT 许可证](https://github.com/openfunlabs/openfun/blob/main/LICENSE)。依赖和外部工具保留各自许可证，详见 [第三方声明](https://github.com/openfunlabs/openfun/blob/main/THIRD_PARTY_NOTICES.md)。
