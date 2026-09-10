# 开发 OpenFun

使用 Node.js 22.19+ 与 package.json 固定的 pnpm 版本。单包开发，不使用 Bun，不另行安装全局 pi。

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm format:check
pnpm test:e2e
```

`check` 包含 TypeScript 检查、单元/集成测试与干净构建。普通测试不调用模型；Host 和插件测试需要本机回环端口。`test:e2e` 需要本机 Godot、Blender，覆盖安装入口、pi 插件、玩法、资源和真实渲染。可用 OPENFUN_GODOT、OPENFUN_BLENDER 或 openfun setup 配置工具。用 `pnpm test:e2e -- --cli /path/to/openfun` 验证指定安装入口（直接传 `--cli` 也可）。

真实模型验收与普通测试分开，必须显式选择场景、provider 和 model：

```sh
pnpm test:live creation <provider> <model>
pnpm test:live chunks <provider> <model> <全新世界目录>
pnpm test:live levels --run-live --world=<全新目录> --provider=<provider> --model=<model>
```

这些命令会消耗模型配额，默认 CI 不运行。用户已授权真实生成测试时，应直接运行与质量目标有关的实测，不把避免消耗额度作为跳过验收的理由；沿用已有授权，不重复索要同一许可。仍应保存任务 ID，避免因轮询、超时或重复下载而重复创建任务。

动画质量实测：先用图像参考生成角色，再查询 `world_animation_library` 选择真实的攻击、受击和死亡动作 ID。运行 `pnpm test:live animation <世界目录> <已有模型key> <修订前缀> <攻击ID> <受击ID> <死亡ID>`，完成真实绑定及三段动作，产物和用量回执保存在该世界的 `artifacts/animation/`。随后用 `tools/godot/animation_probe.gd` 检查实际导入骨骼、动作长度和各阶段画面，再进行正常速度的游戏内动作衔接验收。该探针的 JSON 配置为 `{ "clips": [{ "label": "death", "resource": "res://assets/generated/example.glb" }], "output": "/absolute/output" }`，用 Godot `--path <game> --script <探针绝对路径> -- <配置绝对路径>` 启动；需要真实渲染窗口。素材返回成功或静态骨骼检查不能代替画面与游戏测试。

创作、区块与关卡测试承担不同覆盖，不把示例或注入数据描述为模型输出。

## 结构

- src/agent：pi 集成、世界工具与创作指引。
- src/world、src/generation：世界状态与持久内容生成。
- src/godot、src/assets、src/sharing：引擎、资产与分享。
- tests/fixtures/games/：仅供工程回归的游戏 fixture，不打包、不注入创作或产品评测。
- tools/blender：产品调用的 Python 资产工作脚本，不存 Blender 安装。
- tests/unit、integration、e2e、live、fixtures、helpers：按执行需求组织测试。
- scripts/：构建和导出辅助。
- docs/：当前架构、配置、资产、运行协议与世界格式。

构建只编译 src/ 到 dist/，不编译或发布测试。npm files 白名单限制发行内容；协议文档随新游戏复制，其余开发文档只在源码中维护。运行时查找资源应相对于 package root，测试资源相对于测试模块，避免依赖工作目录或本机绝对路径。

测试产物集中在 .output/，普通测试世界使用系统临时目录。引擎推荐放到 ~/.openfun/tools/，作品放在独立工作目录。不要把大型模型、虚拟环境、旧安装包、实验日志或个人会话放入仓库。研究结论更新对应主题文档，不为每次内部测试添加一个版本报告。

更改后运行相关测试、格式检查、构建及必要的真实引擎验证；模型实测单独报告。Git 使用短期分支与独立 worktree，提交和 PR 遵循项目协作授权。不要提交凭据或覆盖玩家作品。

Free asset integration can be checked with `pnpm test:live library .output/library-live`. It searches both official catalogs, imports a textured glTF plus an ambientCG material set, and validates offline reuse without model requests or paid tasks. Inspect the imported resources in Godot before making visual-quality claims.

`pnpm test:live resources .output/resources-live` checks actual Kenney sprite/audio/3D pack import and indexed reference retrieval, without paid/model calls. For engine acceptance, import the resources in Godot, inspect sprite filtering, resolve GLB texture dependencies and decode an audio sample. Asset loading is not gameplay or enjoyment validation.

产品质量评测遵循 [docs/evaluation.md](docs/evaluation.md)，与工程测试分开。新项目为空白 Godot 工程，不使用游戏示例作为创作起点。
