// Myla 的一天 — 主脚本（控制器）
//
// 三种进入方式：
//   直接运行 / 主屏幕图标        → 打开界面
//   快捷指令自动化传参          → 切状态后立刻退出（到达某地时用）
//   通知按钮 / URL scheme       → 同上
//     scriptable:///run?scriptName=MylaDay&switchTo=study
//
// 界面在 WebView 里（MylaDayHTML.js），这个文件只管数据和消息循环：
// 页面点一下 → 这里改数据存盘 → 重新 render。所有图还是 MylaDayCore 用
// DrawContext 画的，转成 base64 传过去，绘制代码不分叉。

const C = importModule("MylaDayCore")
const V = importModule("MylaDayHTML")

const SPANS = [["周", 7], ["月", 30], ["3个月", 90]]
const CHARTS = [["柱状", "bar"], ["圆盘", "dial"]]
const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]

// ---------------------------------------------------------------- 入口

let data = C.rollover(C.load())

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
  await runApp()
}
Script.complete()

// ---------------------------------------------------------------- 消息循环

async function runApp() {
  const wv = new WebView()
  await wv.loadHTML(V.HTML)

  // present() 的 promise 在用户关掉时兑现。跟「等页面消息」一起 race，
  // 不然关掉之后这边会一直挂着等一条永远不来的消息。
  const closed = wv.present(true).then(() => ({ t: "__closed" }))

  const ui = { tab: "today", span: data.ui.span, chart: data.ui.chart, sheet: null, pending: null }
  await draw(wv, ui)

  while (true) {
    const raw = await Promise.race([
      closed,
      wv.evaluateJavaScript("window.__wait(completion)", true)
    ])
    const msg = typeof raw === "string" ? JSON.parse(raw) : raw
    if (!msg || msg.t === "__closed") break
    await handle(msg, ui)
    await draw(wv, ui)
  }

  data.ui.span = ui.span
  data.ui.chart = ui.chart
  C.save(data)
}

async function draw(wv, ui) {
  const p = payload(ui)
  // U+2028/2029 在 JS 源码里是换行符，JSON.stringify 不转义它们
  const json = JSON.stringify(p).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")
  await wv.evaluateJavaScript("window.render(" + json + ")")
}

// ---------------------------------------------------------------- 事件

async function handle(m, ui) {
  const key = C.dayKey()
  const todos = data.todos[key] || (data.todos[key] = [])

  switch (m.t) {
    case "tab": ui.tab = m.v; ui.sheet = null; return
    case "close": ui.sheet = null; ui.pending = null; return

    case "switch":
      data = C.switchTo(data, m.v)
      C.save(data)
      scheduleNudge()
      return

    case "span": ui.span = m.v; data.ui.span = m.v; C.save(data); return
    case "chart": ui.chart = m.v; data.ui.chart = m.v; C.save(data); return

    // ---- 清单
    case "todo.add":
      if (m.v) { todos.push({ id: uid(), text: m.v, done: false }); C.save(data) }
      return
    case "todo.toggle": {
      const it = todos.find(x => x.id === m.v)
      if (it) { it.done = !it.done; it.doneAt = it.done ? Date.now() : null; C.save(data) }
      return
    }
    case "todo.edit": {
      const it = todos.find(x => x.id === m.v)
      if (it) ui.sheet = { kind: "input", title: "改这一条", value: it.text,
                           submit: "todo.save", value2: it.id, destructive: "todo.del" }
      return
    }
    case "todo.save": {
      const it = todos.find(x => x.id === m.v2)
      if (it && m.v) it.text = m.v
      C.save(data); ui.sheet = null
      return
    }
    case "todo.del":
      data.todos[key] = todos.filter(x => x.id !== m.v)
      C.save(data); ui.sheet = null
      return
    case "todo.carry": {
      const yk = C.dayKey(new Date(Date.now() - 86400000))
      for (const x of (data.todos[yk] || []).filter(y => !y.done)) {
        todos.push({ id: uid(), text: x.text, done: false })
      }
      C.save(data)
      return
    }

    // ---- 单项详情
    case "detail": ui.sheet = detailSheet(m.v, ui.span); return

    // ---- 拆分忘了切的时段
    case "split": {
      const open = C.openSegment(C.segments(data))
      if (open) ui.sheet = splitAsk(open)
      return
    }
    case "split.seg": {
      const seg = C.segments(data).find(s => s.id === m.v)
      if (seg) ui.sheet = splitAsk(seg)
      return
    }
    case "split.time": {
      const seg = C.segments(data).find(s => s.id === m.v2)
      if (!seg) { ui.sheet = null; return }
      const t = parseClock(m.v, seg)
      if (t == null) { ui.sheet = splitAsk(seg, "时间要写成 23:30 这样，而且得落在这一段里面"); return }
      ui.pending = { segID: seg.id, when: t }
      ui.sheet = { kind: "list", title: "后半段是什么？", act: "split.pick",
                   items: data.activities.map(a => ({ label: a.name, v: a.id, hex: a.hex })) }
      return
    }
    case "split.pick":
      if (ui.pending) {
        data = C.splitSegment(data, key, ui.pending.segID, ui.pending.when, m.v)
        C.save(data)
      }
      ui.pending = null; ui.sheet = null
      return

    // ---- 别的
    case "manage":
      ui.sheet = { kind: "list", title: "管理状态", act: "manage.pick",
                   items: data.activities.map(a => ({ label: a.name, v: a.id, hex: a.hex }))
                     .concat([{ label: "＋ 加一个", v: "__new", hex: "#7DD73C" }]) }
      return
    case "manage.pick":
      ui.sheet = m.v === "__new"
        ? { kind: "input", title: "新状态", placeholder: "比如「实习」", submit: "manage.new" }
        : { kind: "input", title: "改名字", value: C.activityOf(data, m.v).name,
            submit: "manage.rename", value2: m.v, destructive: "manage.del" }
      return
    case "manage.new":
      if (m.v) {
        const pal = C.DEFAULT_ACTIVITIES.map(a => a.hex)
        data.activities.push({ id: "c" + uid().slice(0, 6), name: m.v,
                               hex: pal[data.activities.length % pal.length] })
        C.save(data)
      }
      ui.sheet = null
      return
    case "manage.rename": {
      const a = data.activities.find(x => x.id === m.v2)
      if (a && m.v) a.name = m.v
      C.save(data); ui.sheet = null
      return
    }
    case "manage.del":
      // 只从「能选的状态」里拿掉，已经记下的时段不动——删个标签不该抹掉历史
      data.activities = data.activities.filter(x => x.id !== m.v)
      C.save(data); ui.sheet = null
      return

    case "nudge":
      ui.sheet = { kind: "list", title: "隔多久问一次？", act: "nudge.pick",
                   items: [45, 60, 90, 120, 180].map(n => ({ label: n + " 分钟", v: n }))
                     .concat([{ label: "关掉提醒", v: 0, hex: "#F2363C" }]) }
      return
    case "nudge.pick":
      data.nudgeMinutes = m.v
      C.save(data); scheduleNudge(); ui.sheet = null
      return

    case "export":
      ui.sheet = null
      try { await DocumentPicker.exportFile(C.DATA) } catch (e) { /* 取消了 */ }
      return
  }
}

function uid() { return Math.random().toString(36).slice(2, 10) }

function parseClock(raw, seg) {
  const m = (raw || "").trim().match(/^(\d{1,2})[:：](\d{2})$/)
  if (!m) return null
  const end = seg.e != null ? seg.e : Math.floor(Date.now() / 1000)
  const base = new Date(seg.s * 1000)
  base.setHours(Number(m[1]), Number(m[2]), 0, 0)
  let when = base.getTime()
  // 跨零点的段：算出来比起点还早就往后挪一天
  if (Math.floor(when / 1000) <= seg.s) when += 86400000
  if (Math.floor(when / 1000) >= end) return null
  return when
}

function splitAsk(seg, err) {
  const end = seg.e != null ? seg.e : Math.floor(Date.now() / 1000)
  return {
    kind: "input",
    title: err || `${C.clock(seg.s)} – ${seg.e != null ? C.clock(seg.e) : "现在"}，从几点起换的？`,
    placeholder: "比如 23:30",
    value: C.clock(Math.floor((seg.s + end) / 2)),
    submit: "split.time", value2: seg.id, ok: "下一步"
  }
}

// ---------------------------------------------------------------- payload

function png(img) { return "data:image/png;base64," + Data.fromPNG(img).toBase64String() }

function payload(ui) {
  const now = Date.now()
  const d = new Date()
  const p = {
    tab: ui.tab, version: C.VERSION, sheet: ui.sheet,
    sub: `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`,
    warn: data.loadFailed
      ? { text: "数据文件读不出来，已从零开始。坏掉的那份留在 myladay.corrupt-*.json", hex: "#F2363C" }
      : data.recoveredFromBackup
        ? { text: "主文件损坏，已用备份恢复，可能少了最后一次改动", hex: "#F99243" }
        : null
  }

  if (ui.tab === "today") {
    const segs = C.segments(data)
    const open = C.openSegment(segs)
    const t = C.totals(segs, now)
    const acc = Object.keys(t).reduce((s, k) => s + t[k], 0)

    p.dial = png(C.drawDial(data, segs, 300, { now }))
    p.acc = data.lastAuto && now - data.lastAuto.at < 3600000
      ? `今天已记录 ${C.hhmm(acc)} · 刚才${data.lastAuto.why}`
      : `今天已记录 ${C.hhmm(acc)}`
    if (open) {
      const a = C.activityOf(data, open.a)
      p.now = { name: a.name, hex: a.hex, len: C.hhmm(C.duration(open, now)) }
      // 睡着了没人能替你点，长得离谱的一段主动问一句
      if (C.duration(open, now) > 4 * 3600) {
        p.split = `这一段已经 ${C.hhmm(C.duration(open, now))}，中间换过吗？`
      }
    }
    p.acts = data.activities.map(a => ({
      id: a.id, name: a.name, hex: a.hex,
      on: !!(open && open.a === a.id),
      len: t[a.id] ? C.hhmm(t[a.id]) : ""
    }))

    const list = data.todos[C.dayKey()] || []
    const left = list.filter(x => !x.done).length
    p.todoTitle = left ? `今天要做的 · 还剩 ${left} 条` : "今天要做的"
    // 做完的沉到底下，不消失——一天结束时能看见自己干了什么
    p.todos = list.slice().sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0))
      .map(x => ({ id: x.id, text: x.text, done: !!x.done,
                   at: x.done && x.doneAt ? C.clock(Math.floor(x.doneAt / 1000)) : "" }))
    const yk = C.dayKey(new Date(now - 86400000))
    p.carry = (data.todos[yk] || []).filter(x => !x.done).length
  }

  if (ui.tab === "stats") {
    const bs = buckets(ui.span)
    const agg = {}
    for (const b of bs) for (const k in b.totals) agg[k] = (agg[k] || 0) + b.totals[k]
    const total = Object.keys(agg).reduce((s, k) => s + agg[k], 0)
    let recorded = 0
    for (let back = 0; back < ui.span; back++) {
      if ((data.days[C.dayKey(new Date(now - back * 86400000))] || []).length) recorded++
    }

    p.spans = SPANS; p.charts = CHARTS; p.span = ui.span; p.chart = ui.chart
    p.chartImg = ui.chart === "dial"
      ? png(C.drawDonut(data, agg, 300, { sub: `有记录 ${recorded} 天` }))
      : png(stackChart(bs, 320, 150))
    if (ui.chart === "dial") {
      const from = new Date(now - (ui.span - 1) * 86400000)
      p.note = `${from.getMonth() + 1}月${from.getDate()}日 – ${d.getMonth() + 1}月${d.getDate()}日`
    } else {
      p.note = ui.span > 31
        ? `一根柱子是一周，${ui.span} 天里有记录的 ${recorded} 天`
        : `一根柱子是一天，${ui.span} 天里有记录的 ${recorded} 天`
    }
    p.rows = data.activities
      .filter(a => (agg[a.id] || 0) >= 60)
      .sort((x, y) => agg[y.id] - agg[x.id])
      .map(a => ({ id: a.id, name: a.name, hex: a.hex,
                   pct: total ? Math.round(agg[a.id] / total * 100) + "%" : "",
                   len: C.hhmm(agg[a.id]) }))
  }

  if (ui.tab === "more") {
    p.links = [
      { t: "manage", label: "管理状态", hint: data.activities.length + " 个" },
      { t: "nudge",  label: "定时问一句", hint: data.nudgeMinutes === 0 ? "关着" : (data.nudgeMinutes || 90) + " 分钟" },
      { t: "export", label: "导出一份备份", hint: "存到「文件」" }
    ]
  }

  return p
}

function detailSheet(id, span) {
  const a = C.activityOf(data, id)
  const now = Date.now()
  const bs = buckets(span)
  const total = bs.reduce((s, b) => s + (b.totals[id] || 0), 0)
  const withAny = bs.filter(b => (b.totals[id] || 0) > 0).length
  const weekly = span > 31

  // 最长的一次：想知道自己到底能连着做多久
  let longest = null
  for (let back = span - 1; back >= 0; back--) {
    const key = C.dayKey(new Date(now - back * 86400000))
    for (const s of (data.days[key] || [])) {
      if (s.a !== id) continue
      const len = C.duration(s, now)
      if (!longest || len > longest.len) longest = { len, s, key }
    }
  }

  const stats = [
    ["总计", C.hhmm(total)],
    [weekly ? "有记录的周平均" : "有记录的天平均", withAny ? C.hhmm(total / withAny) : "—"],
    [weekly ? "出现过的周" : "出现过的天", `${withAny} / ${bs.length}`]
  ]
  if (longest) {
    stats.push(["最长的一次",
      `${C.hhmm(longest.len)} · ${longest.key.slice(5)} ${C.clock(longest.s.s)}`])
  }

  return {
    kind: "detail", title: a.name, hex: a.hex,
    img: png(barChart(bs, a, 320, 110)),
    note: weekly ? `近 ${span} 天，一根柱子是一周` : `近 ${span} 天，一根柱子是一天`,
    stats,
    spans: C.segments(data).filter(s => s.a === id).map(s => ({
      id: s.id,
      when: `${C.clock(s.s)} – ${s.e != null ? C.clock(s.e) : "现在"}`,
      len: C.hhmm(C.duration(s, now))
    }))
  }
}

/**
 * 把最近 N 天切成柱子。30 天以内一天一根，再长就一周一根——
 * 90 根柱子每根两像素，看不出任何东西。
 */
function buckets(days) {
  const out = []
  const dayTotals = back => {
    const d = new Date(Date.now() - back * 86400000)
    const segs = data.days[C.dayKey(d)]
    if (!segs || !segs.length) return null
    const end = back === 0 ? Date.now() : C.startOfDay(d).getTime() + 86400000
    return C.totals(segs, end)
  }

  if (days <= 31) {
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
