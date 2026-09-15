# OpenFun 世界包 v1

`.openfun` 是 ZIP 发布包。支持可编辑 Godot 项目、设计文档、已完成内容任务和通用游戏存档，同时兼容原有世界快照和 GLB。接收者导入为独立的本地副本。导入只还原文件和数据，不运行游戏、模型或 MCP；首次执行带源码的导入项目需要显式信任。

## 文件结构

```text
my-world.openfun
├── manifest.json
├── snapshot.json
├── runtime.json                 # 有已完成内容或通用存档时包含
├── assets/
│   └── <sha256>.glb              # 原有世界引用的资产
├── game/                        # 可选的 Godot 项目
│   ├── project.godot
│   ├── world.gd
│   ├── world.tscn
│   └── ...
└── design/                      # 可选的公开 Markdown 设计文档
    └── ... .md
```

ZIP 不保存目录条目。`assets/` 中的文件必须由世界规范的 `assets` 映射或实体 `asset` 字段引用；未引用资产不导出。`game/` 则包含项目自身的受支持源码和资源，不依赖原有实体类型来决定内容。

## Manifest 与兼容性

```json
{
  "formatVersion": 1,
  "worldId": "<世界 UUID>",
  "releaseId": "<本次发布 UUID>",
  "runtimeVersion": "0.1",
  "capabilities": [
    "world.snapshot.v1",
    "assets.glb.v2",
    "game.godot.v1",
    "game.state.v1"
  ],
  "license": "UNLICENSED",
  "files": {
    "snapshot.json": { "sha256": "<64 位小写 SHA-256>", "bytes": 1234 },
    "game/project.godot": { "sha256": "<文件摘要>", "bytes": 567 },
    "runtime.json": { "sha256": "<文件摘要>", "bytes": 890 }
  }
}
```

`runtimeVersion` 是 OpenFun 数据协议版本，不是 Godot 编辑器版本。`files` 必须列出 manifest 以外的全部文件，文件长度和 SHA-256 必须匹配；`assets/<hash>.glb` 的名称也必须与内容摘要相同。哈希检测损坏，不提供作者身份签名。

程序源码采用 MIT，世界内容许可独立。当前导出默认 `UNLICENSED`，没有为用户内容自动添加 MIT 授权。

## Snapshot、内容任务与存档

`snapshot.json` 对应原有 `PortableWorld`，包含 `formatVersion`、`worldId`、`releaseId`、`spec`、`specRevision`、`chunks`、`player` 和 `revision`。实体稳定 ID、位置、引用资产和已移除、已开门等状态保留。快照通过数据库事务导出。

`runtime.json` 的版本为 1，包含 `jobs` 与 `states`。只导出 `ready` 内容任务及其原始请求和结果，不复制 pending/running/failed 任务。导入校验请求与结果，并保留 namespace/key 和任务 ID，使相同请求复用已有结果，无需再次调用模型。`states` 保存 namespace、revision、任意受限 JSON state 和更新时间；它们恢复到接收者的本地运行数据库。

世界或项目内容变化时产生相应的发布身份；源码、设计文档或 runtime 数据的变化也会改变 `releaseId`，即使原有世界 revision 未变。导入保留 `worldId` 和 `releaseId`，生成不同的本地 `saveId`，不会改写作者目录或原包。作者操作日志和 pi 会话不随包传播。

游戏自行定义存档形状、内容引用和游戏规则。共享存档不构成多人状态共识，在线多人仍需服务端身份与权威模拟。

## 可执行项目与信任

含游戏项目的包在导入时生成本地 `.openfun/imported-project.json` 标记，作者不能通过包预先授予信任。OpenFun 的游玩、检查及预览入口在首次运行时要求以下任一显式操作：

```sh
openfun play ./imported-world --trust-project
openfun check ./imported-world --trust-project
```

TUI 对应 `/play --trust-project`。接受该本地副本后，后续正常检查与游玩不必重复标志。导入不会执行项目；Godot 游玩和无界面编辑器检查可能执行脚本，因此检查入口也遵循这个要求。显式信任不是代码沙箱，也不替代作者身份验证。普通本地创作项目不经过导入标记流程。

## GLB 与文件校验

`assets/` 接受自包含 GLB 2.0：有效 magic、版本、总长度、对齐 JSON chunk，以及可选的一个 BIN chunk。JSON `asset.version` 为 `2.0`。该资产入口拒绝 URI 引用，包括网络、文件和 data URI；缓冲区和图片应存于 GLB BIN chunk。`game/` 内其他引擎资源按项目资源文件分发，不应把整个可执行项目误认为经过同一 GLB 检查的数据包。

| 限制                           | v1 值   |
| ------------------------------ | ------- |
| ZIP 文件大小                   | 64 MiB  |
| 解压后总量                     | 128 MiB |
| 单文件                         | 32 MiB  |
| Snapshot                       | 16 MiB  |
| Manifest                       | 256 KiB |
| ZIP 文件条目数                 | 4096    |
| 导出的游戏源码与设计资源总量   | 96 MiB  |
| 导出的游戏源码与设计资源文件数 | 4000    |

导入先检查 ZIP 中央目录与本地头，再解压。支持 STORE 和 DEFLATE；不支持 ZIP64、加密、多卷、data descriptor、额外字段、注释或目录条目。解压过程有实际输出上限。

路径仅允许 manifest、snapshot、可选 runtime、受引用的 GLB 和上述项目/设计路径。符号链接、重复路径、绝对路径、隐藏路径、`..`、反斜杠和重叠条目被拒绝。CRC、SHA-256、文件大小、世界结构、能力声明及引用完整性必须通过校验。

目标目录必须不存在。导入在同级临时目录构建完整世界，独占创建目标占位后原子发布；失败清理本次临时目录，不覆盖已有用户目录。导出通过临时文件与原子硬链接发布，不覆盖已有世界包。

## 程序接口

```ts
packWorld(worldDir: string, output: string): Promise<PackageManifest>
importWorld(packageFile: string, targetDir: string): Promise<PackageManifest>
```

两个接口返回 manifest，目标父目录必须存在。通用内容生成和存档协议见 [运行时项目协议](runtime-protocol.md)。
