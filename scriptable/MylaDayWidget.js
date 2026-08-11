// Myla 的一天 — 主屏小组件
//
// 长按主屏 → 加小组件 → Scriptable → 选这个脚本。
//   小号  只有圆盘
//   中号  圆盘 + 今天前几项时长
//   大号  左边圆盘和时长，右边倒数日
//
// 圆盘和倒数日面板的画法都在 MylaDayCore，app 和小组件永远一致。
// 右侧那块是画成一张图再放进来的，不是用堆栈拼的——画成图才能在电脑上渲染出来核对。

const C = importModule("MylaDayCore")

const data = C.rollover(C.load())
const segs = C.segments(data)
const now = Date.now()
const t = C.totals(segs, now)

const w = new ListWidget()
w.backgroundColor = new Color("#1B1720")
w.setPadding(12, 12, 12, 12)
// 点小组件直接打开主脚本
w.url = "scriptable:///run?scriptName=MylaDay"

const family = config.widgetFamily || "medium"

function topActivities(n) {
  return data.activities
    .filter(a => (t[a.id] || 0) >= 60)
    .sort((x, y) => t[y.id] - t[x.id])
    .slice(0, n)
}

function addTotals(into, list, size) {
  if (!list.length) {
    const e = into.addText("今天还没记录")
    e.font = Font.systemFont(size)
    e.textColor = new Color("#F6F1EC", 0.4)
    return
  }
  for (const a of list) {
    const line = into.addStack()
    line.layoutHorizontally()
    line.centerAlignContent()
    const dot = line.addText("●")
    dot.font = Font.systemFont(size - 2)
    dot.textColor = new Color(a.hex)
    line.addSpacer(5)
    const name = line.addText(a.name)
    name.font = Font.systemFont(size)
    name.textColor = new Color("#F6F1EC", 0.9)
    line.addSpacer()
    const val = line.addText(C.hhmm(t[a.id]))
    val.font = Font.systemFont(size)
    val.textColor = new Color("#F6F1EC", 0.45)
    into.addSpacer(4)
  }
}

if (family === "small") {
  w.setPadding(10, 10, 10, 10)
  w.addImage(C.drawDial(data, segs, 150, { now, ticks: false })).centerAlignImage()

} else if (family === "large") {
  const row = w.addStack()
  row.layoutHorizontally()
  row.topAlignContent()

  const left = row.addStack()
  left.layoutVertically()
  left.size = new Size(140, 0)
  left.addImage(C.drawDial(data, segs, 140, { now, ticks: false }))
  left.addSpacer(12)
  addTotals(left, topActivities(5), 11)

  row.addSpacer(14)

  const right = row.addStack()
  right.layoutVertically()
  const head = right.addText("倒数日")
  head.font = Font.semiboldSystemFont(11)
  head.textColor = new Color("#F6F1EC", 0.4)
  right.addSpacer(8)
  right.addImage(C.drawCountdowns(data, 158, 300, { now, max: 5 }))

} else {
  const row = w.addStack()
  row.layoutHorizontally()
  row.centerAlignContent()

  const left = row.addStack()
  left.addImage(C.drawDial(data, segs, 132, { now, ticks: false }))
  row.addSpacer(12)

  const right = row.addStack()
  right.layoutVertically()
  // 有记着的日子就让最近那个占中号小组件的右边，没有就还是显示时长
  const next = C.sortedCountdowns(data, now).filter(x => x.days >= 0)[0]
  if (next) {
    right.addImage(C.drawCountdowns(data, 150, 106, { now, max: 2 }))
    right.addSpacer(6)
    addTotals(right, topActivities(2), 10)
  } else {
    addTotals(right, topActivities(4), 11)
  }
}

// iOS 自己决定什么时候真的刷新，这只是个期望值
w.refreshAfterDate = new Date(Date.now() + 5 * 60000)

if (config.runsInWidget) Script.setWidget(w)
else if (family === "large") await w.presentLarge()
else if (family === "small") await w.presentSmall()
else await w.presentMedium()
Script.complete()
