# study with clawd

一只住在 macOS 桌面上的像素 Clawd，陪你把今天要做的事做完。

两个独立的小程序，共用同一只 Clawd：

- **clawd** — 学习陪伴面板：今日清单、每项任务的专注计时、每天一份汇总
- **claude-pet** — Claude Code 的进度挂件：Claude 在干活时冒出来报告进度，闲着自动消失

原生 Swift + AppKit，单文件，无第三方依赖。只需要 Xcode Command Line Tools。

![学习面板的六个状态](docs/panel.png)

## 它做什么

**今日清单**：底部输入框回车加一条，点方框打勾。**做完的不会消失**，只是沉到列表最下面——它仍然算数，只是不再跟没做的抢注意力。跨天时未完成的自动带到第二天。

**专注计时**：点任务右边 ▶ 选时长（15/25/45/60，或直接输入分钟数）。计时期间「休息」按钮是锁着的。时间到了会响一声，然后给你两个选择：休息一下，或者再来一段。

**每天一份汇总**：`clawd.sh summary` 输出一份 Markdown，每天一节，记录专注时长、完成情况和最长的一段。从日志文件实时生成，不会跟数据对不上。

## 几条刻意的设计

做之前查了面向 ADHD 的产品设计资料，有几条直接改变了实现：

**默认完全静止。** 循环动画是这类指南里第一个要砍的东西——余光里不停动的东西会持续抢注意力。所以 Clawd 平时一动不动，只有状态切换和结束时的一次短庆祝会动。想要动画版（伸懒腰、喝咖啡、打盹惊醒等 8 种随机小动作）可以手动开：

```bash
clawd.sh motion on
```

![监督时的随机小动作](docs/beats.png)

**结束一段 ≠ 任务做完。** 面板上写的是「这一段结束了」，不是「完成」。任务算不算做完只能你自己去列表里勾——计时器无权替你下这个结论。

**不自动开始任何事。** 重启后没走完的计时段会停在「要接着来吗？」等你点，不会自己接着跑。

**只累加，不倒扣。** 底部统计是「完成 N · 专注 M 分钟 · 最长 X 分钟」。提前停下的那段专注时间照样计入——坐了 18 分钟就是坐了 18 分钟，不因为没走满就归零。中断次数记在数据文件里但界面上不显示：一个不断增长的失败计数是研究里点名会让人干脆弃用整个 app 的模式。

**陪着，但不盯着。** 文案从「盯着你呢」改成了「陪你一起」。Body doubling（有人陪着做事）本身是有依据的方法，但"陪"不需要"监视"。

参考：
[Neurodivergent UX Design](https://www.accessibilitychecker.org/blog/neurodivergent-ux-design/) ·
[Designing for ADHD in UX](https://uxpa.org/designing-for-adhd-in-ux/) ·
[ADHD Productivity Without Shame or Streaks](https://xenith.life/articles/adhd-productivity-systems) ·
[Body Doubling Apps](https://www.shimmer.care/blog/best-body-doubling-apps)

## 安装

```bash
git clone https://github.com/Myla0619/studywithclawd.git
cd studywithclawd
./build.sh install
~/.claude/clawd/clawd.sh start
```

`build.sh install` 会把源码、脚本和编译好的二进制放进 `~/.claude/{clawd,pet,shared}`。数据也存在那里，不会进仓库。

想开机自启，把 `clawd/com.clawd.study.plist` 里的 `__HOME__` 换成你的家目录，然后：

```bash
cp clawd/com.clawd.study.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.clawd.study.plist
```

## 用法

```
clawd.sh start | stop | restart | toggle
clawd.sh motion [on|off]     动画开关（同时管两只）
clawd.sh find                面板找不到时把它叫回来（展开 + 回默认位置 + 置顶）
clawd.sh summary             打印每日汇总
clawd.sh today               今天的原始 JSON
clawd.sh build               改完源码重新编译
```

面板本身：拖标题栏移动，点右上角 `—` 收起成贴纸大小，**双击贴纸**展开（单击是拖动，所以挪位置不会误触）。

收起后的贴纸只有 112×76 且没有卡片底，桌面一乱很容易找不到——这时候 `clawd.sh find` 会把它展开、放回左上角并置顶。

## claude-pet（可选）

给 [Claude Code](https://claude.com/claude-code) 用的进度挂件。Claude 开始干活时它出现在角落，底下一行字说明正在做什么（`改 keys.py`、`跑 pytest 3/7`），干完变成本轮总结（`58 步 · 5:02`），然后自己消失。

![干活挂件](docs/pet.png)

装法是在 `~/.claude/settings.json` 里挂 6 个 hook：

```json
{
  "hooks": {
    "SessionStart":     [{ "hooks": [{ "type": "command", "command": "~/.claude/pet/pet.sh hook idle",    "async": true }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "~/.claude/pet/pet.sh hook working", "async": true }] }],
    "PreToolUse":       [{ "hooks": [{ "type": "command", "command": "~/.claude/pet/pet.sh hook act",     "async": true }] }],
    "PostToolUse":      [{ "matcher": "TodoWrite",
                           "hooks": [{ "type": "command", "command": "~/.claude/pet/pet.sh hook todo",    "async": true }] }],
    "Notification":     [{ "hooks": [{ "type": "command", "command": "~/.claude/pet/pet.sh hook waiting", "async": true }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "~/.claude/pet/pet.sh hook done",    "async": true }] }]
  }
}
```

一台机器上开多个 Claude Code 会话时，状态按 `session_id` 分开存在 `pet/s/<id>/`，挂件会挑「最忙」的那个跟：正在干活 > 等你确认 > 刚干完 > 待命，同级比新鲜度。

## 一些实现细节

**像素不糊**：所有位移都按整格走，精灵坐标对齐到格子，不做小数缩放。高矮胖瘦是三套独立精灵而不是拉伸。

**不占资源**：两个都跑 10fps（像素动画整格跳，30fps 和 10fps 画出来一样）。挂件隐身时不跑动画，轮询也降频。闲置时两个加起来约占单核 1.5%。

**离屏预览**：改完外观不用反复重启看效果。

```bash
clawd/clawd --sheet out.png     # 所有面板状态渲染成一张图
clawd/clawd --beats out.png     # 所有随机小动作
clawd/clawd --trace 600         # 纯内存模拟 10 分钟，打印触发了哪些动作
pet/claude-pet --sheet out.png  # 挂件的所有状态
```

**点击穿透**：挂件只在鼠标真正压在 Clawd 身上时才拦截点击，其余时候整个窗口穿透，不挡你点桌面上的东西。靠轮询光标坐标实现，不需要辅助功能权限。

## 数据

都在 `~/.claude/` 下，纯文本，随时可以自己看或改：

```
clawd/days/<yyyy-MM-dd>.json   每天的清单和统计
clawd/summary.md               自动生成的汇总
clawd/session.json             进行中的计时段（重启不丢）
pet/s/<session_id>/            各 Claude 会话的状态
```

## 许可

MIT
