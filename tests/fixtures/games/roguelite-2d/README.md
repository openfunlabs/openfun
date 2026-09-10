# Lanternfall：一个可编辑的游戏项目

这是 Openfun 通用 Godot 项目的验收样例。复制到任意世界的 `game/` 后，可以直接
修改 `game.gd`、`content.gd`、场景与美术，改成其他玩法；Openfun Host 不认识这里的
敌人、技能、坐标或战斗规则，只提供带 schema 的内容任务和带版本的存档。

使用 Openfun 创建带 `roguelite2d` 示例的世界，再正常游玩。项目只需要启动参数
`--host=<URL> --token=<TOKEN>`，由 Openfun 启动器自动提供。首次正常游玩需要已配置
的 pi 模型认证；已生成的内容保存在世界中。`--demo` 或 Host 的明确 demo 模式才
会使用固定手工数据。模型和 provider 由世界的 pi 配置决定。

操作：WASD 移动；鼠标瞄准、按住左键攻击；空格向瞄准方向闪避；清敌后按 1/2/3
或点击选择祝福；走进亮起的出口进入下一层；死亡按 R / Enter 重开；生成失败按 R
显式重试。关闭窗口前会尝试保存。游戏每秒自动保存角色、敌人、弹丸、已选技能、
当前关卡和已清关状态。存档冲突会暂停游戏，避免覆盖另一进程的进度。

`content.gd` 包含此游戏自己的生成 schema、提示和空间验证。进入第 N 层会预取
第 N+1 层，清敌后用真实生成的三个候选修改角色属性。请求失败或预算不足会显示
原因，不替换成随机房间。修改 schema 或提示后应同步更改 `game.gd` 中 `_key()`
的版本，避免与已发布的不可变结果混淆。

验收命令（从仓库根目录）：

```sh
node --import tsx tests/e2e/roguelite.mjs
node --import tsx tests/e2e/roguelite.mjs --visual
node --import tsx tests/e2e/roguelite.mjs --demo
```

测试运行真实 Godot、真实 HTTP Host/内容队列和 SQLite；模型被明确注入的测试
fixture 代替，不消耗模型额度。它实际模拟移动、碰撞、弹丸命中、两种敌人伤害、
死亡重开、闪避、技能增益、出口换关；然后关闭并重新启动 Host 和客户端，核对
受伤敌人及玩家状态。`--visual` 还输出房间和技能截图到 `.output/`。真实模型
验收应由正常 Openfun 游玩完成，不能用本测试结果代表模型生成质量。

仓库的 `tests/live/levels.mjs` 是单独的真实模型验收入口，要求显式
`--run-live --world=<新目录> --provider=<provider> --model=<model>`，最多 5 次尝试。
它保留真实任务结果、阶段日志与耗时，并在零预算重启后比较完整战斗状态。
`--replay-existing` 仅用于这个验收世界：会先保存原状态到 .output，再重置游戏
存档并复用全部已发布 AI 内容，新增模型预算固定为零。不要用于普通玩家存档。

当前限制：单人，由项目本地计算战斗；通用存档 API 只提供原子保存和乐观锁，
不提供多人战斗权威。没有音频或外部图片，全部图形由代码绘制。这个样例选择
了少量敌人/技能机制以验证端到端能力；新机制应直接修改项目代码和 schema。
