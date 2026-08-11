// Myla 的一天 — 主脚本
//
// 三种进入方式：
//   直接运行                    → 打开界面
//   快捷指令自动化传参          → 切状态后立刻退出（到达某地时用）
//   通知按钮 / URL scheme       → 同上
//     scriptable:///run?scriptName=MylaDay&switchTo=study
//
// 数据存在 Scriptable 自己的目录里，不需要 iCloud。

const C = importModule("MylaDayCore")

// 跟随系统外观，不然浅色模式下浅色文字全看不见
const INK  = a => Color.dynamic(new Color("#2A2622", a === undefined ? 1 : a),
                                new Color("#F6F1EC", a === undefined ? 1 : a))

const SPANS = [["周", 7], ["月", 30], ["3个月", 90]]
const CHARTS = [["柱状", "bar"], ["圆盘", "dial"]]

// ---------------------------------------------------------------- 入口

let data = C.rollover(C.load())

// 快捷指令传进来的可以是 id，也可以是中文名，两种都认。
const fromShortcut = (args.shortcutParameter || "").toString().trim()
const fromURL = (args.queryParameters && args.queryParameters.switchTo) || ""
const incoming = fromURL || fromShortcut

if (incoming) {
  const hit = data.activities.find(a => a.id === incoming || a.name === incoming)
  if (hit) {
    data = C.switchTo(data, hit.id)
    data.lastAuto = { why: fromURL ? "从通知里改的" : "自动化触发", at: Date.now() }
    C.save(data)
    scheduleNudge()
  }
  if (!config.runsInApp) Script.complete()
  else {
    const a = new Alert()
    a.title = hit ? `切成「${hit.name}」了` : `没有叫「${incoming}」的状态`
    a.addAction("好")
    await a.present()
  }
} else {
  await showMain()
}
Script.complete()

// ---------------------------------------------------------------- 今天

async function showMain() {
  const table = new UITable()
  table.showSeparators = false
  await refresh(table)
  await table.present(true)
}

async function refresh(table) {
  table.removeAllRows()
  const now = Date.now()
  const segs = C.segments(data)
  const open = C.openSegment(segs)
  const t = C.totals(segs, now)

  // 圆盘
  const dial = new UITableRow()
  dial.height = 330
  dial.addImage(C.drawDial(data, segs, 300, { now })).centerAligned()
  table.addRow(dial)

  // 数据出过问题必须让你知道，默默恢复等于骗你
  if (data.loadFailed) {
    warn(table, "⚠️ 数据文件读不出来，已从零开始。坏掉的那份留在 myladay.corrupt-*.json", "#F2363C")
  } else if (data.recoveredFromBackup) {
    warn(table, "⚠️ 主文件损坏，已用备份恢复，可能少了最后一次改动", "#F99243")
  }

  const acc = Object.keys(t).reduce((sum, k) => sum + t[k], 0)
  addNote(table, `今天已记录 ${C.hhmm(acc)}`)
  if (data.lastAuto && now - data.lastAuto.at < 3600000) {
    addNote(table, `刚才${data.lastAuto.why}，自动切的`)
  }

  // 睡着了没人能替你点 —— 长得离谱的一段主动问一句
  if (open && C.duration(open, now) > 4 * 3600) {
    const r = new UITableRow()
    r.dismissOnSelect = false
    const c = r.addText(`✂︎ 这一段已经 ${C.hhmm(C.duration(open, now))}，中间换过吗？`)
    c.titleColor = new Color("#FAD338")
    c.titleFont = Font.systemFont(14)
    r.onSelect = async () => { await splitFlow(open); await refresh(table); table.reload() }
    table.addRow(r)
  }

  addHeader(table, "现在在做")
  for (const a of data.activities) {
    const r = new UITableRow()
    r.dismissOnSelect = false
    const on = open && open.a === a.id
    const dot = r.addText(on ? "●" : "○")
    dot.titleColor = new Color(a.hex)
    dot.titleFont = Font.systemFont(17)
    dot.widthWeight = 10
    const c = r.addText(a.name)
    c.titleColor = INK()
    c.titleFont = on ? Font.boldSystemFont(17) : Font.systemFont(17)
    c.widthWeight = 60
    const d = r.addText(t[a.id] ? C.hhmm(t[a.id]) : "")
    d.rightAligned()
    d.titleColor = INK(0.45)
    d.titleFont = Font.systemFont(13)
    d.widthWeight = 30
    r.onSelect = async () => {
      data = C.switchTo(data, a.id)
      C.save(data)
      scheduleNudge()
      await refresh(table)
      table.reload()
    }
    table.addRow(r)
  }

  addTodos(table)

  addHeader(table, "别的")
  addAction(table, "统计", async () => { await showStats(); await refresh(table); table.reload() })
  addAction(table, "管理状态", async () => { await manageActivities(); await refresh(table); table.reload() })
  addAction(table, `提醒：每 ${nudgeMinutes()} 分钟问一次`, async () => {
    await setNudge(); await refresh(table); table.reload()
  })
  addAction(table, "导出一份备份", async () => {
    // 存到「文件」里，换手机或者我改坏了都能拿回来
    try { await DocumentPicker.exportFile(C.DATA) }
    catch (e) { await toast("导出取消了") }
  })
  addNote(table, "版本 " + C.VERSION)
}

// ---------------------------------------------------------------- 清单
//
// 打勾就完事，不弹窗不追问。做完的不消失、沉到底下——一天结束时能看见自己
// 干了什么，比清空列表更顶用。刻意不做「开始这条任务」：清单只是清单，
// 圆盘记的是你真的在干嘛，两件事不该互相替对方做决定。

function todosOf(key) {
  const k = key || C.dayKey()
  return data.todos[k] || (data.todos[k] = [])
}

function addTodos(table) {
  const list = todosOf()
  const left = list.filter(x => !x.done).length
  addHeader(table, left ? `今天要做的 · 还剩 ${left} 条` : "今天要做的")

  // 做完的沉到底下，顺序不变
  const sorted = list.slice().sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0))
  for (const item of sorted) {
    const r = new UITableRow()
    r.dismissOnSelect = false
    const box = r.addText(item.done ? "☑︎" : "☐")
    box.titleColor = item.done ? INK(0.3) : new Color("#7DD73C")
    box.titleFont = Font.systemFont(18)
    box.widthWeight = 10
    const c = r.addText(item.text)
    c.titleColor = item.done ? INK(0.32) : INK()
    c.titleFont = Font.systemFont(16)
    c.widthWeight = 75
    if (item.done && item.doneAt) {
      const d = r.addText(C.clock(Math.floor(item.doneAt / 1000)))
      d.rightAligned(); d.widthWeight = 15
      d.titleColor = INK(0.3); d.titleFont = Font.systemFont(12)
    }
    r.onSelect = async () => {
      item.done = !item.done
      item.doneAt = item.done ? Date.now() : null
      C.save(data)
      await refresh(table)
      table.reload()
    }
    table.addRow(r)
  }

  const add = new UITableRow()
  add.dismissOnSelect = false
  const plus = add.addText("＋ 加一条")
  plus.titleColor = new Color("#7DD73C")
  plus.titleFont = Font.systemFont(16)
  add.onSelect = async () => {
    const al = new Alert()
    al.title = "加一条"
    al.addTextField("要做什么", "")
    al.addAction("加上"); al.addCancelAction("取消")
    if (await al.present() < 0) return
    const text = al.textFieldValue(0).trim()
    if (!text) return
    todosOf().push({ id: Math.random().toString(36).slice(2, 10), text, done: false })
    C.save(data)
    await refresh(table)
    table.reload()
  }
  table.addRow(add)

  // 昨天没做完的：问一句，不自动搬。搬不搬是你说了算。
  const yk = C.dayKey(new Date(Date.now() - 86400000))
  const rest = (data.todos[yk] || []).filter(x => !x.done)
  if (rest.length && !list.length) {
    const r = new UITableRow()
    r.dismissOnSelect = false
    const c = r.addText(`昨天还剩 ${rest.length} 条，搬过来？`)
    c.titleColor = INK(0.45); c.titleFont = Font.systemFont(14)
    r.onSelect = async () => {
      for (const x of rest) {
        todosOf().push({ id: Math.random().toString(36).slice(2, 10), text: x.text, done: false })
      }
      C.save(data)
      await refresh(table)
      table.reload()
    }
    table.addRow(r)
  }

  if (list.length) {
    const r = new UITableRow()
    r.dismissOnSelect = false
    const c = r.addText("改 / 删")
    c.titleColor = INK(0.35); c.titleFont = Font.systemFont(13)
    r.onSelect = async () => { await editTodos(); await refresh(table); table.reload() }
    table.addRow(r)
  }
}

async function editTodos() {
  const t = new UITable()
  t.showSeparators = false
  addHeader(t, "点一条来改或者删")
  for (const item of todosOf()) {
    const r = new UITableRow()
    r.dismissOnSelect = false
    r.addText(item.text).titleColor = INK(item.done ? 0.35 : 1)
    r.onSelect = async () => {
      const al = new Alert()
      al.title = "这一条"
      al.addTextField("内容", item.text)
      al.addAction("改好了"); al.addDestructiveAction("删掉"); al.addCancelAction("取消")
      const k = await al.present()
      if (k === 0) { item.text = al.textFieldValue(0).trim() || item.text; C.save(data) }
      if (k === 1) {
        const key = C.dayKey()
        data.todos[key] = todosOf().filter(x => x.id !== item.id)
        C.save(data)
      }
      await editTodos()
    }
    t.addRow(r)
  }
  await t.present(true)
}

// ---------------------------------------------------------------- 页面 A：统计

async function showStats() {
  const table = new UITable()
  table.showSeparators = false
  refreshStats(table)
  await table.present(true)
}

function refreshStats(table) {
  table.removeAllRows()
  const span = data.ui.span, kind = data.ui.chart
  const bs = buckets(span)
  const agg = {}
  for (const b of bs) for (const k in b.totals) agg[k] = (agg[k] || 0) + b.totals[k]
  const total = Object.keys(agg).reduce((s, k) => s + agg[k], 0)
  // 按天数，不按桶数——3个月是周柱，13 个桶不等于 13 天
  let recordedDays = 0
  for (let back = 0; back < span; back++) {
    const k = C.dayKey(new Date(Date.now() - back * 86400000))
    if ((data.days[k] || []).length) recordedDays++
  }

  switcher(table, SPANS, span, v => {
    data.ui.span = v; C.save(data); refreshStats(table); table.reload()
  })
  switcher(table, CHARTS, kind, v => {
    data.ui.chart = v; C.save(data); refreshStats(table); table.reload()
  })

  const chart = new UITableRow()
  if (kind === "dial") {
    chart.height = 320
    chart.addImage(C.drawDonut(data, agg, 290, { sub: `有记录 ${recordedDays} 天` }))
      .centerAligned()
  } else {
    chart.height = 160
    chart.addImage(stackChart(bs, 300, 145)).centerAligned()
  }
  table.addRow(chart)

  addNote(table, span > 31
    ? `一根柱子是一周，${span} 天里有记录的 ${recordedDays} 天`
    : `一根柱子是一天，${span} 天里有记录的 ${recordedDays} 天`)

  addHeader(table, "点开看单项")
  const ranked = data.activities
    .filter(a => (agg[a.id] || 0) >= 60)
    .sort((x, y) => agg[y.id] - agg[x.id])
  if (!ranked.length) addNote(table, "这段时间还没有记录")
  for (const a of ranked) {
    const r = new UITableRow()
    r.dismissOnSelect = false
    const dot = r.addText("●"); dot.titleColor = new Color(a.hex); dot.widthWeight = 8
    const c = r.addText(a.name); c.titleColor = INK(); c.widthWeight = 42
    const pct = r.addText(total ? Math.round(agg[a.id] / total * 100) + "%" : "")
    pct.rightAligned(); pct.widthWeight = 18
    pct.titleColor = INK(0.35); pct.titleFont = Font.systemFont(13)
    const d = r.addText(C.hhmm(agg[a.id]))
    d.rightAligned(); d.widthWeight = 32
    d.titleColor = INK(0.5); d.titleFont = Font.systemFont(13)
    r.onSelect = async () => { await showActivity(a, span) }
    table.addRow(r)
  }
}

/**
 * 切换器。UITableRow 的 onSelect 是整行的，分段点击得用 addButton 的 onTap。
 * 选中的加方括号——万一按钮的 titleColor 不生效，靠符号也分得出来。
 */
function switcher(table, options, current, onPick) {
  const r = new UITableRow()
  r.dismissOnSelect = false
  r.height = 46
  for (const [label, value] of options) {
    const on = value === current
    const c = r.addButton(on ? `[ ${label} ]` : label)
    c.titleColor = on ? INK() : INK(0.35)
    c.centerAligned()
    c.dismissOnTap = false
    c.onTap = () => onPick(value)
  }
  table.addRow(r)
}

/**
 * 把最近 N 天切成柱子。30 天以内一天一根，再长就一周一根——
 * 90 根柱子每根两像素，看不出任何东西。
 */
function buckets(days) {
  const perWeek = days > 31
  const out = []
  const dayTotals = back => {
    const d = new Date(Date.now() - back * 86400000)
    const key = C.dayKey(d)
    const segs = data.days[key]
    if (!segs || !segs.length) return null
    const end = back === 0 ? Date.now() : C.startOfDay(d).getTime() + 86400000
    return C.totals(segs, end)
  }

  if (!perWeek) {
    for (let back = days - 1; back >= 0; back--) {
      const t = dayTotals(back)
      out.push({ totals: t || {}, has: !!t, cap: 86400 })
    }
    return out
  }
  for (let w = Math.ceil(days / 7) - 1; w >= 0; w--) {
    const totals = {}
    let has = false
    for (let i = 0; i < 7; i++) {
      const back = w * 7 + i
      if (back >= days) continue
      const t = dayTotals(back)
      if (!t) continue
      has = true
      for (const k in t) totals[k] = (totals[k] || 0) + t[k]
    }
    out.push({ totals, has, cap: 7 * 86400 })
  }
  return out
}

// ---------------------------------------------------------------- 页面 B：单事项

async function showActivity(a, span) {
  const table = new UITable()
  table.showSeparators = false
  const now = Date.now()
  const days = span || 7

  const bs = buckets(days)
  const totalSpan = bs.reduce((s, b) => s + (b.totals[a.id] || 0), 0)
  const withAny = bs.filter(b => (b.totals[a.id] || 0) > 0).length
  const label = days > 31 ? `近 ${days} 天（按周）` : `近 ${days} 天`

  addHeader(table, `${a.name} · ${label}`)
  const bars = new UITableRow()
  bars.height = 120
  bars.addImage(barChart(bs, a, 300, 110)).centerAligned()
  table.addRow(bars)

  stat(table, "总计", C.hhmm(totalSpan))
  stat(table, days > 31 ? "有记录的周平均" : "有记录的天平均",
       withAny ? C.hhmm(totalSpan / withAny) : "—")
  stat(table, days > 31 ? "出现过的周" : "出现过的天", `${withAny} / ${bs.length}`)

  // 最长的一次：想知道自己到底能连着做多久
  let longest = null
  for (let back = days - 1; back >= 0; back--) {
    const key = C.dayKey(new Date(Date.now() - back * 86400000))
    for (const s of (data.days[key] || [])) {
      if (s.a !== a.id) continue
      const d = C.duration(s, now)
      if (!longest || d > longest.d) longest = { d, s, key }
    }
  }
  if (longest) {
    stat(table, "最长的一次",
         `${C.hhmm(longest.d)} · ${longest.key.slice(5)} ${C.clock(longest.s.s)}`)
  }

  const today = C.segments(data).filter(s => s.a === a.id)
  addHeader(table, "今天的时段（点一段可以拆开）")
  if (!today.length) addNote(table, "今天还没有")
  for (const s of today) {
    const r = new UITableRow()
    r.dismissOnSelect = false
    const c = r.addText(`${C.clock(s.s)} – ${s.e != null ? C.clock(s.e) : "现在"}`)
    c.titleColor = new Color(a.hex)
    c.titleFont = Font.systemFont(15)
    c.widthWeight = 60
    const d = r.addText(C.hhmm(C.duration(s, now)))
    d.rightAligned(); d.widthWeight = 40
    d.titleColor = INK(0.5)
    r.onSelect = async () => { await splitFlow(s); await showActivity(a, days) }
    table.addRow(r)
  }

  await table.present(true)
}

function stat(table, label, value) {
  const r = new UITableRow()
  r.dismissOnSelect = false
  const c = r.addText(label)
  c.titleColor = INK(0.45); c.titleFont = Font.systemFont(14); c.widthWeight = 45
  const d = r.addText(value)
  d.rightAligned(); d.widthWeight = 55
  d.titleColor = INK(); d.titleFont = Font.systemFont(15)
  table.addRow(r)
}

// ---------------------------------------------------------------- 拆分

async function splitFlow(seg) {
  const key = C.dayKey(new Date(seg.s * 1000))
  const end = seg.e != null ? seg.e : Math.floor(Date.now() / 1000)

  const ask = new Alert()
  ask.title = "从几点起换的？"
  ask.message = `这一段是 ${C.clock(seg.s)} – ${seg.e != null ? C.clock(seg.e) : "现在"}`
  ask.addTextField("时间，比如 23:30", C.clock(Math.floor((seg.s + end) / 2)))
  ask.addAction("下一步"); ask.addCancelAction("取消")
  if (await ask.present() < 0) return

  const raw = ask.textFieldValue(0).trim()
  const m = raw.match(/^(\d{1,2})[:：](\d{2})$/)
  if (!m) return await toast("时间要写成 23:30 这样")

  const base = new Date(seg.s * 1000)
  base.setHours(Number(m[1]), Number(m[2]), 0, 0)
  let when = base.getTime()
  // 跨零点的段：如果算出来比起点还早，就往后挪一天
  if (Math.floor(when / 1000) <= seg.s) when += 86400000
  if (Math.floor(when / 1000) >= end) return await toast("这个时间不在这一段里")

  const pick = new Alert()
  pick.title = "后半段是什么？"
  for (const a of data.activities) pick.addAction(a.name)
  pick.addCancelAction("取消")
  const i = await pick.present()
  if (i < 0) return

  data = C.splitSegment(data, key, seg.id, when, data.activities[i].id)
  C.save(data)
}

// ---------------------------------------------------------------- 状态管理

async function manageActivities() {
  const t = new UITable()
  for (const a of data.activities) {
    const r = new UITableRow()
    r.dismissOnSelect = false
    const c = r.addText(a.name); c.titleColor = new Color(a.hex)
    r.onSelect = async () => {
      const al = new Alert()
      al.title = a.name
      al.addTextField("名字", a.name)
      al.addAction("改名"); al.addDestructiveAction("删掉"); al.addCancelAction("取消")
      const k = await al.present()
      if (k === 0) { a.name = al.textFieldValue(0) || a.name; C.save(data) }
      if (k === 1) {
        data.activities = data.activities.filter(x => x.id !== a.id)
        C.save(data)
      }
      await manageActivities()
    }
    t.addRow(r)
  }
  const add = new UITableRow()
  add.dismissOnSelect = false
  add.addText("＋ 加一个").titleColor = new Color("#7DD73C")
  add.onSelect = async () => {
    const al = new Alert()
    al.title = "新状态"
    al.addTextField("比如「实习」", "")
    al.addAction("加上"); al.addCancelAction("取消")
    if (await al.present() < 0) return
    const name = al.textFieldValue(0).trim()
    if (!name) return
    const palette = C.DEFAULT_ACTIVITIES.map(a => a.hex)
    data.activities.push({
      id: "c" + Math.random().toString(36).slice(2, 8),
      name,
      hex: palette[data.activities.length % palette.length]
    })
    C.save(data)
    await manageActivities()
  }
  t.addRow(add)
  await t.present(true)
}

// ---------------------------------------------------------------- 提醒

function nudgeMinutes() { return data.nudgeMinutes || 90 }

async function setNudge() {
  const a = new Alert()
  a.title = "隔多久问一次？"
  a.message = "超过这个时长没换状态，就推一条通知，通知上直接能改。"
  for (const m of [45, 60, 90, 120, 180]) a.addAction(`${m} 分钟`)
  a.addDestructiveAction("关掉提醒")
  a.addCancelAction("取消")
  const i = await a.present()
  if (i < 0) return
  data.nudgeMinutes = i === 5 ? 0 : [45, 60, 90, 120, 180][i]
  C.save(data)
  scheduleNudge()
}

function scheduleNudge() {
  Notification.allPending().then(list => {
    for (const n of list) if (n.identifier.startsWith("myladay")) n.remove()
    const mins = nudgeMinutes()
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

// ---------------------------------------------------------------- 小图表

function barChart(bs, activity, w, h) {
  const ctx = new DrawContext()
  ctx.size = new Size(w, h); ctx.opaque = false; ctx.respectScreenScale = true
  const n = Math.max(1, bs.length)
  const gap = n > 20 ? 1 : n > 10 ? 2 : 5
  const bw = (w - gap * (n - 1)) / n
  // 满格 = 一天 8 小时（按周的桶就是一周 8 小时 × 7）
  const full = bs.length && bs[0].cap > 86400 ? 8 * 3600 * 7 : 8 * 3600
  bs.forEach((b, i) => {
    const secs = b.totals[activity.id] || 0
    const bh = Math.max(2, (h - 4) * Math.min(1, secs / full))
    ctx.setFillColor(secs > 0 ? new Color(activity.hex) : new Color("#8A8A90", 0.18))
    ctx.fillRect(new Rect(i * (bw + gap), h - bh, bw, bh))
  })
  return ctx.getImage()
}

function stackChart(bs, w, h) {
  const ctx = new DrawContext()
  ctx.size = new Size(w, h); ctx.opaque = false; ctx.respectScreenScale = true
  const n = Math.max(1, bs.length)
  const gap = n > 20 ? 1 : n > 10 ? 2 : 6
  const bw = (w - gap * (n - 1)) / n
  bs.forEach((b, i) => {
    if (!b.has) {
      // 没记录的那天留个浅底，不然看起来像那天不存在
      ctx.setFillColor(new Color("#8A8A90", 0.2))
      ctx.fillRect(new Rect(i * (bw + gap), h - 3, bw, 3))
      return
    }
    let y = h
    for (const a of data.activities) {
      const secs = b.totals[a.id] || 0
      if (!secs) continue
      const bh = (h - 2) * (secs / b.cap)
      y -= bh
      ctx.setFillColor(new Color(a.hex))
      ctx.fillRect(new Rect(i * (bw + gap), y, bw, bh))
    }
  })
  return ctx.getImage()
}

// ---------------------------------------------------------------- 小工具

function addHeader(table, text) {
  const r = new UITableRow()
  r.isHeader = true
  const c = r.addText(text)
  c.titleColor = INK(0.55)
  c.titleFont = Font.semiboldSystemFont(13)
  table.addRow(r)
}

function addNote(table, text) {
  const r = new UITableRow()
  r.dismissOnSelect = false
  const c = r.addText(text)
  c.titleColor = INK(0.4)
  c.titleFont = Font.systemFont(12)
  c.centerAligned()
  table.addRow(r)
}

function addAction(table, text, fn) {
  const r = new UITableRow()
  r.dismissOnSelect = false
  r.addText(text).titleFont = Font.systemFont(16)
  r.onSelect = fn
  table.addRow(r)
}

function warn(table, text, hex) {
  const r = new UITableRow()
  r.dismissOnSelect = false
  const c = r.addText(text)
  c.titleColor = new Color(hex)
  c.titleFont = Font.systemFont(13)
  table.addRow(r)
}

async function toast(msg) {
  const a = new Alert(); a.title = msg; a.addAction("好"); await a.present()
}
