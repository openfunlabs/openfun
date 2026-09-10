# 内置 pi 与插件

安装 OpenFun 后，无需预先安装全局 pi 或执行 `pi install`。当前需要 Node.js 22.19+。

| 组件                          | 固定版本/来源                            | 使用方式                                                                                |
| ----------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------- |
| pi 对话、登录、模型和开发工具 | `@earendil-works/pi-coding-agent@0.85.1` | `openfun`、`/login`、`/model`                                                           |
| MCP                           | `pi-mcp-adapter@2.32.1`                  | `/mcp`、`/mcp setup`                                                                    |
| Context Mode                  | `context-mode@1.0.169` 的原生 pi 扩展    | `/ctx-stats`、`/ctx-doctor`；Agent 使用 `ctx_execute`、`ctx_index`、`ctx_search` 等工具 |
| 问答                          | 上述 pi 包的官方 questionnaire 扩展      | 必要时由 Agent 调用，可取消                                                             |

| 图像生成 | OpenFun 原生 pi 扩展 | Agent 使用 `world_generate_image`，复用 Codex 登录态 |

默认不加载 Plan。需要先讨论方案时，可以直接在对话中说明；没有强制问卷或规划流程。用户自己配置的第三方 Plan 扩展不会被卸载。

## Context Mode

插件负责本地执行、工具输出过滤、全文索引、检索和会话连续性，减少直接进入模型上下文的大段原始数据。实际节省比例依赖任务与使用方式，没有验证固定的节省百分比。

通过原生 pi 入口加载。插件在第一次 Agent 运行前按需启动自己的本地 MCP 工具服务，结束会话时清理；打开帮助或查询命令不会启动该服务。它无需用户额外配置第二个 MCP 服务，也没有加入 OpenFun 的后台地图/关卡生成进程。

Context Mode 的会话与记忆数据写入 `<OPENFUN_HOME>/cache/context-mode/`。OpenFun 固定传入独立数据目录，不使用 `~/.pi/context-mode/` 或继承本机的 Context Mode 数据目录。这些缓存不随世界分享。

该插件使用 **Elastic-2.0**，不是 MIT；其许可证随依赖保留，OpenFun 的 MIT 许可证不覆盖此依赖。上游对托管/管理服务有独立限制，后续云服务应单独核对。[原始许可证](https://github.com/mksglu/context-mode/blob/main/LICENSE)

安装 OpenFun 时使用 `--ignore-scripts`，避免 Context Mode 的全局安装修复逻辑改写其他客户端的配置。Node 22.22.3 的内置 SQLite/FTS5 已通过测试，不需要运行 better-sqlite3 的本地编译脚本：

```sh
npm install --global --ignore-scripts ./openfun-<版本>.tgz
```

命令 `openfun` 由包管理器直接创建，无需安装脚本或额外别名。源码 pnpm 配置也禁用了上述依赖的安装脚本。其他 Node 构建若缺少 SQLite/FTS5，插件运行可能失败；目前只验证了指定 Node 版本和平台。

## 配置与兼容

所有用户都使用 `<OPENFUN_HOME>/agent/`（默认 `~/.openfun/agent/`）管理 OpenFun 的登录、模型设置和插件。不会读取、复制或迁移 `~/.pi/agent/`，也不接受旧的 `PI_CODING_AGENT_DIR`、`OPENFUN_AGENT_DIR` 配置路径覆盖。创作与后台生成共用 OpenFun 自己的认证。

项目级扩展、skills、设置与系统提示使用当前世界的 `.openfun/`，不加载项目的 `.pi/`。启动内置 pi 时清除继承的 `PI_*` 环境变量；由 OpenFun 自己设置品牌入口和配置路径。内置 pi 提供 `piConfig` 品牌机制，OpenFun 在 `<OPENFUN_HOME>/runtime/` 创建小型清单和指向固定依赖的资源链接，以保持原生主题、登录、对话和插件功能。没有复制或启动全局 pi，也没有修改其安装。MCP 插件在此目录保留一个内置依赖的缓存副本，仅将上游固定的钥匙串服务名改为 OpenFun 独立名称；副本保留许可证，依赖仍来自 OpenFun 安装，源依赖和本机 pi 均不改写。

从早期版本升级后，请在 OpenFun 中使用 `/login` 单独登录，再通过 `/model` 选择模型；本机 pi 的登录不会自动带入。`OPENFUN_HOME` 仍可指定 OpenFun 的完整数据根目录。

`openfun doctor` 显示实际目录和默认插件状态。可在 `<OPENFUN_HOME>/plugins.json`（默认 `~/.openfun/plugins.json`）中关闭某项：

```json
{
  "mcp": true,
  "context": true,
  "questions": true,
  "images": true,
  "assets3d": true
}
```

缺失字段默认 true；修改后重新启动。旧版布尔型 `plan` 字段被忽略，不会让旧设置阻止启动。关闭默认项不卸载用户自己配置的插件。

对 OpenFun 自己的设置和显式 CLI 参数中已配置的 MCP、Context Mode、questionnaire 或 `@juicesharp/rpiv-ask-user-question`，优先复用已有版本，避免重复加载。项目级或自定义替代扩展可通过关闭默认项后加载，用户版本由用户管理。

MCP 适配器不包含各服务的可执行程序和账号；Godot/Blender 仍按需准备。内置图片扩展 world_generate_image 复用 pi 的 Codex 登录和当前模型，详见 [资产制作](assets.md)。其他图片插件可继续加载，但创作优先使用该工具；无需额外安装 pi-openai-toolkit。

## 3D 资产服务登录

`/login` → **Sign in with an API key** 中可选择 Meshy 或 Tripo，也可直接输入 `/login meshy`、`/login tripo`。直接复用 pi 原生登录菜单与 API key 输入界面；密钥写入 `<OPENFUN_HOME>/agent/auth.json`，不进入游戏文件或会话消息。`/logout` 可移除已保存密钥。环境变量 `MESHY_API_KEY`、`TRIPO_API_KEY` 也可使用，已保存密钥优先；退出登录不会清除环境变量。

Meshy 已接入图生 3D。Tripo 当前仅支持密钥保存，生成尚未集成。它们不会出现在聊天模型列表中，也不会替换当前创作模型。保存密钥不等于服务端验证通过，首次 API 调用会报告认证或额度问题。首次使用若尚未配置任何聊天模型，Pi 登录收尾可能额外提示该服务没有默认模型；密钥仍已保存，请另行登录聊天 provider 并用 `/model` 选择创作模型。可用 `"assets3d": false` 关闭这项内置扩展。

## 工具与数据目录

Godot 与 Blender 不随 npm 包分发。安装后运行 `openfun setup`，或设置 `OPENFUN_GODOT`、`OPENFUN_BLENDER`。工具探测顺序为显式参数、环境变量、`<OPENFUN_HOME>/tools.json`、常见应用位置、PATH。该配置应指向安装包以外的稳定位置，例如 `~/.openfun/tools/`；源码目录不存放引擎或生成模型。

无参数 OpenFun 只读取当前工作目录。`/new` 只新建当前项目的对话，`/world` 只显示当前项目信息。创建或打开其他项目时，退出 OpenFun，在终端切换到目标目录后再次运行 `openfun`；空目录会自动初始化世界。世界的 `.openfun/` 保存本地会话、模型偏好及日志，不随分享包分发。`OPENFUN_HOME` 控制全局配置和缓存位置，不改变当前世界目录。

`/play --generation-budget 24` 设置本次 Host 的 AI 请求预算，默认 12，范围 0–100，失败与重试也计数。`--demo` 明确禁用模型并使用项目提供的示例数据。MCP 服务配置与模型登录始终归 pi 管理，世界分享包不包含这些配置或凭据。
