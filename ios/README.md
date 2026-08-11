# ClawdDay（iOS）

一天 24 小时的圆盘，加一个可以常驻主屏的小组件。

**模型是「永远有一个状态在跑」**：你切到「学习」，上一段就在那一刻结束、新的一段开始。没有"开始/结束"两次操作，也不会留下空档——一天的 24 小时始终被填满。跨零点的段（比如睡觉）会自动在午夜切开，两天各算各的。

```
Shared/Model.swift       状态、时间段、当天日志、读写
Shared/Dial.swift        24 小时圆盘（app 和小组件共用同一份绘制代码）
Shared/ClawdPixel.swift  像素 Clawd，跟 macOS 那两只同一个 28 格网格
ClawdDay/                主 app
ClawdDayWidget/          主屏小组件（小号=纯圆盘，中号=圆盘+图例）
project.yml              XcodeGen 工程描述
```

## 怎么跑起来

这台机器上**没有 Xcode**，所以下面这些我一步都没跑过——代码是写好的，但没编译过。

```bash
brew install xcodegen
cd ios && xcodegen          # 生成 ClawdDay.xcodeproj
open ClawdDay.xcodeproj
```

然后在 Xcode 里选 Signing & Capabilities，把 Team 设成你的 Apple ID，接上手机直接跑。

不想用 XcodeGen 也行：Xcode 新建一个 iOS App 工程，再 File → New → Target → Widget Extension，然后把上面这些 `.swift` 文件拖进去（`Shared/` 里的三个要同时勾选两个 target）。

## 两个要注意的坑

**小组件要读到 app 的数据，需要 App Groups。** 代码里用的是 `group.com.myla.clawdday`，要在两个 target 的 Signing & Capabilities 里都加上 App Groups 并填这个名字。据我所知**免费的 Apple ID 开不了 App Groups**（这条你实际操作时会知道）——开不了也不会崩：`Store` 会自动退回 app 自己的存储，主 app 完全正常，只是小组件读不到数据、显示空圆盘。

**免费账号签的 app 7 天过期**，到期要重新用 Xcode 装一次。付费开发者账号（一年 99 美元）没有这个限制，也能开 App Groups。

## 设计上的几个选择

**圆盘**：零点在正上方，顺时针一圈是一天。已经过去的时间按状态上色，没到的部分是暗色轨道，还有一条细线标"现在"。中间是 Clawd，底下写当前状态和已经持续多久。

**默认 10 个状态**：睡觉、上课、学习、科研、吃饭、通勤、运动、休息、刷手机、其他。右上角的滑杆图标可以改名、删除、排序、加新的。

**只记录不评判**：跟 macOS 那套一样，这里没有"目标达成率"、没有连续打卡天数、也不会因为某项时间长就标红。圆盘只是把一天摊开给你看。

**小组件刷新**：每 5 分钟一个时间点，另外每次你在 app 里切状态都会主动通知它刷新。iOS 对小组件刷新有配额，所以圆盘上"现在"那条线可能会滞后几分钟，这是系统限制不是 bug。
