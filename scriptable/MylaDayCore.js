// Myla 的一天 — 共用核心：数据读写 + 圆盘绘制 + Clawd
//
// 两个脚本（主脚本和小组件）都 importModule 这一个文件，所以圆盘只有一份实现，
// 不会两边画得不一样。
//
// Scriptable 的 Path 没有 addArc，所有弧线都用多边形逼近；步数按弧长给，
// 肉眼看不出折线。

const fm = FileManager.local()
const DATA = fm.joinPath(fm.documentsDirectory(), "myladay.json")

// ---------------------------------------------------------------- 数据

const DEFAULT_ACTIVITIES = [
  { id: "sleep",    name: "睡觉",   hex: "#3B4A6B" },
  { id: "class",    name: "上课",   hex: "#7A5EA8" },
  { id: "study",    name: "学习",   hex: "#D06749" },
  { id: "research", name: "科研",   hex: "#3F8F8A" },
  { id: "eat",      name: "吃饭",   hex: "#D4A03C" },
  { id: "commute",  name: "通勤",   hex: "#5E7A94" },
  { id: "sport",    name: "运动",   hex: "#5D9856" },
  { id: "rest",     name: "休息",   hex: "#C98BA0" },
  { id: "phone",    name: "刷手机", hex: "#B85450" },
  { id: "other",    name: "其他",   hex: "#6B6B70" }
]

function load() {
  if (!fm.fileExists(DATA)) return { activities: DEFAULT_ACTIVITIES, days: {} }
  try {
    const d = JSON.parse(fm.readString(DATA))
    if (!d.activities || !d.activities.length) d.activities = DEFAULT_ACTIVITIES
    if (!d.days) d.days = {}
    return d
  } catch (e) {
    return { activities: DEFAULT_ACTIVITIES, days: {} }
  }
}

function save(d) { fm.writeString(DATA, JSON.stringify(d)) }

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

/** 切状态：关掉当前那段，从这一刻开新的。24 小时不留空档。 */
function switchTo(data, activityID, when) {
  const t = Math.floor((when || Date.now()) / 1000)
  rollover(data)
  const key = dayKey(new Date(t * 1000))
  const segs = data.days[key] || (data.days[key] = [])
  const open = openSegment(segs)
  if (open) {
    if (open.a === activityID) return data      // 已经在这个状态了
    open.e = t
  }
  segs.push({ id: uid(), a: activityID, s: t, e: null })
  return data
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

// ---------------------------------------------------------------- 绘制

/** 圆环上一段扇形。角度用「一天的比例」表示，0 = 零点在正上方，顺时针。 */
function ringSlice(ctx, cx, cy, rIn, rOut, t0, t1, color) {
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
  ctx.setFillColor(new Color(color))
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

  const cx = size / 2, cy = size / 2
  const rOut = size / 2 - 1
  const rIn = rOut * (1 - (opts.thickness || 0.26))
  const dayStart = startOfDay(new Date(now)).getTime() / 1000
  const turn = s => Math.min(1, Math.max(0, (s - dayStart) / 86400))

  // 还没到的时间：一圈暗轨道
  ringSlice(ctx, cx, cy, rIn, rOut, 0, 1, "#FFFFFF12")

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
  drawClawd(ctx, cx, cy + size * 0.010, size * 0.0042, cur ? cur.hex : "#D9784F")

  if (cur) {
    ctx.setTextAlignedCenter()
    ctx.setTextColor(new Color("#FFFFFF"))
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

/** 圆滚滚那只 Clawd。几何跟 iOS 的 ClawdDrawn.swift 一致，k 是缩放。 */
function drawClawd(ctx, cx, baseY, k, hex) {
  const body = new Color(hex)
  const shade = new Color(hex, 1)
  const cream = "#F9F2E8", ink = "#2B2119"
  // y 往下为正，所以模型里的 +y 要减
  const X = x => cx + x * k
  const Y = y => baseY - y * k
  const R = (x, y, w, h) => new Rect(X(x), Y(y + h), w * k, h * k)

  // 脚
  ctx.setFillColor(new Color(shadeHex(hex)))
  ctx.fillEllipse(R(-18, -4, 15, 9))
  ctx.fillEllipse(R(3, -4, 15, 9))

  // 手臂
  for (const side of [-1, 1]) {
    fatLine(ctx, X(23 * side), Y(30), X(31 * side), Y(14), 8 * k, hex)
    ctx.setFillColor(new Color(shadeHex(hex)))
    ctx.fillEllipse(R(31 * side - 4.5, 14 - 4.5, 9, 9))
  }

  // 身体和肚皮
  let p = new Path()
  p.addRoundedRect(R(-27, 0, 54, 48), 19 * k, 19 * k)
  ctx.addPath(p); ctx.setFillColor(body); ctx.fillPath()
  p = new Path()
  p.addRoundedRect(R(-15, 3, 30, 22), 10 * k, 10 * k)
  ctx.addPath(p); ctx.setFillColor(new Color(cream)); ctx.fillPath()

  // 星芒呆毛：每根用四点多边形，不用旋转
  ctx.setFillColor(new Color(shadeHex(hex)))
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
    q.closeSubpath()
    ctx.addPath(q); ctx.fillPath()
  }

  // 腮红、眼睛
  ctx.setFillColor(new Color("#F08C80", 0.55))
  ctx.fillEllipse(R(-22, 27, 7, 5)); ctx.fillEllipse(R(15, 27, 7, 5))
  ctx.setFillColor(new Color(ink))
  ctx.fillEllipse(R(-13.5, 32, 8, 8)); ctx.fillEllipse(R(5.5, 32, 8, 8))

  // 嘴：一段折线弧
  const mouth = []
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * (1.18 + (0.64 * i) / 10)
    mouth.push(new Point(X(0) + Math.cos(a) * 5.5 * k, Y(32) - Math.sin(a) * 5.5 * k))
  }
  const m = new Path(); m.addLines(mouth)
  ctx.addPath(m); ctx.setStrokeColor(new Color(ink)); ctx.setLineWidth(2 * k); ctx.strokePath()
}

/** 同色系但更深一档，用于脚和呆毛。 */
function shadeHex(hex) {
  const h = hex.replace("#", "")
  const n = parseInt(h, 16)
  const f = 0.78
  const r = Math.round(((n >> 16) & 255) * f)
  const g = Math.round(((n >> 8) & 255) * f)
  const b = Math.round((n & 255) * f)
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")
}

module.exports = {
  load, save, dayKey, startOfDay, segments, openSegment, rollover,
  switchTo, splitSegment, duration, totals, hhmm, clock, activityOf,
  drawDial, drawClawd, DEFAULT_ACTIVITIES, DATA
}
