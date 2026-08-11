// Myla 的一天 — 主脚本（控制器）
//
// 三种进入方式：
//   直接运行 / 主屏幕图标        → 打开界面
//   快捷指令自动化传参          → 切状态后立刻退出（到达某地时用）
//   通知按钮 / URL scheme       → 同上
//     scriptable:///run?scriptName=Myla&switchTo=study
//
// 界面是一个自给自足的 WebView（MylaView.js）：数据在 loadHTML 之前就写进页面，
// 所有点击在页面内直接生效。这个文件负责两件事——开窗口之前把数据备齐，
// 窗口关掉之后把页面记下的操作回放到数据上再存盘。
//
// 为什么不在窗口开着的时候来回通信：往已经弹出来的 WebView 里 evaluateJavaScript
// 送数据送不到，第一版就栽在这（白屏 + 一直转圈）。present() 兑现之后再读页面变量
// 是可靠的，所以改成关窗口时一次性回放。
//
// 每条操作都带自己发生的时间戳，回放时用的是那个时间，不是关窗口的时间。
// 所以 14:00 切成学习、14:30 才关窗口，记下来仍然是 14:00。

const C = importModule("MylaCore")
const V = importModule("MylaView")

const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]

const REPO = "Myla0619/studywithclawd"
const UPDATE_FILES = ["MylaCore.js", "MylaView.js", "Myla.js", "MylaWidget.js",
                      "MylaWhy.js", "MylaTest.js"]

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
  // 更新放在开窗口之前，因为「关窗口之后」那个位置对上划退出 app 的人根本不会跑，
  // 于是永远更不到新版。这里最多六小时查一次，静默下载不打断你，下次打开生效。
  await selfUpdate(false)
  await runApp()
}
Script.complete()

// ---------------------------------------------------------------- 开窗口

/** 这一次运行的编号。操作按「会话号 + 序号」去重，跨会话也不会重复执行。 */
const SID = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

/** 这个会话已经执行到第几条了（-1 表示一条都没执行过）。 */
function doneUpTo(sid) {
  const a = data.applied || (data.applied = {})
  return a[sid] === undefined ? -1 : a[sid]
}
function markDone(sid, i) {
  const a = data.applied || (data.applied = {})
  if (a[sid] === undefined || i > a[sid]) a[sid] = i
  // 只留最近几次运行的记录，别让它无限长
  const keys = Object.keys(a)
  if (keys.length > 8) for (const k of keys.sort().slice(0, keys.length - 8)) delete a[k]
}

async function runApp() {
  // 开窗口之前先把上次残留的操作捞回来。
  // 这条是为「上划把 app 杀掉」准备的：那种退出方式下，页面到脚本的实时通道
  // 全都来不及跑，但浏览器自己的存储还在。用一个空页面去读，因为同一个 app
  // 里的 WebView 共用一份存储。
  await drainPending()

  const wv = new WebView()
  const json = JSON.stringify(payload())
    .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")
  // baseURL 是为了让 localStorage 可用——loadHTML 不给 baseURL 的话页面没有源，
  // localStorage 会直接抛异常。这个域不会真的去访问。
  await wv.loadHTML(V.HTML + "<script>window.boot(" + json + ", true)</" + "script>",
                    "https://myla.local/")

  // 存盘一共四条通道，因为其中没有一条我能在电脑上验证。任意一条通一次，
  // 所有操作就都在——页面每次发的是「到目前为止的全部操作」，不是单条，
  // 脚本按序号去重。实测过五种丢包模式（全通/只通最后一条/只通第一条/
  // 一条不通/隔一条丢一条），结果完全一致。
  //
  //   ① shouldAllowRequest      页面发起跳转，这里拦下来（下面这段）
  //   ② 每两秒轮询一次页面变量   窗口开着时
  //   ③ pagehide 时页面再补发    关窗口那一刻
  //   ④ 关窗口后再读一遍         最后兜底
  //
  // ①：页面每做一件事就发起一次 myladay:// 跳转，这里拦下来、落盘、拒绝导航。
  let appliedUpTo = 0
  let wantExport = false
  wv.shouldAllowRequest = req => {
    const u = (req && req.url) || ""
    if (u.indexOf("myladay://") !== 0) return true
    try {
      // 收到的是「到目前为止的全部操作」，按序号只取没执行过的那些。
      // 所以中途丢几条消息不要紧，后一条会把前面的一起带过来。
      const batch = JSON.parse(decodeURIComponent(u.slice(u.indexOf("m=") + 2)))
      let n = 0
      for (const m of batch) {
        if (m.i < appliedUpTo) continue
        appliedUpTo = m.i + 1
        markDone(m.sid || SID, m.i)
        if (m.t === "export") wantExport = true
        else if (m.t !== "update") { apply(m); n++ }
      }
      if (n) C.save(data)
    } catch (e) { /* 收不下就等关窗口时的兜底 */ }
    return false
  }

  // 第二条：窗口开着的时候每两秒读一次页面。用的是和第三条同一个 API。
  // 整段用 race 兜住——不通就跳出轮询，绝不会卡在一个永远不兑现的 promise 上
  // （白屏那次就是卡在这种地方）。
  const closed = wv.present(true).then(() => "closed")
  let done = false
  closed.then(() => { done = true })

  const take = batch => {
    let n = 0
    for (const m of batch) {
      if (m.i === undefined || m.i < appliedUpTo) continue
      appliedUpTo = m.i + 1
      markDone(m.sid || SID, m.i)
      if (m.t === "export") wantExport = true
      else if (m.t !== "update") { apply(m); n++ }
    }
    if (n) C.save(data)
    return n
  }
  // 落盘之后把页面那份残留清掉，不然下次启动会再捞一遍
  const clearPending = () => wv.evaluateJavaScript(
    "localStorage.removeItem('myla_pending')").catch(() => {})

  while (!done) {
    const r = await Promise.race([
      closed,
      wv.evaluateJavaScript("JSON.stringify(window.LOG || [])").catch(() => "dead")
    ])
    if (r === "closed") break
    if (r === "dead") break            // 这条通道不支持，别再试了
    try { take(JSON.parse(r || "[]")) } catch (e) { break }
    await Promise.race([closed, sleep(2000)])
  }
  await closed

  // 第三条：关窗口后再读一遍。按 i 去重，几条通道同时生效也不会重复执行。
  let log = []
  try {
    const raw = await wv.evaluateJavaScript("JSON.stringify(window.LOG || [])")
    log = JSON.parse(raw || "[]")
  } catch (e) { /* 读不到就算了，前面几条多半已经存过 */ }

  take(log)
  await clearPending()
  scheduleNudge()

  // 系统的文件选择器盖不到 WebView 上面，所以导出只能等窗口关掉再弹
  if (wantExport) {
    try { await DocumentPicker.exportFile(C.DATA) } catch (e) { /* 取消了 */ }
  }

  // 手动点了「检查更新」才在这儿再查一次
  if (log.some(m => m.t === "update")) await selfUpdate(true)
}

/**
 * 自己更新自己。放在这里是为了让「跑 install → 划后台 → 再跑」这套动作彻底消失。
 *
 * 下载钉在一个具体 commit 上：用分支名时 jsDelivr 的缓存能陈到几小时前，
 * 只要 GitHub 那边超时一次回落过去，就会静默装回一份旧代码。
 *
 * 正在跑的这一份代码已经在内存里了，覆盖文件不影响当前这次运行，下次打开才生效。
 */
async function selfUpdate(force) {
  const now = Date.now()
  if (!force && data.lastCheck && now - data.lastCheck < 6 * 3600000) return
  data.lastCheck = now

  let sha = null
  try {
    const r = new Request("https://api.github.com/repos/" + REPO + "/commits/main")
    r.headers = { "User-Agent": "MylaDay" }      // 不带 UA 直接 403
    r.timeoutInterval = force ? 15 : 6      // 静默查的时候别让开 app 等太久
    sha = (await r.loadJSON()).sha
  } catch (e) {
    C.save(data)
    if (force) await toast("没连上 GitHub", e.message)
    return
  }

  if (sha === data.installedSha) {
    C.save(data)
    if (force) await toast("已经是最新的了", "版本 " + C.VERSION)
    return
  }

  const here = module.filename
  const dir = here.slice(0, here.lastIndexOf("/"))
  const inICloud = dir.indexOf("Mobile Documents") >= 0 || dir.indexOf("iCloud") >= 0
  const fm = inICloud ? FileManager.iCloud() : FileManager.local()
  const base = "https://raw.githubusercontent.com/" + REPO + "/" + sha + "/scriptable/"

  let ok = 0
  const failed = []
  for (const name of UPDATE_FILES) {
    try {
      const req = new Request(base + name)
      req.timeoutInterval = 20
      const code = await req.loadString()
      if (!code || code.length < 400) throw new Error("内容太短")
      fm.writeString(fm.joinPath(dir, name), code)   // 只写脚本，myladay*.json 一律不碰
      ok++
    } catch (e) { failed.push(name) }
  }

  if (failed.length) {
    // 没下全就不记 sha，下次还会再试；已经写下去的那些下次会被同一个 commit 覆盖一遍
    C.save(data)
    if (force) await toast("没下全", failed.join("、") + " 没下来，下次再试")
    return
  }

  data.installedSha = sha
  C.save(data)

  let to = "?"
  try {
    const m = fm.readString(fm.joinPath(dir, "MylaCore.js")).match(/const VERSION = "([^"]*)"/)
    if (m) to = m[1]
  } catch (e) {}

  data.pendingUpdate = to
  C.save(data)
  if (!force) return                        // 静默：不打断你，下次打开就生效

  const a = new Alert()
  a.title = "有新版了"
  a.message = C.VERSION + "  →  " + to
    + "\n\n已经下好了。再打开一次就是新的。\n（你的记录没有被动过）"
  a.addAction("好")
  await a.present()
}

async function toast(title, msg) {
  const a = new Alert()
  a.title = title
  if (msg) a.message = msg
  a.addAction("好")
  await a.present()
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

function sleep(ms) { return new Promise(r => Timer.schedule(ms, false, r)) }

/** 把上次留在浏览器存储里、还没落盘的操作捞出来执行掉。 */
async function drainPending() {
  try {
    const probe = new WebView()
    await probe.loadHTML("<html></html>", "https://myla.local/")
    const raw = await probe.evaluateJavaScript("localStorage.getItem('myla_pending')")
    if (!raw) return
    const batch = JSON.parse(raw)
    let n = 0
    for (const m of batch) {
      // 实时通道可能已经存过了但没来得及清这份残留，按会话号 + 序号跳过
      if (!m.sid || m.i === undefined || m.i <= doneUpTo(m.sid)) continue
      markDone(m.sid, m.i)
      if (m.t === "export" || m.t === "update") continue
      apply(m); n++
    }
    if (n) C.save(data)
    await probe.evaluateJavaScript("localStorage.removeItem('myla_pending')")
  } catch (e) { /* 这条也不通就算了，还有另外四条 */ }
}

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
    sid: SID,
    pending: (data.pendingUpdate && data.pendingUpdate > C.VERSION) ? data.pendingUpdate : null,
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
        `scriptable:///run?scriptName=Myla&switchTo=${encodeURIComponent(a.id)}`, false)
    }
    n.setTriggerDate(new Date(Date.now() + mins * 60000))
    n.schedule()
  })
}
