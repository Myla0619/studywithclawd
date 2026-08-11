// Myla 的一天 — 主脚本（控制器）
//
// 三种进入方式：
//   直接运行 / 主屏幕图标        → 打开界面
//   快捷指令自动化传参          → 切状态后立刻退出（到达某地时用）
//   通知按钮 / URL scheme       → 同上
//     scriptable:///run?scriptName=MylaDay&switchTo=study
//
// 界面是一个自给自足的 WebView（MylaDayHTML.js）：数据在 loadHTML 之前就写进页面，
// 所有点击在页面内直接生效。这个文件负责两件事——开窗口之前把数据备齐，
// 窗口关掉之后把页面记下的操作回放到数据上再存盘。
//
// 为什么不在窗口开着的时候来回通信：往已经弹出来的 WebView 里 evaluateJavaScript
// 送数据送不到，第一版就栽在这（白屏 + 一直转圈）。present() 兑现之后再读页面变量
// 是可靠的，所以改成关窗口时一次性回放。
//
// 每条操作都带自己发生的时间戳，回放时用的是那个时间，不是关窗口的时间。
// 所以 14:00 切成学习、14:30 才关窗口，记下来仍然是 14:00。

const C = importModule("MylaDayCore")
const V = importModule("MylaDayHTML")

const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]

// ---------------------------------------------------------------- 入口

let data = C.rollover(C.load())

const fromShortcut = (args.shortcutParameter || "").toString().trim()
const fromURL = (args.queryParameters && args.queryParameters.switchTo) || ""
const incoming = fromURL || fromShortcut

if (incoming) {
  const hit = data.activities.find(a => a.id === incoming || a.name === incoming)
  let r = { ok: false, why: `没有叫「${incoming}」的状态` }
  if (hit) {
    // 通知按钮是你自己按的，算手动；快捷指令自动化才走保护
    if (fromURL) { data = C.switchTo(data, hit.id, Date.now(), "me"); r = { ok: true } }
    else r = C.autoSwitch(data, hit.id)
    data.lastAuto = {
      name: hit.name, ok: r.ok, why: r.why || "",
      from: fromURL ? "通知按钮" : "自动化", at: Date.now()
    }
    C.save(data)
    if (r.ok) scheduleNudge()
  }
  if (!config.runsInApp) Script.complete()
  else {
    const a = new Alert()
    a.title = r.ok ? `切成「${hit.name}」了` : "没有切"
    if (!r.ok) a.message = r.why
    a.addAction("好")
    await a.present()
  }
} else {
  await runApp()
}
Script.complete()

// ---------------------------------------------------------------- 开窗口

async function runApp() {
  const wv = new WebView()
  const json = JSON.stringify(payload())
    .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")
  await wv.loadHTML(V.HTML + "<script>window.boot(" + json + ")</" + "script>")

  // 主存盘通道：页面每做一件事就发起一次 myladay:// 跳转，这里拦下来、落盘、拒绝导航。
  // WebView 弹出来之后这是唯一能实时收到东西的地方。
  let appliedUpTo = 0
  let wantExport = false
  wv.shouldAllowRequest = req => {
    const u = (req && req.url) || ""
    if (u.indexOf("myladay://") !== 0) return true
    try {
      const m = JSON.parse(decodeURIComponent(u.slice(u.indexOf("m=") + 2)))
      if (m.i >= appliedUpTo) {
        appliedUpTo = m.i + 1
        if (m.t === "export") wantExport = true
        else { apply(m); C.save(data) }
      }
    } catch (e) { /* 收不下就等关窗口时的兜底 */ }
    return false
  }

  await wv.present(true)

  // 兜底：万一上面那条通道不工作，关窗口后再读一遍页面记的操作。
  // 按 i 去重，所以两条路同时生效也不会重复执行。
  let log = []
  try {
    const raw = await wv.evaluateJavaScript("JSON.stringify(window.LOG || [])")
    log = JSON.parse(raw || "[]")
  } catch (e) { /* 读不到就算了，主通道多半已经存过 */ }

  let late = 0
  for (const m of log) {
    if (m.i !== undefined && m.i < appliedUpTo) continue
    if (m.t === "export") { wantExport = true; continue }
    apply(m); late++
  }
  if (late) C.save(data)
  scheduleNudge()

  // 系统的文件选择器盖不到 WebView 上面，所以导出只能等窗口关掉再弹
  if (wantExport) {
    try { await DocumentPicker.exportFile(C.DATA) } catch (e) { /* 取消了 */ }
  }
}

// ---------------------------------------------------------------- 回放

function apply(m) {
  const key = C.dayKey(new Date(m.at))
  const todos = data.todos[key] || (data.todos[key] = [])

  switch (m.t) {
    case "switch":
      // 用操作当时的时间，不是现在
      data = C.switchTo(data, m.v, m.at, "me")
      break

    case "todo.add":
      todos.push({ id: m.v2, text: m.v, done: false })
      break
    case "todo.toggle": {
      const it = todos.find(x => x.id === m.v)
      if (it) { it.done = !it.done; it.doneAt = it.done ? m.at : null }
      break
    }
    case "todo.save": {
      const it = todos.find(x => x.id === m.v2)
      if (it) it.text = m.v
      break
    }
    case "todo.del":
      data.todos[key] = todos.filter(x => x.id !== m.v)
      break
    case "todo.carry": {
      const yk = C.dayKey(new Date(m.at - 86400000))
      for (const x of (data.todos[yk] || []).filter(y => !y.done)) {
        todos.push({ id: uid(), text: x.text, done: false })
      }
      break
    }

    case "span": data.ui.span = m.v; break
    case "chart": data.ui.chart = m.v; break

    case "split": {
      // m.v 是那一段的起点秒数（id 在页面里可能是页面自己编的，对不上）
      const dk = C.dayKey(new Date(m.v * 1000))
      const seg = (data.days[dk] || []).find(s => s.s === m.v)
      if (seg) data = C.splitSegment(data, dk, seg.id, m.v2.when * 1000, m.v2.later)
      break
    }

    case "act.add":
      data.activities.push({ id: m.v2, name: m.v,
        hex: C.DEFAULT_ACTIVITIES[data.activities.length % C.DEFAULT_ACTIVITIES.length].hex })
      break
    case "act.rename": {
      const a = data.activities.find(x => x.id === m.v2)
      if (a) a.name = m.v
      break
    }
    case "act.del":
      // 只从「能选的状态」里拿掉，已经记下的时段不动——删个标签不该抹掉历史
      data.activities = data.activities.filter(x => x.id !== m.v)
      break

    case "nudge": data.nudgeMinutes = m.v; break
    case "autoGrace": data.autoGrace = m.v; break

    case "seg.retag": {
      // m.v 是那一段的起点秒数（页面里新开的段 id 是页面自己编的，对不上）
      const dk = C.dayKey(new Date(m.v * 1000))
      const seg = (data.days[dk] || []).find(s => s.s === m.v)
      if (seg) { seg.a = m.v2; seg.by = "me" }
      break
    }

    case "cd.add":
      // 颜色用页面挑好的那个，别在这儿再算一遍——算法一旦分叉两边就对不上
      data.countdowns.push({ id: m.v2, name: m.v.name, date: m.v.date, yearly: !!m.v.yearly,
        hex: m.v.hex || C.CD_PALETTE[data.countdowns.length % C.CD_PALETTE.length] })
      break
    case "cd.save": {
      const cd = data.countdowns.find(x => x.id === m.v2)
      if (cd) { cd.name = m.v.name; cd.date = m.v.date; cd.yearly = !!m.v.yearly }
      break
    }
    case "cd.del":
      data.countdowns = data.countdowns.filter(x => x.id !== m.v)
      break
  }
}

function uid() { return Math.random().toString(36).slice(2, 10) }

// ---------------------------------------------------------------- 数据

function png(img) { return "data:image/png;base64," + Data.fromPNG(img).toBase64String() }

/** Clawd 按状态各画一张，页面按当前状态换图。脚本这边画，绘制代码还是只有一份。 */
function clawdSet() {
  const out = {}
  // 不开 respectScreenScale：开了真机上是 3 倍尺寸，11 张塞进同一个 HTML 字符串
  // 能到几百 KB，loadHTML 直接不出东西。200px 显示在 108pt 的位置上够清楚了。
  const box = 200
  const draw = act => {
    const ctx = new DrawContext()
    ctx.size = new Size(box, box)
    ctx.opaque = false
    ctx.respectScreenScale = false
    C.drawClawd(ctx, box / 2, box * 0.86, box * 0.0155, act)
    return png(ctx.getImage())
  }
  out["_"] = draw(null)
  for (const a of data.activities) out[a.id] = draw(a.id)
  return out
}

function payload() {
  const now = Date.now()
  const d = new Date()
  const segs = C.segments(data)

  // 近 90 天的每日合计。今天不放进去，页面从 segs 现算，这样切状态能立刻反映。
  const days = {}
  for (let back = 1; back < 90; back++) {
    const dd = new Date(now - back * 86400000)
    const key = C.dayKey(dd)
    const ss = data.days[key]
    if (!ss || !ss.length) continue
    days[key] = C.totals(ss, C.startOfDay(dd).getTime() + 86400000)
  }

  return {
    version: C.VERSION,
    sub: `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`,
    warn: data.loadFailed
      ? { text: "数据文件读不出来，已从零开始。坏掉的那份留在 myladay.corrupt-*.json", hex: "#F2363C" }
      : data.recoveredFromBackup
        ? { text: "主文件损坏，已用备份恢复，可能少了最后一次改动", hex: "#F99243" }
        : null,
    activities: data.activities.map(a => ({ id: a.id, name: a.name, hex: a.hex })),
    palette: C.DEFAULT_ACTIVITIES.map(a => a.hex),
    cdPalette: C.CD_PALETTE,
    countdowns: (data.countdowns || []).map(c => ({
      id: c.id, name: c.name, date: c.date, yearly: !!c.yearly, hex: c.hex
    })),
    clawd: clawdSet(),
    segs: segs.map(s => ({ id: s.id, a: s.a, s: s.s, e: s.e, by: s.by || "me" })),
    dayStart: Math.floor(C.startOfDay().getTime() / 1000),
    days,
    todos: (data.todos[C.dayKey()] || []).map(x => ({
      id: x.id, text: x.text, done: !!x.done, doneAt: x.doneAt || null
    })),
    carry: (data.todos[C.dayKey(new Date(now - 86400000))] || []).filter(x => !x.done).length,
    nudge: data.nudgeMinutes === 0 ? 0 : (data.nudgeMinutes || 90),
    autoGrace: data.autoGrace === undefined ? 30 : data.autoGrace,
    lastAuto: (data.lastAuto && Date.now() - data.lastAuto.at < 6 * 3600000) ? data.lastAuto : null,
    span: data.ui.span || 7,
    chart: data.ui.chart || "bar"
  }
}

// ---------------------------------------------------------------- 提醒

function scheduleNudge() {
  Notification.allPending().then(list => {
    for (const n of list) if (n.identifier.startsWith("myladay")) n.remove()
    const mins = data.nudgeMinutes === 0 ? 0 : (data.nudgeMinutes || 90)
    if (!mins) return
    const segs = C.segments(data)
    const open = C.openSegment(segs)
    if (!open) return
    const cur = C.activityOf(data, open.a)

    const n = new Notification()
    n.identifier = "myladay-checkin"
    n.title = `还在${cur.name}吗？`
    n.body = `已经 ${C.hhmm(C.duration(open))}。点一下确认或者改掉，圆盘就不会记错。`
    n.sound = "default"
    // 通知上最多给两个一键改的按钮：今天用得最多的另外两个状态
    const t = C.totals(segs)
    const others = data.activities
      .filter(a => a.id !== cur.id)
      .sort((x, y) => (t[y.id] || 0) - (t[x.id] || 0))
      .slice(0, 2)
    for (const a of others) {
      n.addAction(`改成${a.name}`,
        `scriptable:///run?scriptName=MylaDay&switchTo=${encodeURIComponent(a.id)}`, false)
    }
    n.setTriggerDate(new Date(Date.now() + mins * 60000))
    n.schedule()
  })
}
