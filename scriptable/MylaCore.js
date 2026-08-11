// Myla 的一天 — 共用核心：数据读写 + 圆盘绘制 + Clawd
//
// 两个脚本（主脚本和小组件）都 importModule 这一个文件，所以圆盘只有一份实现，
// 不会两边画得不一样。
//
// Scriptable 的 Path 没有 addArc，所有弧线都用多边形逼近；步数按弧长给，
// 肉眼看不出折线。

const fm = FileManager.local()
const VERSION = "20260812-0234"
const SCHEMA = 1
const DATA = fm.joinPath(fm.documentsDirectory(), "myladay.json")
const BAK  = fm.joinPath(fm.documentsDirectory(), "myladay.backup.json")
const TMP  = fm.joinPath(fm.documentsDirectory(), "myladay.writing.json")

// ---------------------------------------------------------------- 数据

const DEFAULT_ACTIVITIES = [
  { id: "sleep",    name: "睡觉",  hex: "#476BE1" },
  { id: "class",    name: "上课",  hex: "#B05AE2" },
  { id: "study",    name: "学习",  hex: "#F99243" },
  { id: "research", name: "科研",  hex: "#3AD9AA" },
  { id: "eat",      name: "吃饭",  hex: "#FAD338" },
  { id: "commute",  name: "通勤",  hex: "#40BBE7" },
  { id: "sport",    name: "运动",  hex: "#7DD73C" },
  { id: "rest",     name: "休息",  hex: "#F566AD" },
  { id: "phone",    name: "刷手机", hex: "#F2363C" },
  { id: "other",    name: "其他",  hex: "#C4A582" }
]

/**
 * 读数据。**每一条出口都必须过 migrate**——「第一次用」和「文件读坏了」这两条路
 * 原来是直接 return 一个字面量的，于是 todos / ui / countdowns / autoGrace 这些
 * 后加的字段全是缺的，页面一取就 TypeError。加字段时最容易漏的就是这里。
 */
function load() {
  if (!fm.fileExists(DATA)) {
    // 主文件没了但备份还在（比如上次写到一半崩了）——用备份恢复
    if (fm.fileExists(BAK)) {
      try {
        const b = JSON.parse(fm.readString(BAK))
        b.recoveredFromBackup = true
        return migrate(b)
      } catch (e) { /* 备份也坏了，下面走空档 */ }
    }
    return migrate({})
  }
  try {
    return migrate(JSON.parse(fm.readString(DATA)))
  } catch (e) {
    // 绝不静默丢弃：把坏文件留档，再试备份
    const stamp = String(Math.floor(Date.now() / 1000))
    try { fm.move(DATA, fm.joinPath(fm.documentsDirectory(), "myladay.corrupt-" + stamp + ".json")) }
    catch (e2) { /* 移不动就算了，至少不覆写 */ }
    if (fm.fileExists(BAK)) {
      try {
        const b = JSON.parse(fm.readString(BAK))
        b.recoveredFromBackup = true
        return migrate(b)
      } catch (e3) { /* 都坏了 */ }
    }
    return migrate({ loadFailed: true })
  }
}

/** 老版本的数据结构在这里补齐，别让升级把字段搞丢。 */
function migrate(d) {
  if (!d || typeof d !== "object") d = {}
  if (!d.activities || !d.activities.length) d.activities = DEFAULT_ACTIVITIES
  if (!d.days) d.days = {}
  if (!d.todos) d.todos = {}          // { "2026-08-11": [{id, text, done, doneAt}] }
  if (!d.countdowns) d.countdowns = [] // [{id, name, date:"2026-12-25", yearly, hex}]
  if (d.autoGrace === undefined) d.autoGrace = 30
  if (!d.applied) d.applied = {}      // { 会话号: 已执行到第几条 }，跨会话去重用   // 自动切换多久内不许覆盖手动的；0=不保护，-1=完全拒绝
  if (!d.ui) d.ui = { span: 7, chart: "bar" }
  d.v = SCHEMA
  return d
}

/**
 * 先写临时文件、读回来核对、把现有的存成备份，最后才替换正式文件。
 * 中途任何一步崩掉，正式文件都还是上一份完整的。
 */
function save(d) {
  const text = JSON.stringify(d)
  fm.writeString(TMP, text)
  if (fm.readString(TMP).length !== text.length) return false   // 没写全就别动正式文件
  if (fm.fileExists(DATA)) {
    if (fm.fileExists(BAK)) fm.remove(BAK)
    fm.copy(DATA, BAK)
  }
  if (fm.fileExists(DATA)) fm.remove(DATA)
  fm.move(TMP, DATA)
  return true
}

function dayKey(date) {
  const d = date || new Date()
  const p = n => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function startOfDay(date) {
  const d = new Date(date || Date.now())
  d.setHours(0, 0, 0, 0)
  return d
}

function segments(data, key) { return data.days[key || dayKey()] || [] }

function openSegment(segs) {
  for (let i = segs.length - 1; i >= 0; i--) if (segs[i].e == null) return segs[i]
  return null
}

/** 跨零点：昨天还开着的那段在午夜切断，今天用同一个状态接上。 */
function rollover(data) {
  const today = dayKey()
  if ((data.days[today] || []).length) return data

  const y = new Date(Date.now() - 86400000)
  const yk = dayKey(y)
  const prev = data.days[yk] || []
  const open = openSegment(prev)
  if (!open) return data

  const midnight = Math.floor(startOfDay().getTime() / 1000)
  open.e = midnight
  data.days[today] = [{ id: uid(), a: open.a, s: midnight, e: null }]
  return data
}

/** 切状态：关掉当前那段，从这一刻开新的。24 小时不留空档。
 *  by: "me" 手动点的 / "auto" 自动化或通知按钮切的。记下来是为了让自动的不许压手动的。 */
function switchTo(data, activityID, when, by) {
  const t = Math.floor((when || Date.now()) / 1000)
  rollover(data)
  const key = dayKey(new Date(t * 1000))
  const segs = data.days[key] || (data.days[key] = [])
  const open = openSegment(segs)
  if (open) {
    if (open.a === activityID) return data      // 已经在这个状态了
    open.e = t
  }
  segs.push({ id: uid(), a: activityID, s: t, e: null, by: by || "me" })
  return data
}

/**
 * 自动切换（快捷指令到达某地、通知按钮）。手动优先：你刚亲手设的状态，
 * 自动化在保护期内不许改掉。
 *
 * 地理围栏会反复触发（进出边界抖一下就是一次），原来没有这个保护，
 * 于是「手动设成学习 → 围栏触发休息 → 学习那段被截断」，一天下来全是休息。
 */
function autoSwitch(data, activityID, when, graceMin) {
  const t = Math.floor((when || Date.now()) / 1000)
  const grace = graceMin === undefined ? (data.autoGrace === undefined ? 30 : data.autoGrace) : graceMin
  if (grace < 0) return { ok: false, why: "你把自动切换关掉了" }

  const open = openSegment(segments(data, dayKey(new Date(t * 1000))))
  if (open && open.a === activityID) return { ok: false, why: "已经是这个状态了" }
  if (open && open.by !== "auto" && grace > 0 && (t - open.s) < grace * 60) {
    const mins = Math.max(1, Math.round((t - open.s) / 60))
    return { ok: false, why: `你 ${mins} 分钟前刚手动设成「${activityOf(data, open.a).name}」，没动它` }
  }
  switchTo(data, activityID, when, "auto")
  return { ok: true }
}

/** 把一段从 when 切两半，后半段换成别的状态。用来修忘了切的时段。 */
function splitSegment(data, key, segID, when, laterID) {
  const segs = data.days[key] || []
  const i = segs.findIndex(s => s.id === segID)
  if (i < 0) return data
  const t = Math.floor(when / 1000)
  const old = segs[i]
  if (t <= old.s || (old.e != null && t >= old.e)) return data
  const tail = { id: uid(), a: laterID, s: t, e: old.e }
  segs[i].e = t
  segs.splice(i + 1, 0, tail)
  return data
}

function duration(seg, now) {
  const end = seg.e != null ? seg.e : Math.floor((now || Date.now()) / 1000)
  return Math.max(0, end - seg.s)
}

function totals(segs, now) {
  const out = {}
  for (const s of segs) out[s.a] = (out[s.a] || 0) + duration(s, now)
  return out
}

function uid() { return Math.random().toString(36).slice(2, 10) }

function hhmm(secs) {
  const m = Math.round(secs / 60)
  return m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分` : `${m} 分钟`
}

function clock(epochSecs) {
  const d = new Date(epochSecs * 1000)
  const p = n => String(n).padStart(2, "0")
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

function activityOf(data, id) {
  return data.activities.find(a => a.id === id) ||
         { id: id, name: id, hex: "#6B6B70" }
}

// ---------------------------------------------------------------- 倒数日

const CD_PALETTE = ["#F566AD", "#F99243", "#3AD9AA", "#B05AE2", "#40BBE7", "#FAD338"]

/**
 * 还有几天。按「天」算不按 24 小时算——今天晚上 23:00 到明天早上 8:00 是「明天」，
 * 不是「还有 9 小时」。
 * 每年重复的（生日、纪念日）自动滚到下一次。
 */
function untilDays(cd, now) {
  const today = startOfDay(new Date(now || Date.now()))
  const m = String(cd.date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  let target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (cd.yearly) {
    target = new Date(today.getFullYear(), Number(m[2]) - 1, Number(m[3]))
    if (target < today) target = new Date(today.getFullYear() + 1, Number(m[2]) - 1, Number(m[3]))
  }
  return {
    days: Math.round((target.getTime() - today.getTime()) / 86400000),
    when: target
  }
}

/** 排序：先按还剩几天，已经过去的（只有不重复的才会过去）排最后。 */
function sortedCountdowns(data, now) {
  const out = []
  for (const cd of (data.countdowns || [])) {
    const u = untilDays(cd, now)
    if (u) out.push({ cd, days: u.days, when: u.when })
  }
  out.sort((a, b) => {
    if ((a.days < 0) !== (b.days < 0)) return a.days < 0 ? 1 : -1
    return a.days < 0 ? b.days - a.days : a.days - b.days
  })
  return out
}

/**
 * 倒数日面板。画成一张图而不是用 ListWidget 的堆栈，是为了能在电脑上渲染出来核对——
 * 堆栈布局只能等装到手机上才知道长什么样。
 */
function drawCountdowns(data, w, h, opts) {
  const o = opts || {}
  const ctx = new DrawContext()
  ctx.size = new Size(w, h)
  ctx.opaque = false
  ctx.respectScreenScale = true

  const items = sortedCountdowns(data, o.now).slice(0, o.max || 5)
  const ink = "#F6F1EC"

  if (!items.length) {
    ctx.setFont(Font.systemFont(13))
    ctx.setTextColor(new Color(ink, 0.35))
    ctx.setTextAlignedCenter()
    ctx.drawTextInRect("还没有记着的日子", new Rect(0, h / 2 - 10, w, 20))
    return ctx.getImage()
  }

  const gap = 9
  const rowH = Math.min(66, (h - gap * (items.length - 1)) / items.length)
  const WEEK = ["日", "一", "二", "三", "四", "五", "六"]

  items.forEach((it, i) => {
    const y = i * (rowH + gap)
    const hex = it.cd.hex || CD_PALETTE[i % CD_PALETTE.length]

    // 左边一道竖色条，比整块底色轻，也比小圆点显眼
    const bar = new Path()
    bar.addRoundedRect(new Rect(0, y + rowH * 0.14, 3.5, rowH * 0.72), 1.75, 1.75)
    ctx.addPath(bar)
    ctx.setFillColor(new Color(hex))
    ctx.fillPath()

    const past = it.days < 0
    const n = Math.abs(it.days)
    const big = it.days === 0 ? "今天" : String(n)

    // 大数字靠右，先量宽度给名字留位置
    // 已经过去的：数字小一号、暗一点，视觉上退到还没到的后面
    ctx.setTextAlignedRight()
    ctx.setFont(Font.boldSystemFont(rowH * (it.days === 0 ? 0.36 : past ? 0.37 : 0.46)))
    ctx.setTextColor(new Color(it.days === 0 ? hex : ink, past ? 0.5 : it.days === 0 ? 1 : 0.95))
    const numW = it.days === 0 ? rowH * 1.3
      : Math.max(rowH * 0.62, String(n).length * rowH * (past ? 0.23 : 0.28))
    ctx.drawTextInRect(big, new Rect(w - numW - (it.days === 0 ? 0 : rowH * 0.42),
                                     y + rowH * 0.10, numW, rowH * 0.56))
    if (it.days !== 0) {
      ctx.setFont(Font.systemFont(rowH * 0.19))
      ctx.setTextColor(new Color(ink, 0.4))
      ctx.drawTextInRect("天", new Rect(w - rowH * 0.40, y + rowH * 0.40, rowH * 0.36, rowH * 0.26))
    }

    const textW = w - 11 - numW - rowH * 0.5
    ctx.setTextAlignedLeft()
    ctx.setFont(Font.semiboldSystemFont(rowH * 0.24))
    ctx.setTextColor(new Color(ink, 0.95))
    ctx.drawTextInRect(it.cd.name, new Rect(11, y + rowH * 0.13, textW, rowH * 0.32))

    const d = it.when
    ctx.setFont(Font.systemFont(rowH * 0.185))
    ctx.setTextColor(new Color(ink, 0.38))
    // 过去的日子不写星期——「已经过去」四个字加上星期太长，会顶到数字上
    ctx.drawTextInRect(
      past
        ? "已过 · " + (d.getMonth() + 1) + "月" + d.getDate() + "日"
        : (d.getMonth() + 1) + "月" + d.getDate() + "日 周" + WEEK[d.getDay()]
            + (it.cd.yearly ? " · 每年" : ""),
      new Rect(11, y + rowH * 0.52, textW, rowH * 0.3))

    if (i < items.length - 1) {
      ctx.setFillColor(new Color(ink, 0.08))
      ctx.fillRect(new Rect(11, y + rowH + gap / 2 - 0.5, w - 11, 1))
    }
  })

  return ctx.getImage()
}

// ---------------------------------------------------------------- 绘制

/**
 * 占比圆盘：一段时间里各状态占了多少。
 * 和 drawDial 的区别是这里没有时间轴，角度就是比例，从 12 点顺时针排下去。
 */
function drawDonut(data, agg, size, opts) {
  const o = opts || {}
  const ctx = new DrawContext()
  ctx.size = new Size(size, size)
  ctx.opaque = false
  ctx.respectScreenScale = true

  if (o.card !== false) {
    ctx.setFillColor(new Color("#1B1720"))
    const card = new Path()
    card.addRoundedRect(new Rect(0, 0, size, size), 22, 22)
    ctx.addPath(card)
    ctx.fillPath()
  }

  const cx = size / 2, cy = size / 2
  const rOut = size * 0.42, rIn = size * 0.26
  const total = Object.keys(agg).reduce((sum, k) => sum + agg[k], 0)

  // 底圈：没有数据的时候也得看得出这里是个圆盘
  ringSlice(ctx, cx, cy, rIn, rOut, 0, 1, "#FFFFFF", 0.07)

  let t = 0
  const ranked = data.activities
    .filter(a => agg[a.id] > 0)
    .sort((x, y) => agg[y.id] - agg[x.id])
  for (const a of ranked) {
    const frac = agg[a.id] / total
    ringSlice(ctx, cx, cy, rIn, rOut, t, t + frac, a.hex)
    t += frac
  }

  ctx.setTextAlignedCenter()
  ctx.setFont(Font.boldSystemFont(size * 0.11))
  ctx.setTextColor(new Color("#F6F1EC"))
  ctx.drawTextInRect(total ? Math.round(total / 3600) + " 小时"  : "没有记录",
                     new Rect(0, cy - size * 0.09, size, size * 0.16))
  if (total && o.sub) {
    ctx.setFont(Font.systemFont(size * 0.055))
    ctx.setTextColor(new Color("#F6F1EC", 0.45))
    ctx.drawTextInRect(o.sub, new Rect(0, cy + size * 0.07, size, size * 0.09))
  }
  return ctx.getImage()
}

/** 圆环上一段扇形。角度用「一天的比例」表示，0 = 零点在正上方，顺时针。 */
function ringSlice(ctx, cx, cy, rIn, rOut, t0, t1, color, alpha) {
  const steps = Math.max(2, Math.ceil((t1 - t0) * 240))
  const pts = []
  const at = (t, r) => {
    const a = t * 2 * Math.PI - Math.PI / 2
    return new Point(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
  }
  for (let i = 0; i <= steps; i++) pts.push(at(t0 + (t1 - t0) * i / steps, rOut))
  for (let i = steps; i >= 0; i--) pts.push(at(t0 + (t1 - t0) * i / steps, rIn))
  const p = new Path()
  p.addLines(pts)
  p.closeSubpath()
  ctx.addPath(p)
  ctx.setFillColor(alpha === undefined ? new Color(color) : new Color(color, alpha))
  ctx.fillPath()
}

/**
 * 24 小时圆盘。size 是正方形边长（点）。
 * segs 是当天的时间段，now 是当前时间（毫秒）。
 */
function drawDial(data, segs, size, opts) {
  opts = opts || {}
  const now = opts.now || Date.now()
  const ctx = new DrawContext()
  ctx.size = new Size(size, size)
  ctx.opaque = false
  ctx.respectScreenScale = true

  // 自带底色：Scriptable 的表格会跟系统走浅色，透明底的话浅色文字和
  // 淡轨道全都看不见。画成一张自带深底的卡片，两种模式下长一样。
  if (opts.card !== false) {
    const card = new Path()
    card.addRoundedRect(new Rect(0, 0, size, size), size * 0.5, size * 0.5)
    ctx.addPath(card)
    ctx.setFillColor(new Color("#1B1720"))
    ctx.fillPath()
  }

  const cx = size / 2, cy = size / 2
  const rOut = size / 2 - 1
  const rIn = rOut * (1 - (opts.thickness || 0.26))
  const dayStart = startOfDay(new Date(now)).getTime() / 1000
  const turn = s => Math.min(1, Math.max(0, (s - dayStart) / 86400))

  // 还没到的时间：一圈暗轨道
  ringSlice(ctx, cx, cy, rIn, rOut, 0, 1, "#FFFFFF", 0.07)

  for (const seg of segs) {
    const t0 = turn(seg.s)
    const t1 = turn(seg.e != null ? seg.e : Math.floor(now / 1000))
    if (t1 <= t0) continue
    ringSlice(ctx, cx, cy, rIn, rOut, t0, t1, activityOf(data, seg.a).hex)
  }

  if (opts.ticks !== false) {
    for (let h = 0; h < 24; h += 3) {
      const a = (h / 24) * 2 * Math.PI - Math.PI / 2
      const r0 = rIn - size * 0.012, r1 = rIn - size * 0.045
      const p = new Path()
      p.addLines([
        new Point(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0),
        new Point(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
      ])
      ctx.addPath(p)
      ctx.setStrokeColor(new Color(h === 0 ? "#FFFFFF" : "#FFFFFF", h === 0 ? 0.45 : 0.18))
      ctx.setLineWidth(Math.max(1, size * 0.006))
      ctx.strokePath()
    }
  }

  // 「现在」那条细线
  const na = turn(Math.floor(now / 1000)) * 2 * Math.PI - Math.PI / 2
  const hand = new Path()
  hand.addLines([
    new Point(cx + Math.cos(na) * (rIn - size * 0.01), cy + Math.sin(na) * (rIn - size * 0.01)),
    new Point(cx + Math.cos(na) * (rOut + size * 0.012), cy + Math.sin(na) * (rOut + size * 0.012))
  ])
  ctx.addPath(hand)
  ctx.setStrokeColor(new Color("#FFFFFF", 0.85))
  ctx.setLineWidth(Math.max(1.5, size * 0.008))
  ctx.strokePath()

  const open = openSegment(segs)
  const cur = open ? activityOf(data, open.a) : null
  drawClawd(ctx, cx, cy + size * 0.010, size * 0.0042, cur ? cur.id : null)

  if (cur) {
    ctx.setTextAlignedCenter()
    ctx.setTextColor(new Color("#F6F1EC"))
    ctx.setFont(Font.boldSystemFont(size * 0.072))
    ctx.drawTextInRect(cur.name,
      new Rect(0, cy + size * 0.045, size, size * 0.10))
    if (opts.ticks !== false) {
      ctx.setTextColor(new Color("#FFFFFF", 0.5))
      ctx.setFont(Font.systemFont(size * 0.050))
      ctx.drawTextInRect("已经 " + hhmm(duration(open, now)),
        new Rect(0, cy + size * 0.140, size, size * 0.08))
    }
  }
  return ctx.getImage()
}

/** 一小段粗线，用一串圆点画出来 —— DrawContext 没有线帽也不能旋转。 */
function fatLine(ctx, x0, y0, x1, y1, w, color) {
  ctx.setFillColor(new Color(color))
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (w * 0.35)) + 1
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n
    ctx.fillEllipse(new Rect(x - w / 2, y - w / 2, w, w))
  }
}

/**
 * 圆滚滚那只 Clawd。k 是缩放，act 是当前状态 id —— 不同状态给不同动作。
 * 颜色固定用 Clawd 自己的橙，不跟着状态变。
 */
function drawClawd(ctx, cx, baseY, k, act, hexOverride) {
  const HEX = hexOverride || "#E88E68"
  const SH = shadeHex(HEX)
  const cream = "#FFFAF4", ink = "#5A4A44"
  const X = x => cx + x * k
  const Y = y => baseY - y * k
  const R = (x, y, w, h) => new Rect(X(x), Y(y + h), w * k, h * k)
  const fill = c => ctx.setFillColor(new Color(c))
  const poly = (pts, c) => {
    const q = new Path(); q.addLines(pts); q.closeSubpath()
    ctx.addPath(q); fill(c); ctx.fillPath()
  }

  // 每个状态：手的位置、脚要不要错开、眼睛怎么画、附带什么道具
  let handL = [-31, 14], handR = [31, 14]
  let stride = 0                      // 走路时两脚错开
  let eyes = "open"
  const props = []                    // 画在身体之后

  switch (act) {
    case "sleep":
      eyes = "shut"; handL = [-30, 10]; handR = [30, 10]
      props.push("zzz"); break
    case "class":
      handR = [30, 46]; break                       // 举手
    case "study":
      handL = [-13, 13]; handR = [13, 13]; props.push("book"); break
    case "research":
      handL = [-15, 11]; handR = [15, 11]; props.push("laptop"); break
    case "eat":
      handL = [-13, 11]; handR = [15, 20]; props.push("bowl"); break
    case "commute":
      stride = 5; handL = [-30, 20]; handR = [30, 8]; props.push("bag"); break
    case "sport":
      eyes = "happy"; handL = [-24, 46]; handR = [24, 46]
      props.push("dumbbell"); break
    case "rest":
      handR = [26, 22]; props.push("mug"); break
    case "phone":
      eyes = "down"; handL = [-9, 15]; handR = [9, 15]; props.push("phone"); break
  }

  // 脚
  fill(SH)
  ctx.fillEllipse(R(-18 - stride, -4, 15, 9))
  ctx.fillEllipse(R(3 + stride, -4, 15, 9))

  // 手臂（先画，压在身体下面）
  for (const [side, h] of [[-1, handL], [1, handR]]) {
    fatLine(ctx, X(23 * side), Y(30), X(h[0]), Y(h[1]), 8 * k, HEX)
    fill(SH); ctx.fillEllipse(R(h[0] - 4.5, h[1] - 4.5, 9, 9))
  }

  // 背包：画在身体后面才像背着
  if (props.includes("bag")) {
    let q = new Path()
    q.addRoundedRect(R(-33, 13, 15, 22), 5 * k, 5 * k)
    ctx.addPath(q); fill("#8B6F5E"); ctx.fillPath()
  }

  // 身体和肚皮
  let p = new Path(); p.addRoundedRect(R(-27, 0, 54, 48), 19 * k, 19 * k)
  ctx.addPath(p); fill(HEX); ctx.fillPath()
  p = new Path(); p.addRoundedRect(R(-15, 3, 30, 22), 10 * k, 10 * k)
  ctx.addPath(p); fill(cream); ctx.fillPath()

  // 星芒呆毛
  fill(SH)
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * 2 * Math.PI
    const len = (i % 2 === 0 ? 11.5 : 7.8) * k, w = 1.1 * k
    const bx = X(0), by = Y(50)
    const dx = Math.sin(a), dy = -Math.cos(a)
    const px = -dy, py = dx
    const q = new Path()
    q.addLines([
      new Point(bx + dx * 1.2 * k - px * w, by + dy * 1.2 * k - py * w),
      new Point(bx + dx * 1.2 * k + px * w, by + dy * 1.2 * k + py * w),
      new Point(bx + dx * len + px * w, by + dy * len + py * w),
      new Point(bx + dx * len - px * w, by + dy * len - py * w)
    ])
    q.closeSubpath(); ctx.addPath(q); ctx.fillPath()
  }

  // 腮红
  fill("#F09FB4")
  ctx.setFillColor(new Color("#F09FB4", 0.55))
  ctx.fillEllipse(R(-22, 27, 7, 5)); ctx.fillEllipse(R(15, 27, 7, 5))

  // 眼睛
  fill(ink)
  if (eyes === "shut") {
    ctx.fillEllipse(R(-13.5, 35, 8, 1.8)); ctx.fillEllipse(R(5.5, 35, 8, 1.8))
  } else if (eyes === "down") {
    ctx.fillEllipse(R(-13.5, 32, 8, 4.5)); ctx.fillEllipse(R(5.5, 32, 8, 4.5))
  } else if (eyes === "happy") {
    for (const sx of [-9.5, 9.5]) {
      const arc = []
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI * (0.15 + 0.7 * i / 8)
        arc.push(new Point(X(sx) + Math.cos(a) * 4.5 * k, Y(34) - Math.sin(a) * 4.5 * k))
      }
      const q = new Path(); q.addLines(arc)
      ctx.addPath(q); ctx.setStrokeColor(new Color(ink)); ctx.setLineWidth(2 * k); ctx.strokePath()
    }
  } else {
    ctx.fillEllipse(R(-13.5, 32, 8, 8)); ctx.fillEllipse(R(5.5, 32, 8, 8))
  }

  // 嘴
  if (eyes !== "shut") {
    const mouth = []
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * (1.18 + (0.64 * i) / 10)
      mouth.push(new Point(X(0) + Math.cos(a) * 5.5 * k, Y(32) - Math.sin(a) * 5.5 * k))
    }
    const m = new Path(); m.addLines(mouth)
    ctx.addPath(m); ctx.setStrokeColor(new Color(ink)); ctx.setLineWidth(2 * k); ctx.strokePath()
  }

  // 道具，画在最前面
  const holding = props.some(x => ["book", "laptop", "phone", "bowl"].includes(x))
  for (const prop of props) {
    if (prop === "book") {
      let q = new Path(); q.addRoundedRect(R(-15, 6, 30, 15), 2 * k, 2 * k)
      ctx.addPath(q); fill("#F2363C"); ctx.fillPath()
      fill("#FFFAF4")
      for (let i = 0; i < 3; i++) ctx.fillEllipse(R(-11, 16 - i * 4, 22, 1.6))
    }
    if (prop === "laptop") {
      let q = new Path(); q.addRoundedRect(R(-17, 5, 34, 19), 2 * k, 2 * k)
      ctx.addPath(q); fill("#3A3F47"); ctx.fillPath()
      fill("#3AD9AA")
      for (const [dx, w2, dy] of [[0, 16, 19], [0, 9, 15], [0, 21, 11], [0, 13, 7]])
        ctx.fillEllipse(R(-13 + dx, dy, w2, 1.8))
    }
    if (prop === "bowl") {
      poly([new Point(X(-14), Y(17)), new Point(X(14), Y(17)),
            new Point(X(9), Y(4)), new Point(X(-9), Y(4))], "#40BBE7")
      fill("#FAD338"); ctx.fillEllipse(R(-14, 15.5, 28, 5))   // 碗里的饭
      fill("#7FB4CC"); ctx.fillEllipse(R(-14.5, 16.5, 29, 2.5)) // 碗沿
    }
    if (prop === "mug") {
      let q = new Path(); q.addRoundedRect(R(22, 16, 12, 13), 2 * k, 2 * k)
      ctx.addPath(q); fill("#FFFAF4"); ctx.fillPath()
      fill("#8B6F5E"); ctx.fillEllipse(R(23.5, 25, 9, 3))
    }
    if (prop === "phone") {
      let q = new Path(); q.addRoundedRect(R(-7, 9, 14, 21), 2.5 * k, 2.5 * k)
      ctx.addPath(q); fill("#3A3F47"); ctx.fillPath()
      q = new Path(); q.addRoundedRect(R(-5.5, 11, 11, 17), 1.5 * k, 1.5 * k)
      ctx.addPath(q); fill("#40BBE7"); ctx.fillPath()
    }
    if (prop === "dumbbell") {
      fill("#6B6F76")
      ctx.fillEllipse(R(-30, 42, 9, 9)); ctx.fillEllipse(R(21, 42, 9, 9))
      ctx.fillEllipse(R(-22, 45, 44, 3))
    }
    if (prop === "strap") { /* 占位，实际在下面画 */ }
    if (prop === "zzz") {
      fill("#40BBE7")
      const zs = [[20, 52, 4], [27, 60, 5.5], [35, 69, 7]]
      for (const [zx, zy, zw] of zs) {
        ctx.fillEllipse(R(zx, zy + zw * 0.75, zw, 1.6))
        ctx.fillEllipse(R(zx, zy, zw, 1.6))
        poly([new Point(X(zx + zw), Y(zy + zw * 0.75)), new Point(X(zx + zw * 0.75), Y(zy + zw * 0.75)),
              new Point(X(zx), Y(zy + 1.6)), new Point(X(zx + zw * 0.25), Y(zy + 1.6))], "#40BBE7")
      }
    }
  }

  // 背包带：斜挎过胸口，这样背包才像背着而不是放在旁边
  if (props.includes("bag")) {
    fatLine(ctx, X(-20), Y(40), X(6), Y(14), 3 * k, SH)
  }

  // 抱着东西时，手补画在道具之上
  if (holding) {
    fill(SH)
    ctx.fillEllipse(R(handL[0] - 4.5, handL[1] - 4.5, 9, 9))
    ctx.fillEllipse(R(handR[0] - 4.5, handR[1] - 4.5, 9, 9))
  }
}

/** 同色系但更深一档，用于脚和呆毛。 */
function shadeHex(hex) {
  const h = hex.replace("#", "")
  const n = parseInt(h, 16)
  const f = 0.86
  const r = Math.round(((n >> 16) & 255) * f)
  const g = Math.round(((n >> 8) & 255) * f)
  const b = Math.round((n & 255) * f)
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")
}

module.exports = {
  VERSION, DATA, BAK, SCHEMA, load, save, dayKey, startOfDay, segments, openSegment, rollover,
  switchTo, autoSwitch, splitSegment, duration, totals, hhmm, clock, activityOf,
  drawDial, drawDonut, drawClawd, drawCountdowns, untilDays, sortedCountdowns,
  CD_PALETTE, DEFAULT_ACTIVITIES, DATA
}
