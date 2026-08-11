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

// ---------------------------------------------------------------- 界面

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
    const r = new UITableRow()
    const c = r.addText("⚠️ 数据文件读不出来，已从零开始。坏掉的那份留在 myladay.corrupt-*.json")
    c.titleColor = new Color("#F2363C"); c.titleFont = Font.systemFont(13)
    table.addRow(r)
  } else if (data.recoveredFromBackup) {
    const r = new UITableRow()
    const c = r.addText("⚠️ 主文件损坏，已用备份恢复，可能少了最后一次改动")
    c.titleColor = new Color("#F99243"); c.titleFont = Font.systemFont(13)
    table.addRow(r)
  }

  const acc = Object.values(t).reduce((a, b) => a + b, 0)
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

  addHeader(table, "今天都花在哪了（点开看时段）")
  const ranked = data.activities
    .filter(a => (t[a.id] || 0) >= 60)
    .sort((x, y) => (t[y.id] || 0) - (t[x.id] || 0))
  if (!ranked.length) addNote(table, "还没有记录")
  for (const a of ranked) {
    const r = new UITableRow()
    r.dismissOnSelect = false
    const dot = r.addText("●"); dot.titleColor = new Color(a.hex); dot.widthWeight = 10
    const c = r.addText(a.name); c.titleColor = INK(); c.widthWeight = 50
    const d = r.addText(C.hhmm(t[a.id])); d.rightAligned(); d.widthWeight = 40
    d.titleColor = INK(0.5)
    r.onSelect = async () => { await showActivity(a); await refresh(table); table.reload() }
    table.addRow(r)
  }

  addHeader(table, "别的")
  addAction(table, "本周 / 本月总结", async () => { await showSpan() })
  addAction(table, "管理状态", async () => { await manageActivities(); await refresh(table); table.reload() })
  addAction(table, `提醒：每 ${nudgeMinutes()} 分钟问一次`, async () => {
    await setNudge(); await refresh(table); table.reload()
  })
  addNote(table, "版本 " + C.VERSION)
  addAction(table, "导出一份备份", async () => {
    // 存到「文件」里，换手机或者我改坏了都能拿回来
    try { await DocumentPicker.exportFile(C.DATA) }
    catch (e) { await toast("导出取消了") }
  })
}

// ---------------------------------------------------------------- 单个状态

async function showActivity(a) {
  const table = new UITable()
  table.showSeparators = false
  const now = Date.now()

  const today = C.segments(data).filter(s => s.a === a.id)
  addHeader(table, `${a.name} · 今天`)
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
    // 点某一段可以直接拆开它
    r.onSelect = async () => { await splitFlow(s); await showActivity(a) }
    table.addRow(r)
  }

  for (const [label, days] of [["近 7 天", 7], ["近 30 天", 30]]) {
    const slices = spanSlices(days)
    const total = slices.reduce((sum, s) => sum + (s.totals[a.id] || 0), 0)
    const withAny = slices.filter(s => (s.totals[a.id] || 0) > 0).length
    addHeader(table, label)
    addNote(table, `总计 ${C.hhmm(total)}`)
    addNote(table, withAny ? `有记录的 ${withAny} 天里平均 ${C.hhmm(total / withAny)}` : "没有记录")
    const bars = new UITableRow()
    bars.height = 110
    bars.addImage(barChart(slices, a, 300, 100)).centerAligned()
    table.addRow(bars)
  }

  await table.present(true)
}

// ---------------------------------------------------------------- 周月总结

async function showSpan() {
  const table = new UITable()
  table.showSeparators = false
  for (const [label, days] of [["本周（近 7 天）", 7], ["本月（近 30 天）", 30]]) {
    const slices = spanSlices(days)
    const agg = {}
    for (const s of slices) for (const k in s.totals) agg[k] = (agg[k] || 0) + s.totals[k]

    addHeader(table, label)
    const chart = new UITableRow()
    chart.height = 150
    chart.addImage(stackChart(slices, 300, 140)).centerAligned()
    table.addRow(chart)
    addNote(table, `有记录 ${slices.length} 天`)

    const ranked = data.activities
      .filter(a => (agg[a.id] || 0) >= 60)
      .sort((x, y) => agg[y.id] - agg[x.id])
    for (const a of ranked) {
      const r = new UITableRow()
      r.dismissOnSelect = false
      const c = r.addText(a.name); c.titleColor = new Color(a.hex); c.widthWeight = 60
      const d = r.addText(C.hhmm(agg[a.id])); d.rightAligned(); d.widthWeight = 40
      d.titleColor = INK(0.5)
      table.addRow(r)
    }
  }
  await table.present(true)
}

function spanSlices(days) {
  const out = []
  for (let back = days - 1; back >= 0; back--) {
    const d = new Date(Date.now() - back * 86400000)
    const key = C.dayKey(d)
    const segs = data.days[key]
    if (!segs || !segs.length) continue
    const end = back === 0 ? Date.now()
      : C.startOfDay(d).getTime() + 86400000
    out.push({ key, totals: C.totals(segs, end) })
  }
  return out
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

function barChart(slices, activity, w, h) {
  const ctx = new DrawContext()
  ctx.size = new Size(w, h); ctx.opaque = false; ctx.respectScreenScale = true
  const n = Math.max(1, slices.length)
  const gap = n > 10 ? 2 : 5
  const bw = (w - gap * (n - 1)) / n
  slices.forEach((s, i) => {
    const secs = s.totals[activity.id] || 0
    const frac = Math.min(1, secs / (8 * 3600))
    const bh = Math.max(2, (h - 4) * frac)
    ctx.setFillColor(new Color(secs > 0 ? activity.hex : "#F6F1EC", secs > 0 ? 1 : 0.08))
    ctx.fillRect(new Rect(i * (bw + gap), h - bh, bw, bh))
  })
  return ctx.getImage()
}

function stackChart(slices, w, h) {
  const ctx = new DrawContext()
  ctx.size = new Size(w, h); ctx.opaque = false; ctx.respectScreenScale = true
  const n = Math.max(1, slices.length)
  const gap = n > 10 ? 2 : 6
  const bw = (w - gap * (n - 1)) / n
  slices.forEach((s, i) => {
    let y = h
    for (const a of data.activities) {
      const secs = s.totals[a.id] || 0
      if (!secs) continue
      const bh = (h - 2) * (secs / 86400)
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

async function toast(msg) {
  const a = new Alert(); a.title = msg; a.addAction("好"); await a.present()
}
