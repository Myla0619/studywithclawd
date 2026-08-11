// Myla 的一天 — 主屏小组件
//
// 长按主屏 → 加小组件 → Scriptable → 选这个脚本。
// 小号只有圆盘，中号圆盘 + 前几项时长。
// 圆盘的画法跟主脚本共用 MylaDayCore，两边永远一致。

const C = importModule("MylaDayCore")

const data = C.rollover(C.load())
const segs = C.segments(data)
const now = Date.now()

const w = new ListWidget()
w.backgroundColor = new Color("#17171B")
w.setPadding(10, 10, 10, 10)
// 点小组件直接打开主脚本
w.url = "scriptable:///run?scriptName=MylaDay"

const family = config.widgetFamily || "medium"

if (family === "small") {
  w.addImage(C.drawDial(data, segs, 150, { now, ticks: false })).centerAlignedImage()
} else {
  const row = w.addStack()
  row.layoutHorizontally()
  row.centerAlignVertically()

  const left = row.addStack()
  left.addImage(C.drawDial(data, segs, 140, { now, ticks: false }))
  row.addSpacer(12)

  const right = row.addStack()
  right.layoutVertically()
  const t = C.totals(segs, now)
  const top = data.activities
    .filter(a => (t[a.id] || 0) >= 60)
    .sort((x, y) => t[y.id] - t[x.id])
    .slice(0, 4)

  if (!top.length) {
    const e = right.addText("今天还没记录")
    e.font = Font.systemFont(11)
    e.textColor = new Color("#FFFFFF", 0.45)
  }
  for (const a of top) {
    const line = right.addStack()
    line.layoutHorizontally()
    line.centerAlignVertically()
    const dot = line.addText("●")
    dot.font = Font.systemFont(9)
    dot.textColor = new Color(a.hex)
    line.addSpacer(5)
    const name = line.addText(a.name)
    name.font = Font.systemFont(11)
    name.textColor = new Color("#FFFFFF", 0.9)
    line.addSpacer()
    const val = line.addText(C.hhmm(t[a.id]))
    val.font = Font.systemFont(11)
    val.textColor = new Color("#FFFFFF", 0.45)
    right.addSpacer(4)
  }
}

// iOS 自己决定什么时候真的刷新，这只是个期望值
w.refreshAfterDate = new Date(Date.now() + 5 * 60000)

if (config.runsInWidget) Script.setWidget(w)
else await w.presentMedium()
Script.complete()
