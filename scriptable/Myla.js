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
const WEEK_S = ["日", "一", "二", "三", "四", "五", "六"]

/** 这一次运行的编号。操作按「会话号 + 序号」去重，跨会话也不会重复执行。
 *  必须声明在入口代码之前——const 在自己那行执行之前碰不得，而入口那段就会调用 runApp。 */
const SID = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

// 跟随系统深浅色。和 SID 一样必须声明在入口之前——入口那段就会画界面。
const INK = a => Color.dynamic(new Color("#2A2622", a === undefined ? 1 : a),
                               new Color("#F6F1EC", a === undefined ? 1 : a))

// save() 写完会读回来核对，对不上就返回 false。我一直没看这个返回值——
// 万一它是静默失败的，那前面那些通道全是无辜的，而我会一直往错的地方修。
// 声明位置必须在入口之前：入口那段就会调用 runApp。
let saveFailed = null
function persist(where) {
  try {
    if (C.save(data) === false) saveFailed = where + "：写完读回来对不上"
  } catch (e) { saveFailed = where + "：" + e.message }
}

const REPO = "Myla0619/studywithclawd"
// 要下哪些文件由仓库里的 manifest.json 说了算——引导脚本和这里各维护一份列表的话，
// 加了新文件只改一边，另一边就永远装不上（MylaTest 就是这么漏的）。
const FALLBACK_FILES = ["MylaCore.js", "MylaView.js", "Myla.js", "MylaWidget.js", "MylaWhy.js"]

// ---------------------------------------------------------------- 入口

let data = C.rollover(C.load())

// 正门：页面保存待办/倒数日时带着完整日志重启本脚本，这里直接写盘再重开界面。
// 按会话号+序号去重（doneUpTo/markDone），拦截通道如果其实也送到了，不会重复执行。
const doParam = (args.queryParameters && args.queryParameters.do) || ""
if (doParam) {
  try {
    const batch = JSON.parse(decodePayload(doParam))
    for (const m of batch) {
      if (!m.sid || m.i === undefined || m.i <= doneUpTo(m.sid)) continue
      markDone(m.sid, m.i)
      if (m.t !== "export" && m.t !== "update") applySafe(m)
    }
  } catch (e) { data.lastChannelError = "正门: " + ((e && e.message) || e) }
  C.save(data)
  scheduleNudge()
  await runApp()
  Script.complete()
  throw new Error("__done__")   // Script.complete 不中断执行，别让下面的入口再跑一遍
}

// 从微信来的待办：快捷指令把剪贴板以 todo: 前缀传进来（或 URL 的 todo 参数）。
// 静默处理：解析、拆条、去重、直接写盘、通知确认，不开界面。
const todoParam = ((args.queryParameters && args.queryParameters.todo) || "").toString()
  || (String(args.shortcutParameter || "").indexOf("todo:") === 0
      ? String(args.shortcutParameter).slice(5) : "")
if (todoParam.trim()) {
  const key = C.dayKey()
  const list = data.todos[key] || (data.todos[key] = [])
  const items = extractTodos(todoParam)
  const added = []
  for (const text of items) {
    // 按内容去重：同一条消息复制两次不该出现两条
    if (list.some(x => x.text === text)) continue
    list.push({ id: uid(), text, done: false })
    added.push(text)
  }
  if (added.length) C.save(data)

  const n = new Notification()
  n.title = added.length ? "记到今天要做的了 ✓" : "没有新东西"
  n.body = added.length ? added.join("\n")
    : (items.length ? "这些已经在清单里了" : "剪贴板里没读到能当待办的内容")
  n.schedule()

  if (config.runsInApp) {
    const a = new Alert()
    a.title = n.title
    a.message = n.body
    a.addAction("好")
    await a.present()
  }
  Script.complete()
  throw new Error("__done__")
}

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
  // 更新放在开界面之前，因为「关窗口之后」那个位置对上划退出 app 的人根本不会跑，
  // 于是永远更不到新版。这里最多六小时查一次，静默下载不打断你，下次打开生效。
  await selfUpdate(false)
  await pullInbox(false)     // 微信 bot 抽的待办，静默拉一把
  // 上次可能留着没落盘的操作（点了东西然后被杀），先捞回来
  await drainPending()
  // 定案，不再改：主界面是 UITable，所有写操作点一下当场 C.save——
  // 这是从第一天起唯一从没丢过数据的路。网页只当查看器（看圆盘/统计），
  // viewOnly，里面点不了任何会写的东西。用户测了一百次拍的板。
  await showTable()
}
Script.complete()

// ---------------------------------------------------------------- 主界面（UITable）
//
// 切状态和清单打勾走这里，不走网页。
// 理由很直接：UITable 的 onSelect 是脚本代码，点一下当场 C.save，这条路
// 是验证过能用的；而网页到脚本那层通道在真机上一直不可靠，用户的记录丢过好几次。
// 圆盘、统计、倒数日这些「看」的东西仍然在网页里，点「看圆盘和统计」进去。
//
// 长相上确实不如网页那版，这是拿好看换存得住。等网页那条通道确认稳了可以换回去。

/**
 * 主界面。
 *
 * 关键：**需要弹输入框的操作，必须先把表关掉再弹**。
 * 在已经全屏展示的 UITable 里 await 一个 Alert，它多半永远不返回，
 * 后面的存盘代码就根本执行不到——「切状态和打勾能存、加待办和记倒数日存不住」
 * 就是这么来的：前两个不弹窗，后两个弹窗。
 *
 * 所以那类行设成 dismissOnSelect = true，把要做的事记在 pending 里；
 * 表关掉之后再执行、再把表重新打开。
 */
async function showTable() {
  let pending = null
  for (;;) {
    const t = new UITable()
    t.showSeparators = false
    drawTable(t, fn => { pending = fn })
    await t.present(true)
    if (!pending) return
    const fn = pending
    pending = null
    await fn()            // 表已经关了，这时候弹 Alert 是安全的
  }
}

function drawTable(t, defer) {
  t.removeAllRows()
  const now = Date.now()
  const segs = C.segments(data)
  const open = C.openSegment(segs)
  const tot = C.totals(segs, now)

  const dial = new UITableRow()
  dial.height = 320
  dial.addImage(C.drawDial(data, segs, 290, { now })).centerAligned()
  t.addRow(dial)

  if (saveFailed) note(t, "⚠️ " + saveFailed, "#F2363C")
  if (data.pendingUpdate && data.pendingUpdate > C.VERSION) {
    note(t, "已下好 " + data.pendingUpdate + "，关掉重开就生效", "#40BBE7")
  }
  const acc = Object.keys(tot).reduce((a, k) => a + tot[k], 0)
  note(t, "今天已记录 " + C.hhmm(acc))

  head(t, "现在在做")
  for (const a of data.activities) {
    const r = new UITableRow()
    r.dismissOnSelect = false
    r.height = 58
    r.__label = a.name        // 图片行没有文字，测试靠这个找行
    const on = open && open.a === a.id
    r.addImage(actPill(a, on, tot[a.id] ? C.hhmm(tot[a.id]) : "")).centerAligned()
    r.onSelect = () => {
      // 当场存盘。这就是那条从没丢过的路。
      data = C.switchTo(data, a.id, Date.now(), "me")
      persist("切状态")
      scheduleNudge()
      drawTable(t, defer); t.reload()
    }
    t.addRow(r)
  }

  const key = C.dayKey()
  const list = data.todos[key] || (data.todos[key] = [])
  const left = list.filter(x => !x.done).length
  head(t, left ? "今天要做的 · 还剩 " + left + " 条" : "今天要做的")
  const sorted = list.slice().sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0))
  for (const it of sorted) {
    const r = new UITableRow()
    r.dismissOnSelect = false
    r.height = 56
    r.__label = it.text
    r.addImage(todoPill(it)).centerAligned()
    r.onSelect = () => {
      it.done = !it.done
      it.doneAt = it.done ? Date.now() : null
      creditGoal(it, it.done ? 1 : -1)   // 绑了目标就给那棵树浇水/收回
      persist("清单打勾")
      drawTable(t, defer); t.reload()
    }
    t.addRow(r)
  }
  deferAction(t, defer, "＋ 加一条", "#7DD73C", async () => {
    const al = new Alert()
    al.title = "加一条"
    al.addTextField("要做什么", "")
    al.addAction("加上"); al.addCancelAction("取消")
    if (await al.present() < 0) return
    const v = (al.textFieldValue(0) || "").trim()
    if (!v) return
    let goal = null
    if (data.goals.length) goal = await pickGoal()
    const key2 = C.dayKey()
    const l2 = data.todos[key2] || (data.todos[key2] = [])
    l2.push({ id: uid(), text: v, done: false, goal: goal })
    persist("加清单")
  })

  head(t, "目标 · 完成相关待办浇水长大")
  if (!data.goals.length) note(t, "还没有目标，立一个试试")
  for (const g of data.goals) {
    const r = new UITableRow()
    r.dismissOnSelect = true
    r.height = 66
    r.__label = g.name
    r.addImage(goalPill(g)).centerAligned()
    const gRef = g
    r.onSelect = () => defer(() => editGoal(gRef))
    t.addRow(r)
  }
  deferAction(t, defer, "＋ 立一个目标", "#7DD73C", () => editGoal(null))

  head(t, "倒数日")
  const cds = C.sortedCountdowns(data, now)
  if (!cds.length) note(t, "还没有记着的日子")
  for (const it of cds) {
    const r = new UITableRow()
    r.dismissOnSelect = false
    r.height = 52
    const dot = r.addText("●")
    dot.titleColor = new Color(it.cd.hex || "#F566AD")
    dot.titleFont = Font.systemFont(15); dot.widthWeight = 10
    const c = r.addText(it.cd.name, dateLine(it))
    c.titleColor = INK(it.days < 0 ? 0.45 : 1); c.titleFont = Font.systemFont(17)
    c.subtitleColor = INK(0.4); c.subtitleFont = Font.systemFont(12)
    c.widthWeight = 62
    const d = r.addText(it.days === 0 ? "今天" : Math.abs(it.days) + " 天")
    d.rightAligned(); d.widthWeight = 28
    d.titleColor = INK(it.days < 0 ? 0.3 : 0.75)
    d.titleFont = Font.boldSystemFont(16)
    r.dismissOnSelect = true
    const cdRef = it.cd
    r.onSelect = () => defer(() => editCountdown(cdRef))
    t.addRow(r)
  }
  deferAction(t, defer, "＋ 记一个日子", "#7DD73C", () => editCountdown(null))

  head(t, "别的")
  deferAction(t, defer, "看圆盘 / 统计", null, () => runApp())
  {
    // 外观：点一下循环切换，当场存盘重画，不用弹窗
    const label = { auto: "跟随系统", dark: "夜间", light: "日间" }[data.appearance || "auto"]
    action(t, "外观 · " + label, null, () => {
      data.appearance = { auto: "dark", dark: "light", light: "auto" }[data.appearance || "auto"]
      persist("切外观")
      drawTable(t, defer); t.reload()
    })
  }
  deferAction(t, defer, "中间的形象 · " + (data.avatarOn ? "自己的图" : "Clawd"), null, () => avatarFlow())
  deferAction(t, defer, "微信收件箱 · " + (inboxConfig() ? "已连" : "没配"), null, () => inboxSetup())
  deferAction(t, defer, "管理状态", null, () => manageActs())
  deferAction(t, defer, "定时问一句 · " + (data.nudgeMinutes === 0 ? "关着"
    : (data.nudgeMinutes || 90) + " 分钟"), null, () => setNudge())
  deferAction(t, defer, "导出一份备份", null, async () => {
    try { await DocumentPicker.exportFile(C.DATA) } catch (e) {}
  })
  note(t, "版本 " + C.VERSION)
}

function dateLine(it) {
  const d = it.when
  return (it.days < 0 ? "已过 · " : "") + (d.getMonth() + 1) + "月" + d.getDate() + "日 周"
    + WEEK_S[d.getDay()] + (it.cd.yearly ? " · 每年" : "")
}

/** 记 / 改一个日子。走 Alert，存盘是脚本当场做的。 */
async function editCountdown(cd) {
  const al = new Alert()
  al.title = cd ? cd.name : "记一个日子"
  al.message = "日期写成 2026-12-25 这样。每年重复的（生日、纪念日）过完自动滚到明年。"
  al.addTextField("叫什么", cd ? cd.name : "")
  al.addTextField("日期 2026-12-25", cd ? cd.date : "")
  al.addAction(cd ? "改好了" : "记下")
  al.addAction((cd && cd.yearly ? "关掉" : "开启") + "每年重复")
  if (cd) al.addDestructiveAction("删掉")
  al.addCancelAction("取消")
  const i = await al.present()
  if (i < 0) return

  if (cd && i === 2) { data.countdowns = data.countdowns.filter(x => x.id !== cd.id)
    persist("删倒数日"); return }

  const name = (al.textFieldValue(0) || "").trim()
  const date = (al.textFieldValue(1) || "").trim()
  if (i <= 1 && (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    const bad = new Alert()
    bad.title = "没记下"
    bad.message = !name ? "名字不能空" : "日期要写成 2026-12-25 这样"
    bad.addAction("好")
    await bad.present()
    return
  }
  const yearly = i === 1 ? !(cd && cd.yearly) : !!(cd && cd.yearly)
  if (cd) { cd.name = name; cd.date = date; cd.yearly = yearly }
  else {
    const used = data.countdowns.map(x => x.hex)
    const hex = C.CD_PALETTE.find(h => used.indexOf(h) < 0)
      || C.CD_PALETTE[data.countdowns.length % C.CD_PALETTE.length]
    data.countdowns.push({ id: uid(), name, date, yearly, hex })
  }
  persist(cd ? "改倒数日" : "加倒数日")
}

/** 管理状态：改名、删、加。 */
/** 管理状态。同样：每个动作都要弹窗，所以点了先关表，关了再弹。 */
async function manageActs() {
  let pending = null
  for (;;) {
    const t = new UITable()
    t.removeAllRows()
    head(t, "点一个改名或删掉")
    for (const a of data.activities) {
      const r = new UITableRow()
      r.dismissOnSelect = true
      r.height = 46
      const c = r.addText(a.name)
      c.titleColor = new Color(a.hex); c.titleFont = Font.systemFont(17)
      const ref = a
      r.onSelect = () => { pending = () => renameAct(ref) }
      t.addRow(r)
    }
    const add = new UITableRow()
    add.dismissOnSelect = true
    add.height = 48
    add.addText("＋ 加一个").titleColor = new Color("#7DD73C")
    add.onSelect = () => { pending = () => newAct() }
    t.addRow(add)

    await t.present(true)
    if (!pending) return
    const fn = pending; pending = null
    await fn()
  }
}

async function renameAct(a) {
  const al = new Alert()
  al.title = a.name
  al.addTextField("名字", a.name)
  al.addAction("改名"); al.addDestructiveAction("删掉"); al.addCancelAction("取消")
  const k = await al.present()
  if (k === 0) { a.name = (al.textFieldValue(0) || "").trim() || a.name; persist("改状态名") }
  // 只从能选的里拿掉，已经记下的时段不动
  if (k === 1) { data.activities = data.activities.filter(x => x.id !== a.id); persist("删状态") }
}

async function newAct() {
  const al = new Alert()
  al.title = "新状态"
  al.addTextField("比如「实习」", "")
  al.addAction("加上"); al.addCancelAction("取消")
  if (await al.present() < 0) return
  const v = (al.textFieldValue(0) || "").trim()
  if (!v) return
  const pal = C.DEFAULT_ACTIVITIES.map(x => x.hex)
  data.activities.push({ id: "c" + uid().slice(0, 6), name: v,
    hex: pal[data.activities.length % pal.length] })
  persist("加状态")
}

/**
 * 拉微信收件箱：Mac 上的 bot 把 Claude 抽好的待办推进私有仓库的 inbox.json，
 * 这里每次打开拉一把，按条目 id 去重后并进今天的清单。
 * 配置存在 myladay.inbox.json（本地文件，含只读 token，不进任何仓库）。
 */
function inboxConfig() {
  const fmL = FileManager.local()
  const p = fmL.joinPath(fmL.documentsDirectory(), "myladay.inbox.json")
  try { return JSON.parse(fmL.readString(p)) } catch (e) { return null }
}
async function pullInbox(loud) {
  const cfg = inboxConfig()
  if (!cfg || !cfg.repo || !cfg.token) {
    if (loud) await toast("还没配置", "先在「微信收件箱」里填仓库和 token")
    return
  }
  try {
    const r = new Request("https://api.github.com/repos/" + cfg.repo + "/contents/inbox.json")
    r.headers = {
      "Authorization": "Bearer " + cfg.token,
      "Accept": "application/vnd.github.raw+json",
      "User-Agent": "Myla"
    }
    r.timeoutInterval = loud ? 15 : 6
    const j = JSON.parse(await r.loadString())
    const key = C.dayKey()
    const list = data.todos[key] || (data.todos[key] = [])
    const added = []
    for (const it of (j.items || [])) {
      if (!it || !it.id || !it.text) continue
      if (data.inboxSeen[it.id]) continue
      data.inboxSeen[it.id] = 1
      if (!list.some(x => x.text === it.text && !x.done)) {
        list.push({ id: uid(), text: it.text, done: false })
        added.push(it.text)
      }
    }
    // 去重账本别无限长
    const seen = Object.keys(data.inboxSeen)
    if (seen.length > 300) for (const k of seen.slice(0, seen.length - 300)) delete data.inboxSeen[k]
    if (added.length) {
      persist("微信收件箱")
      const n = new Notification()
      n.title = "微信收进 " + added.length + " 条"
      n.body = added.join("\n")
      n.schedule()
    }
    if (loud) await toast(added.length ? "收进 " + added.length + " 条" : "没有新的", added.join("\n"))
  } catch (e) {
    if (loud) await toast("拉取失败", (e && e.message) || String(e))
    /* 静默模式失败就算了，下次打开再试 */
  }
}
async function inboxSetup() {
  const cfg = inboxConfig() || {}
  const al = new Alert()
  al.title = "微信收件箱"
  al.message = "Mac 上的 bot 往私有仓库写待办，这里拉取。\ntoken 只需要那个仓库的只读权限，存在本机。"
  al.addTextField("仓库（如 liuliu-21/myla-inbox）", cfg.repo || "liuliu-21/myla-inbox")
  al.addTextField("只读 token（github_pat_ 开头）", cfg.token || "")
  al.addAction("保存并试拉一次")
  if (cfg.repo) al.addDestructiveAction("清掉配置")
  al.addCancelAction("取消")
  const i = await al.present()
  if (i < 0) return
  const fmL = FileManager.local()
  const p = fmL.joinPath(fmL.documentsDirectory(), "myladay.inbox.json")
  if (i === 1) { try { fmL.remove(p) } catch (e) {}; return }
  fmL.writeString(p, JSON.stringify({ repo: al.textFieldValue(0).trim(), token: al.textFieldValue(1).trim() }))
  await pullInbox(true)
}

/** 换圆盘中间的形象：从相册选一张图，缩成方块存起来；随时换回 Clawd。 */
async function avatarFlow() {
  const al = new Alert()
  al.title = "圆盘中间放什么"
  al.message = "从相册选的图会裁成圆形放在圆盘中心，小组件上同步。"
  al.addAction("从相册选一张")
  if (FileManager.local().fileExists(C.AVATAR)) al.addDestructiveAction("换回 Clawd")
  al.addCancelAction("取消")
  const i = await al.present()
  if (i < 0) return
  const fmL = FileManager.local()

  if (i === 1) {                     // 换回 Clawd
    try { fmL.remove(C.AVATAR) } catch (e) {}
    data.avatarOn = false
    persist("换回 Clawd")
    return
  }

  try {
    const img = await Photos.fromLibrary()
    if (!img) return
    // 归一成 480 方块（图太大的话小组件画起来又慢又费内存）
    const box = 480
    const ctx = new DrawContext()
    ctx.size = new Size(box, box)
    ctx.opaque = false
    ctx.respectScreenScale = false
    const sc = Math.max(box / img.size.width, box / img.size.height)
    const w = img.size.width * sc, h = img.size.height * sc
    ctx.drawImageInRect(img, new Rect((box - w) / 2, (box - h) / 2, w, h))
    fmL.writeImage(C.AVATAR, ctx.getImage())
    data.avatarOn = true
    persist("换中间形象")
  } catch (e) {
    const b = new Alert()
    b.title = "没换成"
    b.message = (e && e.message) || String(e)
    b.addAction("好")
    await b.present()
  }
}

async function setNudge() {
  const a = new Alert()
  a.title = "隔多久问一次？"
  a.message = "超过这个时长没换状态，就推一条通知，通知上直接能改。"
  const opts = [45, 60, 90, 120, 180]
  for (const m of opts) a.addAction(m + " 分钟")
  a.addDestructiveAction("关掉提醒")
  a.addCancelAction("取消")
  const i = await a.present()
  if (i < 0) return
  data.nudgeMinutes = i === opts.length ? 0 : opts[i]
  persist("改提醒间隔")
  scheduleNudge()
}

// ---------------------------------------------------------------- 胶囊卡片
// 「好看的那版能不能 UITable」——能：UITable 撑布局和点击，DrawContext 撑长相。
// 每个状态/待办/倒数日画成网页版那种圆角卡片，一行一张图、整行可点。
// 存盘还是行点击当场 C.save 那条路，一行没动。

function uiDark() {
  if (data.appearance === "dark") return true
  if (data.appearance === "light") return false
  try { return Device.isUsingDarkAppearance() } catch (e) { return true }
}
function uiWidth() {
  try { return Math.min(Device.screenSize().width, 430) - 32 } catch (e) { return 358 }
}
function UI() {
  return uiDark()
    ? { card: "#1E1A24", ink: "#F6F1EC" }
    : { card: "#FFFFFF", ink: "#2A2622" }
}
function pillCtx(w, h) {
  const ctx = new DrawContext()
  ctx.size = new Size(w, h)
  ctx.opaque = false
  ctx.respectScreenScale = true
  return ctx
}
function rr(ctx, x, y, w, h, rad, hex, alpha) {
  const p = new Path()
  p.addRoundedRect(new Rect(x, y, w, h), rad, rad)
  ctx.addPath(p)
  ctx.setFillColor(alpha === undefined ? new Color(hex) : new Color(hex, alpha))
  ctx.fillPath()
}

/** 状态胶囊：色点 + 名字 + 今日时长，当前状态描一圈自己的颜色。 */
function actPill(a, on, lenText) {
  const W = uiWidth(), H = 52, u = UI()
  const ctx = pillCtx(W, H)
  if (on) { rr(ctx, 0, 0, W, H, 15, a.hex); rr(ctx, 2, 2, W - 4, H - 4, 13, u.card) }
  else rr(ctx, 0, 0, W, H, 15, u.card)
  ctx.setFillColor(new Color(a.hex))
  ctx.fillEllipse(new Rect(16, H / 2 - 5, 10, 10))
  ctx.setTextAlignedLeft()
  ctx.setFont(on ? Font.boldSystemFont(17) : Font.systemFont(17))
  ctx.setTextColor(new Color(u.ink))
  ctx.drawTextInRect(a.name, new Rect(38, H / 2 - 11, W - 150, 22))
  if (lenText) {
    ctx.setTextAlignedRight()
    ctx.setFont(Font.systemFont(13))
    ctx.setTextColor(new Color(u.ink, 0.45))
    ctx.drawTextInRect(lenText, new Rect(W - 116, H / 2 - 9, 102, 18))
  }
  return ctx.getImage()
}

/** 待办胶囊：圆勾选框 + 文字，做完了变灰、圈变绿、右边记时间。 */
function todoPill(it) {
  const W = uiWidth(), H = 50, u = UI()
  const ctx = pillCtx(W, H)
  rr(ctx, 0, 0, W, H, 15, u.card)
  const cy = H / 2
  if (it.done) {
    ctx.setFillColor(new Color("#58C04A"))
    ctx.fillEllipse(new Rect(14, cy - 11, 22, 22))
    ctx.setTextAlignedCenter()
    ctx.setFont(Font.boldSystemFont(13))
    ctx.setTextColor(new Color("#FFFFFF"))
    ctx.drawTextInRect("✓", new Rect(14, cy - 8, 22, 16))
  } else {
    ctx.setFillColor(new Color(u.ink, 0.28))
    ctx.fillEllipse(new Rect(14, cy - 11, 22, 22))
    ctx.setFillColor(new Color(u.card))
    ctx.fillEllipse(new Rect(16, cy - 9, 18, 18))
  }
  ctx.setTextAlignedLeft()
  ctx.setFont(Font.systemFont(16))
  ctx.setTextColor(new Color(u.ink, it.done ? 0.35 : 1))
  ctx.drawTextInRect(it.text, new Rect(46, cy - 10, W - 46 - 64, 20))
  if (it.done && it.doneAt) {
    ctx.setTextAlignedRight()
    ctx.setFont(Font.systemFont(12))
    ctx.setTextColor(new Color(u.ink, 0.3))
    ctx.drawTextInRect(C.clock(Math.floor(it.doneAt / 1000)), new Rect(W - 62, cy - 8, 48, 16))
  }
  return ctx.getImage()
}

/** 倒数日胶囊：左色条 + 名字/日期 + 右侧大数字。已过的整体退灰。 */
function cdPill(it) {
  const W = uiWidth(), H = 56, u = UI()
  const past = it.days < 0
  const ctx = pillCtx(W, H)
  rr(ctx, 0, 0, W, H, 15, u.card)
  rr(ctx, 12, 10, 4, H - 20, 2, it.cd.hex || "#F566AD")
  ctx.setTextAlignedLeft()
  ctx.setFont(Font.semiboldSystemFont(16))
  ctx.setTextColor(new Color(u.ink, past ? 0.45 : 0.95))
  ctx.drawTextInRect(it.cd.name, new Rect(28, 8, W - 150, 20))
  ctx.setFont(Font.systemFont(12))
  ctx.setTextColor(new Color(u.ink, 0.4))
  ctx.drawTextInRect(dateLine(it), new Rect(28, H - 24, W - 150, 16))
  ctx.setTextAlignedRight()
  const big = it.days === 0 ? "今天" : String(Math.abs(it.days))
  ctx.setFont(Font.boldSystemFont(24))
  ctx.setTextColor(it.days === 0 ? new Color(it.cd.hex || "#F566AD")
                                 : new Color(u.ink, past ? 0.3 : 0.9))
  ctx.drawTextInRect(big, new Rect(W - 112, H / 2 - 16, it.days === 0 ? 100 : 72, 30))
  if (it.days !== 0) {
    ctx.setTextAlignedLeft()
    ctx.setFont(Font.systemFont(12))
    ctx.setTextColor(new Color(u.ink, 0.4))
    ctx.drawTextInRect("天", new Rect(W - 34, H / 2 + 1, 22, 16))
  }
  return ctx.getImage()
}

/** 目标胶囊：左边一棵会长大的树，右边名字 + X/25 进度条。 */
function goalPill(g) {
  const W = uiWidth(), H = 62, u = UI()
  const done = g.done || 0
  const ctx = pillCtx(W, H)
  rr(ctx, 0, 0, W, H, 15, u.card)
  // 树画在左侧一个小方块里
  C.drawTree(ctx, 34, 6, 5, C.goalStage(done))
  // 名字
  ctx.setTextAlignedLeft()
  ctx.setFont(Font.semiboldSystemFont(16))
  ctx.setTextColor(new Color(u.ink, 0.95))
  ctx.drawTextInRect(g.name, new Rect(66, 12, W - 66 - 14, 20))
  // 进度条
  const bx = 66, bw = W - 66 - 14, by = H - 22
  rr(ctx, bx, by, bw, 7, 3.5, u.ink, 0.12)
  const frac = Math.max(0, Math.min(1, done / C.GOAL_TARGET))
  if (frac > 0) rr(ctx, bx, by, Math.max(7, bw * frac), 7, 3.5, g.hex || "#3AA05A")
  ctx.setTextAlignedRight()
  ctx.setFont(Font.systemFont(12))
  ctx.setTextColor(new Color(u.ink, 0.5))
  ctx.drawTextInRect(done + " / " + C.GOAL_TARGET, new Rect(bx, by - 18, bw, 15))
  return ctx.getImage()
}

/** 给待办绑定的目标记账。delta = +1 完成 / -1 撤销。 */
function creditGoal(todo, delta) {
  if (!todo || !todo.goal) return
  const g = data.goals.find(x => x.id === todo.goal)
  if (!g) return
  g.done = Math.max(0, (g.done || 0) + delta)
}

/** 加待办时选一个目标（可以不选）。 */
async function pickGoal() {
  const al = new Alert()
  al.title = "算进哪个目标？"
  al.message = "完成这条会给那棵树浇水。不选也行。"
  for (const g of data.goals) al.addAction(g.name)
  al.addCancelAction("不绑定")
  const i = await al.present()
  return i < 0 ? null : data.goals[i].id
}

/** 立 / 改一个目标。 */
async function editGoal(g) {
  const al = new Alert()
  al.title = g ? g.name : "立一个目标"
  al.message = "比如「实习」「科研」。完成绑定它的待办，树就长大，25 条开花。"
  al.addTextField("目标名字", g ? g.name : "")
  al.addAction(g ? "改好了" : "立下")
  if (g) al.addDestructiveAction("删掉这个目标")
  al.addCancelAction("取消")
  const i = await al.present()
  if (i < 0) return
  if (g && i === 1) {
    // 删目标不动待办，只是那些待办的 goal 变成悬空（记账已经发生过，不回退）
    data.goals = data.goals.filter(x => x.id !== g.id)
    persist("删目标"); return
  }
  const name = (al.textFieldValue(0) || "").trim()
  if (!name) return
  if (g) { g.name = name }
  else {
    const used = data.goals.map(x => x.hex)
    const pal = ["#3AA05A", "#F5822F", "#5464DE", "#B05AE2", "#F566AD", "#40BBE7"]
    const hex = pal.find(h => used.indexOf(h) < 0) || pal[data.goals.length % pal.length]
    data.goals.push({ id: uid(), name: name, hex: hex, done: 0 })
  }
  persist(g ? "改目标" : "立目标")
}

function head(t, text) {
  const r = new UITableRow()
  r.isHeader = true
  const c = r.addText(text)
  c.titleColor = INK(0.55); c.titleFont = Font.semiboldSystemFont(13)
  t.addRow(r)
}
function note(t, text, hex) {
  const r = new UITableRow()
  r.dismissOnSelect = false
  const c = r.addText(text)
  c.titleColor = hex ? new Color(hex) : INK(0.4)
  c.titleFont = Font.systemFont(12.5); c.centerAligned()
  t.addRow(r)
}
/** 需要弹窗（或开新界面）的行：点了先把表关掉，等表关了再做那件事。 */
function deferAction(t, defer, text, hex, fn) {
  const r = new UITableRow()
  r.dismissOnSelect = true
  r.height = 48
  const c = r.addText(text)
  c.titleFont = Font.systemFont(17)
  if (hex) c.titleColor = new Color(hex)
  r.onSelect = () => defer(fn)
  t.addRow(r)
}

function action(t, text, hex, fn) {
  const r = new UITableRow()
  r.dismissOnSelect = false
  r.height = 48
  const c = r.addText(text)
  c.titleFont = Font.systemFont(17)
  if (hex) c.titleColor = new Color(hex)
  r.onSelect = fn
  t.addRow(r)
}

// ---------------------------------------------------------------- 开窗口

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
  const wv = new WebView()
  const json = JSON.stringify(payload())
    .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")
  // 不给 baseURL —— 这一行是整个丢数据案子的案发现场，别再动它。
  //
  // 带上 https 的 baseURL，页面就有了 https 身份，WKWebView 禁止 https 页面
  // 跳转到自定义协议，myladay:// 一条都发不出去：这正是「MylaTest 体检全绿
  // （它的页面没有 baseURL）、真 app 里 applied 一条记录都没有」的原因。
  // 加 baseURL 换来的 localStorage 也是假的——Scriptable 的 WebView 每次都是
  // 新实例，localStorage 存不过夜，从没成功捞回过任何东西。
  //
  // 上划退出也不怕：myladay:// 是点击当下就发的，不依赖任何「关窗口之后」的代码。
  await wv.loadHTML(V.HTML + "<script>window.boot(" + json + ", true)</" + "script>")

  // 存盘一共四条通道，因为其中没有一条我能在电脑上验证。任意一条通一次，
  // 所有操作就都在——页面每次发的是「到目前为止的全部操作」，不是单条，
  // 脚本按序号去重。实测过五种丢包模式（全通/只通最后一条/只通第一条/
  // 一条不通/隔一条丢一条），结果完全一致。
  //
  //   ① 每次点击当场发 myladay:// 跳转，这里拦下来（下面这段）
  //   ② 关窗口后再读一遍页面变量
  //
  // 只留这两条，因为它们是 MylaTest 在用户手机上实测为绿的两条。
  // 原来还有一条「窗口开着时每两秒轮询」，用的是对已弹出 WebView 调
  // evaluateJavaScript——白屏事件里证实这个原语会永远挂起，挂起的调用
  // 可能把桥堵死，连 ① 的回调都送不进来。体检没有轮询所以绿、
  // 真 app 有轮询所以死，这是 baseURL 排除之后剩下的唯一结构性差别。
  // 轮询删了。
  let appliedUpTo = 0
  let wantExport = false
  wv.shouldAllowRequest = req => {
    const u = (req && req.url) || ""
    if (u.indexOf("myladay://") !== 0) return true
    // 先记「到货」再解析：到没到和解析成不成功是两回事，混在一起就没法定位。
    // MylaWhy 会显示这个计数——它是 0 就是根本没送到，大于 0 就看后面的错误字段。
    const ch = data.chan || (data.chan = {})
    ch.arrivals = (ch.arrivals || 0) + 1
    ch.lastLen = u.length
    ch.lastAt = Date.now()
    try { C.save(data) } catch (e2) {}
    try {
      // 收到的是「到目前为止的全部操作」，按序号只取没执行过的那些。
      // 所以中途丢几条消息不要紧，后一条会把前面的一起带过来。
      const batch = JSON.parse(decodePayload(u.slice(u.indexOf("m=") + 2)))
      let n = 0
      for (const m of batch) {
        if (m.i < appliedUpTo) continue
        appliedUpTo = m.i + 1
        markDone(m.sid || SID, m.i)
        if (m.t === "export") wantExport = true
        else if (m.t !== "update" && applySafe(m)) n++
      }
      if (n) persist("实时拦截")
    } catch (e) {
      // 留个痕，不然这条通道再出问题又是静默的，MylaWhy 里能看到
      data.lastChannelError = (e && e.message ? e.message : String(e)).slice(0, 120)
      try { C.save(data) } catch (e2) {}
    }
    return false
  }

  const closed = wv.present(true)

  const take = batch => {
    let n = 0
    for (const m of batch) {
      if (m.i === undefined || m.i < appliedUpTo) continue
      appliedUpTo = m.i + 1
      markDone(m.sid || SID, m.i)
      if (m.t === "export") wantExport = true
      else if (m.t !== "update" && applySafe(m)) n++
    }
    if (n) persist("轮询/兜底")
    return n
  }
  // 落盘之后把页面那份残留清掉，不然下次启动会再捞一遍
  const clearPending = () => wv.evaluateJavaScript(
    "localStorage.removeItem('myla_pending')").catch(() => {})

  await closed

  // 第三条：关窗口后再读一遍。按 i 去重，几条通道同时生效也不会重复执行。
  let log = []
  let readOk = false
  try {
    const raw = await wv.evaluateJavaScript("JSON.stringify(window.LOG || [])")
    log = JSON.parse(raw || "[]")
    readOk = true
  } catch (e) { /* 读不到就算了，浏览器里那份暂存还在，下次启动捞 */ }

  take(log)
  // 只有确认读到了页面记录才清暂存。读失败还清的话，等于把唯一的备份亲手删掉——
  // 这条是冒烟测试抓出来的，「只有 localStorage 活着」的场景当场就丢数据。
  if (readOk) await clearPending()
  scheduleNudge()

  if (saveFailed) {
    const a = new Alert()
    a.title = "存盘失败了"
    a.message = saveFailed + "\n\n这说明问题在写文件那一步，不在页面通道。\n把这句话发给我。"
    a.addAction("好")
    await a.present()
  }

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
  // 每次打开都查。原来六小时一次，结果用户在几十分钟里反复测试却一直拿不到新版，
  // 我发的每一版对他都不存在。一个小请求而已，别为了省它把更新变成玄学。
  if (!force && data.lastCheck && now - data.lastCheck < 60000) return
  data.lastCheck = now

  let sha = null
  try {
    const r = new Request("https://api.github.com/repos/" + REPO + "/commits/main")
    r.headers = { "User-Agent": "MylaDay" }      // 不带 UA 直接 403
    r.timeoutInterval = force ? 15 : 5      // 静默查的时候别让开 app 等太久
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

  let files = FALLBACK_FILES
  try {
    const mf = new Request(base + "manifest.json")
    mf.timeoutInterval = 12
    const m = await mf.loadJSON()
    if (m && m.files && m.files.length) files = m.files
  } catch (e) { /* 拿不到清单就用退路那份 */ }

  let ok = 0
  const failed = []
  for (const name of files) {
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

/** 每条操作单独兜住。原来一批里只要有一条抛异常，整批都不落盘——
 *  倒数日存不住而切状态存得住，最像这种「一条毒死一批」的情况。 */
function applySafe(m) {
  try { apply(m); return true }
  catch (e) {
    data.lastApplyError = m.t + "：" + ((e && e.message) || String(e)).slice(0, 100)
    return false
  }
}

function apply(m) {
  const key = C.dayKey(new Date(m.at))
  const todos = data.todos[key] || (data.todos[key] = [])

  switch (m.t) {
    case "switch":
      // 用操作当时的时间，不是现在
      data = C.switchTo(data, m.v, m.at, "me")
      break

    case "todo.add":
      todos.push({ id: m.v2, text: m.v, done: false, goal: m.v3 || null })
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
    case "simple": data.simpleMode = !!m.v; break
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

/**
 * 从一段聊天文字里抠出待办。微信消息什么样都有，规则从宽：
 * 按行和句号拆开，去掉序号、称呼、纯客套，太长的截到一句话，最多收 5 条。
 * 宁可多收一条（删一条只要两下），不可漏掉正事。
 */
function extractTodos(raw) {
  const out = []
  const parts = String(raw).split(/[\n\r]+|(?<=[。；;！!])/)
  for (let t of parts) {
    t = t.trim()
      .replace(/^[-•·*\d]+[.、)）\s]+/, "")            // 1. / - / · 这类序号
      .replace(/^(记得|别忘了|麻烦你?|帮我|你|拜托)/, "") // 常见开场
      .replace(/[。；;！!\s]+$/, "")
    if (!t) continue
    if (/^(好的?|收到|嗯+|哈+|谢谢|辛苦了|在吗|OK|ok)$/.test(t)) continue   // 纯客套
    if (t.length < 2) continue
    if (t.length > 60) t = t.slice(0, 60) + "…"
    out.push(t)
    if (out.length >= 5) break
  }
  return out
}


function sleep(ms) { return new Promise(r => Timer.schedule(ms, false, r)) }

/**
 * 页面发过来的那串。用 base64 是因为 JSON 里的 {}"[] 一旦被系统二次百分号编码，
 * decodeURIComponent 解一次就还剩 %7B 这种，JSON.parse 当场炸在 catch 里，
 * 数据静默丢掉而且什么都看不见。base64 的字符集不会被再编码一次。
 * 解不动就退回老办法，兼容旧页面。
 */
function decodePayload(raw) {
  try {
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/")
    const t = Data.fromBase64String(b64).toRawString()
    if (t && t.charAt(0) === "[") return t
  } catch (e) { /* 不是 base64，往下走 */ }
  let t = raw
  for (let i = 0; i < 3; i++) {          // 可能被编码了不止一层
    if (t.charAt(0) === "[") return t
    try { t = decodeURIComponent(t) } catch (e) { break }
  }
  return t
}

/** 把上次留在浏览器存储里、还没落盘的操作捞出来执行掉。
 *  这里保留 myla.local 的 baseURL：旧版本的残留写在那个源下面，换源就读不到了。
 *  新版本不再往 localStorage 写，这个函数只为清旧账。 */
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
      if (applySafe(m)) n++
    }
    if (n) persist("localStorage 捞回来的")
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
    viewOnly: true,   // 网页永远只负责看，写操作全在 UITable
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
    simpleMode: !!data.simpleMode,
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
