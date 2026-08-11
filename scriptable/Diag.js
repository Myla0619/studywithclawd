// 分层诊断：圆盘不出来的时候跑这个，看是哪一层断了。
// 四行测试从最简单到最完整，第一个不显示的那行就是问题所在。

const rows = []
function step(label, fn) {
  try {
    const v = fn()
    rows.push({ label, img: v instanceof Image ? v : null,
                note: v instanceof Image ? "有图" : String(v) })
  } catch (e) {
    rows.push({ label, img: null, note: "✗ " + e.message })
  }
}

// ① DrawContext 本身能不能出图
step("① 纯色方块", () => {
  const c = new DrawContext()
  c.size = new Size(120, 120)
  c.setFillColor(new Color("#EA5358"))
  c.fillRect(new Rect(0, 0, 120, 120))
  return c.getImage()
})

// ② 透明底 + 多边形路径（圆环用的就是这套）
step("② 透明底多边形", () => {
  const c = new DrawContext()
  c.size = new Size(120, 120)
  c.opaque = false
  const p = new Path()
  p.addLines([new Point(60, 8), new Point(112, 100), new Point(8, 100)])
  p.closeSubpath()
  c.addPath(p)
  c.setFillColor(new Color("#F4D452"))
  c.fillPath()
  return c.getImage()
})

// ③ 带透明度的颜色
step("③ 半透明填充", () => {
  const c = new DrawContext()
  c.size = new Size(120, 120)
  c.opaque = false
  c.setFillColor(new Color("#FFFFFF", 0.3))
  c.fillEllipse(new Rect(5, 5, 110, 110))
  return c.getImage()
})

// ④ 真正的圆盘
step("④ 真圆盘", () => {
  const C = importModule("MylaDayCore")
  const now = Date.now()
  const t0 = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000)
  const segs = [
    { id: "a", a: "sleep", s: t0, e: t0 + 27000 },
    { id: "b", a: "study", s: t0 + 27000, e: null }
  ]
  return C.drawDial({ activities: C.DEFAULT_ACTIVITIES, days: {} }, segs, 200, { now })
})

const t = new UITable()
t.showSeparators = true
for (const r of rows) {
  const head = new UITableRow()
  head.isHeader = true
  head.addText(`${r.label} — ${r.note}`)
  t.addRow(head)
  if (r.img) {
    const row = new UITableRow()
    row.height = r.img.size.height + 16
    row.addImage(r.img).centerAligned()
    t.addRow(row)
  }
}
const tail = new UITableRow()
tail.addText("哪一行只有标题没有图，问题就在那一层")
t.addRow(tail)
await t.present(true)
