// 白屏定位：四页从最简单到最完整，一页一页看。
// 第一个「白的」那级就是断点，不用猜。
//
// 每页关掉之后会问一句看见没有，最后汇总。全程不碰你的记录。

const C = importModule("MylaDayCore")
const V = importModule("MylaDayHTML")

const results = []

async function step(name, html) {
  const size = Math.round(html.length / 1024)
  const wv = new WebView()
  let err = null
  try {
    await wv.loadHTML(html)
    await wv.present(true)
  } catch (e) { err = e.message }

  const a = new Alert()
  a.title = name
  a.message = err ? "直接报错了：" + err
    : "刚才那一页（" + size + " KB）看见东西了吗？"
  if (err) { a.addAction("知道了"); await a.present(); results.push([name, size, "报错：" + err]); return }
  a.addAction("看见了")
  a.addAction("白的")
  const i = await a.present()
  results.push([name, size, i === 0 ? "✅ 看见了" : "⬜️ 白的"])
}

// ---- ① 纯 HTML，最小
await step("① 一行字", "<h1 style='font-size:40px;padding:40px'>能看见这行字吗</h1>")

// ---- ② 完整 CSS + 静态骨架，不跑 JS
const skeleton = V.HTML.replace(/<script>[\s\S]*<\/script>/, "")
  + "<div style='padding:40px;font-size:20px'>② 骨架 + 样式</div>"
await step("② 样式和骨架", skeleton)

// ---- ③ 完整页面 + 不带图的数据
const data = C.rollover(C.load())
const bare = mkPayload(data, "none")
await step("③ 完整页面（没有 Clawd 图）",
  V.HTML + "<script>window.boot(" + JSON.stringify(bare) + ")</" + "script>")

// ---- ④ 完整页面 + 大图（现在 app 里就是这个）
const full = mkPayload(data, "big")
await step("④ 带 Clawd 大图（现在的 app）",
  V.HTML + "<script>window.boot(" + JSON.stringify(full) + ")</" + "script>")

// ---- ⑤ 同一个页面，但图缩小
const small = mkPayload(data, "small")
await step("⑤ 带 Clawd 小图",
  V.HTML + "<script>window.boot(" + JSON.stringify(small) + ")</" + "script>")

// ---- 汇总
const lines = results.map(r => r[0] + "\n    " + r[1] + " KB — " + r[2])
const a = new Alert()
a.title = "结果"
a.message = lines.join("\n\n")
  + "\n\n———\nClawd 图：大 " + Math.round(JSON.stringify(full.clawd).length / 1024) + " KB"
  + " / 小 " + Math.round(JSON.stringify(small.clawd).length / 1024) + " KB"
  + "（" + Object.keys(full.clawd).length + " 张）"
a.addAction("好")
await a.present()

// ---------------------------------------------------------------- 造 payload

function mkPayload(data, withImages) {   // withImages: "none" | "small" | "big"
  const now = Date.now()
  const d = new Date()
  const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
  const segs = C.segments(data)

  const days = {}
  for (let back = 1; back < 90; back++) {
    const dd = new Date(now - back * 86400000)
    const key = C.dayKey(dd)
    const ss = data.days[key]
    if (!ss || !ss.length) continue
    days[key] = C.totals(ss, C.startOfDay(dd).getTime() + 86400000)
  }

  const clawd = {}
  if (withImages === "big" || withImages === "small") {
    const big = withImages === "big"
    const box = big ? 240 : 200
    const draw = act => {
      const ctx = new DrawContext()
      ctx.size = new Size(box, box)
      ctx.opaque = false
      ctx.respectScreenScale = big      // true 的话真机上是 3 倍尺寸
      C.drawClawd(ctx, box / 2, box * 0.86, box * 0.0155, act)
      return "data:image/png;base64," + Data.fromPNG(ctx.getImage()).toBase64String()
    }
    clawd["_"] = draw(null)
    for (const a of data.activities) clawd[a.id] = draw(a.id)
  } else {
    // 1×1 透明 PNG，占位用
    clawd["_"] = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    for (const a of data.activities) clawd[a.id] = clawd["_"]
  }

  return {
    version: C.VERSION,
    sub: `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`,
    warn: null,
    activities: data.activities.map(a => ({ id: a.id, name: a.name, hex: a.hex })),
    palette: C.DEFAULT_ACTIVITIES.map(a => a.hex),
    clawd,
    segs: segs.map(s => ({ id: s.id, a: s.a, s: s.s, e: s.e })),
    dayStart: Math.floor(C.startOfDay().getTime() / 1000),
    days,
    todos: (data.todos[C.dayKey()] || []).map(x => ({
      id: x.id, text: x.text, done: !!x.done, doneAt: x.doneAt || null
    })),
    carry: 0,
    nudge: data.nudgeMinutes === 0 ? 0 : (data.nudgeMinutes || 90),
    span: data.ui.span || 7,
    chart: data.ui.chart || "bar"
  }
}
